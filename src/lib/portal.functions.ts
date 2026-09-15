import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";

const usernameSchema = z
  .string()
  .trim()
  .min(1, "Username is required")
  .max(32, "Username is too long")
  .regex(/^[a-z_][a-z0-9_.-]*$/, "Enter a valid Linux username");

const credentialsSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1, "Password is required").max(256),
  otp: z
    .string()
    .trim()
    .regex(/^[0-9]{6,8}$/, "Enter the 6-digit code from your authenticator app")
    .optional()
    .or(z.literal("")),
});

export type HistoryEvent = {
  id: number;
  action: "qr_generated" | "qr_viewed" | "ovpn_downloaded";
  created_at: string;
  detail: string | null;
};

function clientIp(): string {
  const forwarded = getRequestHeader("x-forwarded-for");
  return (forwarded ?? "").split(",")[0]?.trim() || "unknown";
}

export const signIn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => credentialsSchema.parse(input))
  .handler(async ({ data }) => {
    const { createSession } = await import("./session.server");
    const { isDemoUser, checkDemoCredentials } = await import("./demo.server");

    if (isDemoUser(data.username)) {
      if (!checkDemoCredentials(data.username, data.password)) {
        throw new Error("Incorrect demo password.");
      }
      await createSession(data.username);
      return { username: data.username };
    }

    const { callAgent } = await import("./agent.server");
    await callAgent<{ ok: true }>("/v1/auth", {
      username: data.username,
      password: data.password,
      otp: data.otp || null,
      ip: clientIp(),
    });

    await createSession(data.username);
    return { username: data.username };
  });

export const signOut = createServerFn({ method: "POST" }).handler(async () => {
  const { destroySession } = await import("./session.server");
  destroySession();
  return { ok: true };
});

export const me = createServerFn({ method: "GET" }).handler(async () => {
  const { getSessionUser } = await import("./session.server");
  const user = await getSessionUser();
  return user ? { username: user.username } : null;
});

export const getTotp = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ regenerate: z.boolean() }).parse(input))
  .handler(async ({ data }) => {
    const { requireSessionUser } = await import("./session.server");
    const { isDemoUser, demoTotp } = await import("./demo.server");
    const user = await requireSessionUser();
    if (isDemoUser(user.username)) return demoTotp(data.regenerate);

    const { callAgent } = await import("./agent.server");
    return await callAgent<{
      exists: boolean;
      secret: string | null;
      otpauth_uri: string | null;
      scratch_codes: string[];
    }>(data.regenerate ? "/v1/totp/regenerate" : "/v1/totp/current", {
      username: user.username,
      ip: clientIp(),
    });
  });

export const getHistory = createServerFn({ method: "GET" }).handler(async () => {
  const { requireSessionUser } = await import("./session.server");
  const { isDemoUser, demoHistory } = await import("./demo.server");
  const user = await requireSessionUser();
  if (isDemoUser(user.username)) return demoHistory();

  const { callAgent } = await import("./agent.server");
  return await callAgent<{ events: HistoryEvent[] }>("/v1/history", {
    username: user.username,
    ip: clientIp(),
  });
});

export const getClientProfileInfo = createServerFn({ method: "GET" }).handler(async () => {
  const { requireSessionUser } = await import("./session.server");
  const { isDemoUser, demoProfileInfo } = await import("./demo.server");
  const user = await requireSessionUser();
  if (isDemoUser(user.username)) return demoProfileInfo();

  const { callAgent } = await import("./agent.server");
  return await callAgent<{ available: boolean; size_bytes: number; modified_at: string | null }>(
    "/v1/ovpn/info",
    { username: user.username, ip: clientIp() },
  );
});
