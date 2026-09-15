/**
 * Demo mode: lets the portal be explored end-to-end before the RHEL agent is
 * installed. It never touches PAM, TOTP files or real .ovpn profiles — all data
 * below is fabricated and only served for the reserved "demo" account.
 */

export const DEMO_USERNAME = "demo";
const DEMO_PASSWORD = "Demo@12345";
const DEMO_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

export function isDemoUser(username: string): boolean {
  return username === DEMO_USERNAME;
}

export function checkDemoCredentials(username: string, password: string): boolean {
  return username === DEMO_USERNAME && password === DEMO_PASSWORD;
}

function randomBase32(length: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes)
    .map((b) => alphabet[b % alphabet.length])
    .join("");
}

function scratchCodes(): string[] {
  return Array.from({ length: 5 }, () =>
    String(crypto.getRandomValues(new Uint32Array(1))[0]! % 100000000).padStart(8, "0"),
  );
}

export function demoTotp(regenerate: boolean) {
  const secret = regenerate ? randomBase32(32) : DEMO_SECRET;
  return {
    exists: true,
    secret,
    otpauth_uri: `otpauth://totp/OpenVPN:${DEMO_USERNAME}?secret=${secret}&issuer=OpenVPN&algorithm=SHA1&digits=6&period=30`,
    scratch_codes: scratchCodes(),
  };
}

export function demoHistory() {
  const now = Date.now();
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60000).toISOString();
  return {
    events: [
      { id: 4, action: "qr_viewed" as const, created_at: at(12), detail: "Existing QR displayed" },
      {
        id: 3,
        action: "ovpn_downloaded" as const,
        created_at: at(180),
        detail: "demo.ovpn (4.1 KB)",
      },
      { id: 2, action: "qr_generated" as const, created_at: at(2880), detail: "New secret created" },
      {
        id: 1,
        action: "ovpn_downloaded" as const,
        created_at: at(10080),
        detail: "demo.ovpn (4.1 KB)",
      },
    ],
  };
}

export function demoProfileInfo() {
  return {
    available: true,
    size_bytes: 4207,
    modified_at: new Date(Date.now() - 86400000 * 9).toISOString(),
  };
}

export function demoOvpnFile(): { filename: string; content: string } {
  return {
    filename: `${DEMO_USERNAME}.ovpn`,
    content: `# Sample OpenVPN client profile (demo mode - not a working config)
client
dev tun
proto udp
remote vpn.example.com 1194
resolv-retry infinite
nobind
persist-key
persist-tun
remote-cert-tls server
auth-user-pass
auth-nocache
cipher AES-256-GCM
verb 3
<ca>
-----BEGIN CERTIFICATE-----
DEMO PLACEHOLDER - your real profile is served from the RHEL server
-----END CERTIFICATE-----
</ca>
`,
  };
}
