/**
 * Server-only client for the VPN helper agent that runs on the RHEL OpenVPN host.
 *
 * Every request is authenticated with an HMAC-SHA256 signature over
 * `timestamp.nonce.path.body` using a shared secret, so a leaked URL alone is
 * useless and captured requests cannot be replayed (the agent enforces a
 * 60 second window and rejects reused nonces).
 */

// LAN-only: allow self-signed certificates on the agent's HTTPS endpoint.
// Set VPN_AGENT_INSECURE_TLS=1 in .env when the agent uses a self-signed cert
// (e.g. https://172.16.0.146). Has no effect on Cloudflare Workers.
if (process.env["VPN_AGENT_INSECURE_TLS"] === "1") {
  process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";
}

type AgentConfig = { baseUrl: string; secret: string };

function readConfig(): AgentConfig {
  const baseUrl = process.env["VPN_AGENT_URL"];
  const secret = process.env["VPN_AGENT_SECRET"];
  if (!baseUrl || !secret) {
    throw new Error(
      "VPN agent is not configured. Set VPN_AGENT_URL and VPN_AGENT_SECRET, then publish the app.",
    );
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), secret };
}

async function sign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export class AgentError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function callAgent<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const { baseUrl, secret } = readConfig();
  const serialized = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID();
  const signature = await sign(secret, `${timestamp}.${nonce}.${path}.${serialized}`);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-portal-timestamp": timestamp,
        "x-portal-nonce": nonce,
        "x-portal-signature": signature,
      },
      body: serialized,
    });
  } catch {
    throw new AgentError("Cannot reach the VPN server right now. Please try again later.", 503);
  }

  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const detail =
      parsed && typeof parsed === "object" && "detail" in parsed
        ? String((parsed as { detail: unknown }).detail)
        : "The VPN server rejected the request.";
    throw new AgentError(detail, response.status);
  }

  return parsed as T;
}
