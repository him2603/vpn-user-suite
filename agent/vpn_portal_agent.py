#!/usr/bin/env python3
"""
VPN Self-Service Portal — on-premise helper agent.

Runs on the RHEL OpenVPN host. The web portal calls this service over HTTPS;
every request carries an HMAC-SHA256 signature computed from a shared secret,
so the endpoints cannot be used by anyone who does not hold the secret.

Responsibilities (nothing else is exposed):
  POST /v1/auth             - verify Linux credentials + Google Authenticator via PAM
  POST /v1/totp/current     - return the user's existing TOTP secret / otpauth URI
  POST /v1/totp/regenerate  - write a brand new ~/.google_authenticator
  POST /v1/ovpn/info        - metadata about the user's .ovpn profile
  POST /v1/ovpn             - return the user's own .ovpn profile
  POST /v1/history          - the user's QR + download audit trail

Security notes:
  * Constant-time signature comparison, 60s timestamp window, single-use nonces.
  * Usernames are validated against a strict pattern and resolved through the
    passwd database; paths are never built from raw client input.
  * A user can only ever touch their own files - the portal sends the username
    from its signed session cookie, and the agent re-validates it.
  * Per-user and per-IP login throttling with lockout.
  * Full audit trail in SQLite (0600) plus syslog.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import pwd
import re
import secrets
import sqlite3
import stat
import time
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any, Optional

import pam as pam_module
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

# --------------------------------------------------------------------------- #
# Configuration (all via environment / systemd EnvironmentFile)
# --------------------------------------------------------------------------- #

SHARED_SECRET = os.environ.get("PORTAL_SHARED_SECRET", "")
OVPN_DIR = Path(os.environ.get("OVPN_DIR", "/etc/openvpn/client/ovpn-files"))
DB_PATH = Path(os.environ.get("PORTAL_DB", "/var/lib/vpn-portal-agent/portal.db"))
PAM_SERVICE = os.environ.get("PAM_SERVICE", "vpnportal")
TOTP_ISSUER = os.environ.get("TOTP_ISSUER", "OpenVPN")
ALLOWED_SHELL_USERS_MIN_UID = int(os.environ.get("MIN_UID", "1000"))
MAX_ATTEMPTS = int(os.environ.get("MAX_LOGIN_ATTEMPTS", "5"))
LOCKOUT_SECONDS = int(os.environ.get("LOCKOUT_SECONDS", "900"))
CLOCK_SKEW_SECONDS = 60

USERNAME_RE = re.compile(r"^[a-z_][a-z0-9_.-]{0,31}$")

if not SHARED_SECRET or len(SHARED_SECRET) < 32:
    raise SystemExit("PORTAL_SHARED_SECRET must be set and at least 32 characters long.")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("vpn-portal-agent")

app = FastAPI(title="VPN Portal Agent", docs_url=None, redoc_url=None, openapi_url=None)

# --------------------------------------------------------------------------- #
# Storage
# --------------------------------------------------------------------------- #

_db_lock = Lock()


def db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db() -> None:
    with _db_lock, db() as conn:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS events (
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   username TEXT NOT NULL,
                   action TEXT NOT NULL,
                   detail TEXT,
                   ip TEXT,
                   created_at TEXT NOT NULL)"""
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_events_user ON events(username, id DESC)")
        conn.execute(
            """CREATE TABLE IF NOT EXISTS login_attempts (
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   subject TEXT NOT NULL,
                   success INTEGER NOT NULL,
                   created_at INTEGER NOT NULL)"""
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_attempts ON login_attempts(subject, created_at)"
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS used_nonces (
                   nonce TEXT PRIMARY KEY,
                   created_at INTEGER NOT NULL)"""
        )
    try:
        os.chmod(DB_PATH, 0o600)
    except OSError:
        pass


def record_event(username: str, action: str, detail: Optional[str], ip: str) -> None:
    with _db_lock, db() as conn:
        conn.execute(
            "INSERT INTO events (username, action, detail, ip, created_at) VALUES (?,?,?,?,?)",
            (username, action, detail, ip, datetime.now(timezone.utc).isoformat()),
        )
    log.info("audit user=%s action=%s ip=%s detail=%s", username, action, ip, detail)


def record_attempt(subject: str, success: bool) -> None:
    now = int(time.time())
    with _db_lock, db() as conn:
        conn.execute(
            "INSERT INTO login_attempts (subject, success, created_at) VALUES (?,?,?)",
            (subject, 1 if success else 0, now),
        )
        conn.execute("DELETE FROM login_attempts WHERE created_at < ?", (now - 86400,))


def is_locked_out(subject: str) -> bool:
    cutoff = int(time.time()) - LOCKOUT_SECONDS
    with _db_lock, db() as conn:
        row = conn.execute(
            "SELECT created_at FROM login_attempts WHERE subject=? AND success=1 "
            "ORDER BY created_at DESC LIMIT 1",
            (subject,),
        ).fetchone()
        since = max(cutoff, row["created_at"] if row else 0)
        count = conn.execute(
            "SELECT COUNT(*) AS c FROM login_attempts WHERE subject=? AND success=0 "
            "AND created_at >= ?",
            (subject, since),
        ).fetchone()["c"]
    return count >= MAX_ATTEMPTS


def consume_nonce(nonce: str) -> bool:
    now = int(time.time())
    with _db_lock, db() as conn:
        conn.execute("DELETE FROM used_nonces WHERE created_at < ?", (now - 600,))
        try:
            conn.execute("INSERT INTO used_nonces (nonce, created_at) VALUES (?,?)", (nonce, now))
        except sqlite3.IntegrityError:
            return False
    return True


# --------------------------------------------------------------------------- #
# Request authentication
# --------------------------------------------------------------------------- #


async def verify_request(request: Request) -> dict[str, Any]:
    timestamp = request.headers.get("x-portal-timestamp", "")
    nonce = request.headers.get("x-portal-nonce", "")
    signature = request.headers.get("x-portal-signature", "")
    body = await request.body()

    if not timestamp.isdigit() or not nonce or not signature:
        raise HTTPException(status_code=401, detail="Unauthorised request.")
    if abs(int(time.time()) - int(timestamp)) > CLOCK_SKEW_SECONDS:
        raise HTTPException(status_code=401, detail="Request expired.")

    payload = f"{timestamp}.{nonce}.{request.url.path}.{body.decode('utf-8')}"
    expected = hmac.new(SHARED_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=401, detail="Unauthorised request.")
    if not consume_nonce(nonce):
        raise HTTPException(status_code=401, detail="Replayed request rejected.")

    try:
        return json.loads(body or b"{}")
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Malformed request.")


# --------------------------------------------------------------------------- #
# Models & helpers
# --------------------------------------------------------------------------- #


class UserRequest(BaseModel):
    username: str
    ip: str = "unknown"

    @field_validator("username")
    @classmethod
    def valid_username(cls, value: str) -> str:
        value = value.strip().lower()
        if not USERNAME_RE.match(value):
            raise ValueError("invalid username")
        return value


class AuthRequest(UserRequest):
    password: str = Field(min_length=1, max_length=256)
    otp: Optional[str] = None

    @field_validator("otp")
    @classmethod
    def valid_otp(cls, value: Optional[str]) -> Optional[str]:
        if value in (None, ""):
            return None
        if not re.fullmatch(r"[0-9]{6,8}", value):
            raise ValueError("invalid code")
        return value


def resolve_user(username: str) -> pwd.struct_passwd:
    try:
        entry = pwd.getpwnam(username)
    except KeyError:
        raise HTTPException(status_code=403, detail="Access denied.")
    if entry.pw_uid < ALLOWED_SHELL_USERS_MIN_UID:
        raise HTTPException(status_code=403, detail="Access denied.")
    return entry


def ga_path(entry: pwd.struct_passwd) -> Path:
    home = Path(entry.pw_dir).resolve()
    return home / ".google_authenticator"


def ovpn_path(username: str) -> Path:
    base = OVPN_DIR.resolve()
    candidate = (base / f"{username}.ovpn").resolve()
    if candidate.parent != base:
        raise HTTPException(status_code=403, detail="Access denied.")
    return candidate


def parse_ga_file(path: Path) -> tuple[Optional[str], list[str]]:
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except (OSError, PermissionError):
        return None, []
    lines = [line.strip() for line in raw.splitlines() if line.strip()]
    if not lines:
        return None, []
    secret = lines[0]
    if not re.fullmatch(r"[A-Z2-7]{16,64}", secret):
        return None, []
    codes = [line for line in lines[1:] if re.fullmatch(r"[0-9]{8}", line)]
    return secret, codes


def otpauth_uri(username: str, secret: str) -> str:
    from urllib.parse import quote

    label = quote(f"{TOTP_ISSUER}:{username}", safe="")
    return f"otpauth://totp/{label}?secret={secret}&issuer={quote(TOTP_ISSUER, safe='')}&algorithm=SHA1&digits=6&period=30"


def write_ga_file(entry: pwd.struct_passwd) -> tuple[str, list[str]]:
    secret = base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")
    codes = [f"{secrets.randbelow(90_000_000) + 10_000_000}" for _ in range(5)]
    content = "\n".join(
        [secret, '" RATE_LIMIT 3 30', '" DISALLOW_REUSE', '" TOTP_AUTH', *codes, ""]
    )

    path = ga_path(entry)
    tmp = path.with_name(f".google_authenticator.{secrets.token_hex(6)}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(content)
        os.chown(tmp, entry.pw_uid, entry.pw_gid)
        os.chmod(tmp, stat.S_IRUSR | stat.S_IWUSR)
        os.replace(tmp, path)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise
    return secret, codes


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #


@app.post("/v1/auth")
async def auth(request: Request) -> dict[str, Any]:
    payload = await verify_request(request)
    data = AuthRequest(**payload)
    entry = resolve_user(data.username)

    for subject in (f"user:{data.username}", f"ip:{data.ip}"):
        if is_locked_out(subject):
            record_event(data.username, "login_blocked", "too many failed attempts", data.ip)
            raise HTTPException(
                status_code=429,
                detail="Too many failed sign-in attempts. Please try again later.",
            )

    # The vpnportal PAM stack uses pam_google_authenticator with forward_pass,
    # so a single response carries the password immediately followed by the code.
    response = data.password + (data.otp or "")
    authenticator = pam_module.pam()
    ok = bool(authenticator.authenticate(entry.pw_name, response, service=PAM_SERVICE))

    record_attempt(f"user:{data.username}", ok)
    record_attempt(f"ip:{data.ip}", ok)

    if not ok:
        record_event(data.username, "login_failed", None, data.ip)
        raise HTTPException(status_code=401, detail="Invalid username, password or code.")

    record_event(data.username, "login_success", None, data.ip)
    return {"ok": True}


@app.post("/v1/totp/current")
async def totp_current(request: Request) -> dict[str, Any]:
    payload = await verify_request(request)
    data = UserRequest(**payload)
    entry = resolve_user(data.username)

    secret, codes = parse_ga_file(ga_path(entry))
    if not secret:
        return {"exists": False, "secret": None, "otpauth_uri": None, "scratch_codes": []}

    record_event(data.username, "qr_viewed", "existing authenticator shown", data.ip)
    return {
        "exists": True,
        "secret": secret,
        "otpauth_uri": otpauth_uri(entry.pw_name, secret),
        "scratch_codes": codes,
    }


@app.post("/v1/totp/regenerate")
async def totp_regenerate(request: Request) -> dict[str, Any]:
    payload = await verify_request(request)
    data = UserRequest(**payload)
    entry = resolve_user(data.username)

    try:
        secret, codes = write_ga_file(entry)
    except OSError as error:
        log.error("failed writing authenticator for %s: %s", data.username, error)
        raise HTTPException(status_code=500, detail="Could not write the new authenticator secret.")

    record_event(data.username, "qr_generated", "new authenticator secret created", data.ip)
    return {
        "exists": True,
        "secret": secret,
        "otpauth_uri": otpauth_uri(entry.pw_name, secret),
        "scratch_codes": codes,
    }


@app.post("/v1/ovpn/info")
async def ovpn_info(request: Request) -> dict[str, Any]:
    payload = await verify_request(request)
    data = UserRequest(**payload)
    resolve_user(data.username)

    path = ovpn_path(data.username)
    if not path.is_file():
        return {"available": False, "size_bytes": 0, "modified_at": None}
    info = path.stat()
    return {
        "available": True,
        "size_bytes": info.st_size,
        "modified_at": datetime.fromtimestamp(info.st_mtime, timezone.utc).isoformat(),
    }


@app.post("/v1/ovpn")
async def ovpn_download(request: Request) -> dict[str, Any]:
    payload = await verify_request(request)
    data = UserRequest(**payload)
    resolve_user(data.username)

    path = ovpn_path(data.username)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="No configuration file exists for your account.")
    if path.is_symlink():
        raise HTTPException(status_code=403, detail="Access denied.")

    content = path.read_bytes()
    record_event(data.username, "ovpn_downloaded", f"{path.name} ({len(content)} bytes)", data.ip)
    return {
        "filename": path.name,
        "content_b64": base64.b64encode(content).decode(),
    }


@app.post("/v1/history")
async def history(request: Request) -> dict[str, Any]:
    payload = await verify_request(request)
    data = UserRequest(**payload)
    resolve_user(data.username)

    with _db_lock, db() as conn:
        rows = conn.execute(
            "SELECT id, action, detail, created_at FROM events "
            "WHERE username=? AND action IN ('qr_generated','qr_viewed','ovpn_downloaded') "
            "ORDER BY id DESC LIMIT 200",
            (data.username,),
        ).fetchall()

    return {"events": [dict(row) for row in rows]}


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


init_db()
