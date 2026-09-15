import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { ShieldCheck, LockKeyhole, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { me, signIn } from "@/lib/portal.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sign in | VPN Self-Service Portal" },
      {
        name: "description",
        content:
          "Sign in with your Linux account and authenticator code to manage your VPN access.",
      },
      { property: "og:title", content: "Sign in | VPN Self-Service Portal" },
      {
        property: "og:description",
        content: "Sign in with your Linux account and authenticator code to manage your VPN access.",
      },
    ],
  }),
  beforeLoad: async () => {
    const session = await me();
    if (session) throw redirect({ to: "/dashboard" });
  },
  component: LoginPage,
});

function LoginPage() {
  const router = useRouter();
  const submit = useServerFn(signIn);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");

  const mutation = useMutation({
    mutationFn: () => submit({ data: { username: username.trim().toLowerCase(), password, otp } }),
    onSuccess: async () => {
      setPassword("");
      setOtp("");
      await router.invalidate();
      await router.navigate({ to: "/dashboard", replace: true });
    },
  });

  const errorMessage =
    mutation.error instanceof Error
      ? mutation.error.message
      : mutation.error
        ? "Sign in failed."
        : null;

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="hidden flex-col justify-between bg-header p-12 text-header-foreground lg:flex">
        <div className="flex items-center gap-2 font-semibold tracking-tight">
          <ShieldCheck className="size-5" aria-hidden />
          VPN Self-Service Portal
        </div>
        <div className="max-w-md space-y-4">
          <h1 className="text-3xl font-semibold leading-tight">
            Manage your own VPN access, securely.
          </h1>
          <p className="text-sm leading-relaxed text-header-foreground/70">
            Set up two-factor authentication, download your personal OpenVPN configuration, and
            review every action taken on your account.
          </p>
        </div>
        <p className="font-mono text-xs text-header-foreground/50">
          Authorised users only. All activity is logged.
        </p>
      </section>

      <section className="flex items-center justify-center bg-background px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <ShieldCheck className="size-5 text-primary" aria-hidden />
            <span className="font-semibold">VPN Self-Service Portal</span>
          </div>

          <h2 className="text-xl font-semibold tracking-tight">Sign in</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Use your Linux account credentials and current authenticator code.
          </p>

          <form
            className="mt-8 space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (!mutation.isPending) mutation.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="font-mono"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="otp">Authenticator code</Label>
              <Input
                id="otp"
                name="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                maxLength={8}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                className="font-mono tracking-[0.3em]"
              />
              <p className="text-xs text-muted-foreground">
                Leave empty if you have not set up an authenticator yet.
              </p>
            </div>

            {errorMessage ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            ) : null}

            <Button type="submit" className="w-full" disabled={mutation.isPending}>
              {mutation.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <LockKeyhole className="size-4" aria-hidden />
              )}
              Sign in
            </Button>
          </form>
        </div>
      </section>
    </main>
  );
}
