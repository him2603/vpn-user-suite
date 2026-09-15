# VPN Self-Service Portal — RHEL helper agent

This small service runs on your RHEL 9.8 OpenVPN host. The web portal never
touches your server directly: it calls this agent over HTTPS with a signed,
non-replayable request. All VPN material (passwords, TOTP secrets, `.ovpn`
files, audit history) stays on your machine.

## 1. Install

```bash
sudo dnf install -y python3.11 python3.11-pip nginx pam-devel gcc
sudo mkdir -p /opt/vpn-portal-agent /etc/vpn-portal-agent /var/lib/vpn-portal-agent
sudo chmod 700 /etc/vpn-portal-agent /var/lib/vpn-portal-agent

sudo cp vpn_portal_agent.py requirements.txt /opt/vpn-portal-agent/
cd /opt/vpn-portal-agent
sudo python3.11 -m venv venv
sudo ./venv/bin/pip install -r requirements.txt
```

## 2. Shared secret

Generate one strong secret. The **same value** goes into the agent and into the
portal (as the `VPN_AGENT_SECRET` secret).

```bash
openssl rand -hex 32
```

```bash
sudo tee /etc/vpn-portal-agent/agent.env >/dev/null <<'EOF'
PORTAL_SHARED_SECRET=<paste the value from openssl rand -hex 32>
OVPN_DIR=/etc/openvpn/client/ovpn-files
PORTAL_DB=/var/lib/vpn-portal-agent/portal.db
PAM_SERVICE=vpnportal
TOTP_ISSUER=OpenVPN
MIN_UID=1000
MAX_LOGIN_ATTEMPTS=5
LOCKOUT_SECONDS=900
EOF
sudo chmod 600 /etc/vpn-portal-agent/agent.env
```

## 3. PAM stack

```bash
sudo cp pam.d-vpnportal /etc/pam.d/vpnportal
sudo chmod 644 /etc/pam.d/vpnportal
```

The portal sends the password and the 6-digit code as one string;
`pam_google_authenticator ... forward_pass` splits them. `nullok` lets a user
who has not enrolled yet sign in with the password only, so they can generate
their first QR code. Drop `nullok` once everyone is enrolled.

## 4. TLS + service

```bash
sudo cp nginx-vpn-portal-agent.conf /etc/nginx/conf.d/
sudo vi /etc/nginx/conf.d/nginx-vpn-portal-agent.conf   # set server_name + cert paths
sudo nginx -t && sudo systemctl enable --now nginx

sudo cp vpn-portal-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now vpn-portal-agent

sudo firewall-cmd --permanent --add-service=https && sudo firewall-cmd --reload
```

SELinux (enforcing) needs nginx to reach the local agent:

```bash
sudo setsebool -P httpd_can_network_connect 1
```

Verify: `curl -s https://vpn-agent.example.com/healthz` → `{"status":"ok"}`

## 5. Point the portal at the agent

In the portal project, set two secrets:

| Secret             | Value                                              |
| ------------------ | -------------------------------------------------- |
| `VPN_AGENT_URL`    | `https://vpn-agent.example.com`                     |
| `VPN_AGENT_SECRET` | the same value as `PORTAL_SHARED_SECRET`            |

Restrict who can reach the agent by allowing only Lovable's egress at the
firewall/nginx level if you want defence in depth — the HMAC signature already
rejects every unsigned caller.

## Security properties

- HMAC-SHA256 over `timestamp.nonce.path.body`, 60-second window, single-use
  nonces (replay-proof), constant-time comparison.
- Usernames validated by regex **and** resolved through `getpwnam`; system
  accounts below `MIN_UID` are refused. Paths are never concatenated from raw
  input and are re-checked against the configured directory.
- A user can only ever read their own `.ovpn` file and their own history.
- `.google_authenticator` is written atomically as `0600`, owned by the user,
  with `O_NOFOLLOW` to defeat symlink attacks.
- Login throttling in the agent (5 failures → 15-minute lockout) plus
  `pam_faillock` in the PAM stack.
- Full audit trail in a `0600` SQLite database and in the journal.
- The agent listens on loopback only; nginx terminates TLS; systemd hardening
  (`ProtectSystem=strict`, `NoNewPrivileges`, syscall filtering).

## Backups

`/var/lib/vpn-portal-agent/portal.db` holds the audit history — include it in
your backup routine.
