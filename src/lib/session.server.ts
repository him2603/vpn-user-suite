/**
 * Stateless, signed session cookie (HS256 JWT).
 *
 * The cookie is HttpOnly + Secure + SameSite=Strict and expires after 30
 * minutes of absolute lifetime. It carries only the Linux username — no
 * password, no VPN material is ever stored client-side.
 */
import { SignJWT, jwtVerify } from "jose";
import { getRequestHeader, setResponseHeader } from "@tanstack/react-start/server";

const COOKIE_NAME = "vpn_portal_session";
const MAX_AGE_SECONDS = 30 * 60;

function key(): Uint8Array {
  const secret = process.env["SESSION_SECRET"];
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET is missing or too short.");
  }
  return new TextEncoder().encode(secret);
}

export type SessionUser = { username: string };

export async function createSession(username: string): Promise<void> {
  const token = await new SignJWT({ sub: username })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("vpn-portal")
    .setAudience("vpn-portal")
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(key());

  setResponseHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${MAX_AGE_SECONDS}`,
  );
}

export function destroySession(): void {
  setResponseHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
  );
}

function readCookie(header: string | undefined | null): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE_NAME) return rest.join("=");
  }
  return null;
}

export async function getSessionUser(cookieHeader?: string | null): Promise<SessionUser | null> {
  const raw = readCookie(cookieHeader ?? getRequestHeader("cookie"));
  if (!raw) return null;
  try {
    const { payload } = await jwtVerify(raw, key(), {
      issuer: "vpn-portal",
      audience: "vpn-portal",
    });
    if (typeof payload.sub !== "string" || !payload.sub) return null;
    return { username: payload.sub };
  } catch {
    return null;
  }
}

export async function requireSessionUser(cookieHeader?: string | null): Promise<SessionUser> {
  const user = await getSessionUser(cookieHeader);
  if (!user) throw new Error("Your session has expired. Please sign in again.");
  return user;
}
