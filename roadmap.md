# VPN Self-Service Portal — tasks

## Done
- [x] Sign-in page (Linux username + password + authenticator code)
- [x] Dashboard: welcome, logout, show-existing / regenerate QR with secret + scratch codes
- [x] Client file download (own user only) at /api/ovpn
- [x] Activity history (QR views/generations + downloads with date & time)
- [x] RHEL helper agent (FastAPI + PAM + systemd + nginx TLS + PAM config + README)
- [x] SESSION_SECRET generated and stored

## Open
- [ ] User: add VPN_AGENT_URL + VPN_AGENT_SECRET via the secure secrets form
- [ ] User: install agent on RHEL per agent/README.md (README explains sign-in credentials too)
- [ ] Publish app after secrets are set
