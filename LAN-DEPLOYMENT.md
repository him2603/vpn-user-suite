# LAN Deployment Guide

Run the VPN Self-Service Portal entirely inside your LAN — no internet,
no Lovable hosting, no public DNS. The portal talks to the agent on your
RHEL server over HTTPS using its LAN IP and a self-signed certificate.

## Prerequisites

- **Node.js 20+** on the machine that will run the portal (can be the RHEL
  server itself, or any other machine in the LAN).
  ```bash
  # RHEL 9 — install Node.js 20 via NodeSource
  curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
  sudo dnf install -y nodejs
  node --version   # should print v20.x or higher
  ```

- **The agent already running** on your RHEL server (nginx on 443, uvicorn
  on 127.0.0.1:8787). Verify:
  ```bash
  curl -vk https://172.16.0.146/healthz   # → {"status":"ok"}
  ```

- **The `PORTAL_SHARED_SECRET`** value from `/etc/vpn-portal-agent/agent.env`
  on the RHEL server — you need this exact value for the portal.

## Step 1 — Get the code onto your LAN machine

```bash
# If connected to GitHub:
git clone <your-repo-url> vpn-portal
cd vpn-portal

# Otherwise: copy the entire project folder from your development machine.
```

## Step 2 — Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:

| Variable | Value |
|---|---|
| `VPN_AGENT_URL` | `https://172.16.0.146` (your agent's LAN address) |
| `VPN_AGENT_SECRET` | The `PORTAL_SHARED_SECRET` value from your RHEL server |
| `SESSION_SECRET` | Run `openssl rand -hex 32` and paste the output |
| `VPN_AGENT_INSECURE_TLS` | `1` (because your cert is self-signed) |
| `PORT` | `3000` (or any free port) |

## Step 3a — Development mode (quick testing)

```bash
npm install
npm run dev -- --host 0.0.0.0
```

Open from any LAN machine: **http://<this-machine-ip>:8080**

## Step 3b — Production mode (recommended for daily use)

```bash
npm install
npm run build:lan
npm run start:lan
```

Open from any LAN machine: **http://<this-machine-ip>:3000**

### Run as a systemd service (production)

Create `/etc/systemd/system/vpn-portal.service`:

```ini
[Unit]
Description=VPN Self-Service Portal
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/vpn-portal
EnvironmentFile=/opt/vpn-portal/.env
ExecStart=/usr/bin/node /opt/vpn-portal/.output/server/index.mjs
Restart=always
RestartSec=5

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/opt/vpn-portal
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictRealtime=true
RestrictNamespaces=true
MemoryDenyWriteExecute=true
LockPersonality=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now vpn-portal
sudo systemctl status vpn-portal
```

## Step 4 — Put behind nginx HTTPS (optional, recommended)

For HTTPS access to the portal itself (not required, but nicer):

```nginx
# /etc/nginx/conf.d/vpn-portal.conf
server {
    listen 443 ssl;
    server_name 172.16.0.200;  # the portal machine's IP

    ssl_certificate     /etc/pki/tls/certs/portal-selfsigned.crt;
    ssl_certificate_key /etc/pki/tls/private/portal-selfsigned.key;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}

server {
    listen 80;
    server_name 172.16.0.200;
    return 301 https://$host$request_uri;
}
```

Generate a self-signed cert for the portal:
```bash
sudo openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout /etc/pki/tls/private/portal-selfsigned.key \
  -out /etc/pki/tls/certs/portal-selfsigned.crt \
  -subj "/CN=172.16.0.200"
sudo nginx -t && sudo systemctl reload nginx
```

Then access the portal at **https://172.16.0.200**

## Step 5 — Test

1. Open the portal URL in a browser.
2. Sign in with your Linux username + password + Google Authenticator code.
3. Try "Show existing QR", "Generate new QR", download your .ovpn file.

## Firewall

If the portal and agent are on different machines, ensure port 443 on the
RHEL server is open for LAN traffic:

```bash
sudo firewall-cmd --add-rich-rule='rule family=ipv4 source address=172.16.0.0/24 port port=443 protocol=tcp accept' --permanent
sudo firewall-cmd --reload
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Cannot reach the VPN server" | Check `VPN_AGENT_URL` is correct and agent is running (`curl -vk https://172.16.0.146/healthz`) |
| "Invalid signature" | `VPN_AGENT_SECRET` doesn't match `PORTAL_SHARED_SECRET` on the server |
| Cert errors in browser | Accept the self-signed cert in your browser's warning dialog |
| Portal shows blank page | Check `npm run build:lan` succeeded; check `node .output/server/index.mjs` output |
