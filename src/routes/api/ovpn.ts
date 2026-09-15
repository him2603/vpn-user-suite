import { createFileRoute } from "@tanstack/react-router";

/**
 * Authenticated download of the signed-in user's own .ovpn profile.
 * The username is taken from the signed session cookie only — it is never
 * accepted from the request, so one user can never fetch another's profile.
 */
export const Route = createFileRoute("/api/ovpn")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getSessionUser } = await import("@/lib/session.server");
        const { callAgent, AgentError } = await import("@/lib/agent.server");

        const user = await getSessionUser(request.headers.get("cookie"));
        if (!user) return new Response("Unauthorized", { status: 401 });

        const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "unknown";

        try {
          const result = await callAgent<{ filename: string; content_b64: string }>("/v1/ovpn", {
            username: user.username,
            ip,
          });
          const content = atob(result.content_b64);
          const safeName = result.filename.replace(/[^A-Za-z0-9._-]/g, "_");

          return new Response(content, {
            headers: {
              "content-type": "application/x-openvpn-profile",
              "content-disposition": `attachment; filename="${safeName}"`,
              "cache-control": "no-store",
              "x-content-type-options": "nosniff",
            },
          });
        } catch (error) {
          const status = error instanceof AgentError ? error.status : 500;
          const message =
            error instanceof AgentError ? error.message : "Could not fetch your profile.";
          return new Response(message, { status, headers: { "cache-control": "no-store" } });
        }
      },
    },
  },
});
