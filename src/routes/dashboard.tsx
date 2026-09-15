import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  ShieldCheck,
  LogOut,
  QrCode,
  RefreshCw,
  Download,
  FileDown,
  History,
  Loader2,
  AlertTriangle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

import {
  getClientProfileInfo,
  getHistory,
  getTotp,
  me,
  signOut,
  type HistoryEvent,
} from "@/lib/portal.functions";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "My VPN access | Self-Service Portal" },
      {
        name: "description",
        content:
          "Generate your Google Authenticator QR code, download your OpenVPN profile and review your activity history.",
      },
      { property: "og:title", content: "My VPN access | Self-Service Portal" },
      {
        property: "og:description",
        content: "Generate your authenticator QR code and download your OpenVPN profile.",
      },
    ],
  }),
  beforeLoad: async () => {
    const session = await me();
    if (!session) throw redirect({ to: "/" });
    return { session };
  },
  loader: ({ context }) => context.session,
  component: Dashboard,
});

type TotpResult = {
  exists: boolean;
  secret: string | null;
  otpauth_uri: string | null;
  scratch_codes: string[];
};

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function Dashboard() {
  const { username } = Route.useLoaderData();
  const router = useRouter();
  const queryClient = useQueryClient();

  const logout = useServerFn(signOut);
  const totpFn = useServerFn(getTotp);
  const historyFn = useServerFn(getHistory);
  const profileFn = useServerFn(getClientProfileInfo);

  const [totp, setTotp] = useState<TotpResult | null>(null);

  const historyQuery = useQuery({
    queryKey: ["history"],
    queryFn: () => historyFn(),
  });

  const profileQuery = useQuery({
    queryKey: ["profile-info"],
    queryFn: () => profileFn(),
  });

  const totpMutation = useMutation({
    mutationFn: (regenerate: boolean) => totpFn({ data: { regenerate } }),
    onSuccess: (result, regenerate) => {
      setTotp(result);
      if (regenerate) {
        toast.success("New authenticator secret created. Scan the QR code now.");
      } else if (!result.exists) {
        toast.info("No authenticator is set up yet. Generate a new QR code.");
      }
      void queryClient.invalidateQueries({ queryKey: ["history"] });
    },
    onError: (error) => toast.error(errorText(error, "Could not load your authenticator.")),
  });

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await logout();
    await router.invalidate();
    await router.navigate({ to: "/", replace: true });
  }

  async function handleDownload() {
    try {
      const response = await fetch("/api/ovpn", { credentials: "same-origin" });
      if (!response.ok) {
        toast.error(await response.text());
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${username}.ovpn`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success("Your OpenVPN profile has been downloaded.");
      void queryClient.invalidateQueries({ queryKey: ["history"] });
    } catch {
      toast.error("Download failed. Please try again.");
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-sidebar-border bg-header text-header-foreground">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2 font-semibold tracking-tight">
            <ShieldCheck className="size-5" aria-hidden />
            VPN Self-Service Portal
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden font-mono text-sm text-header-foreground/70 sm:inline">
              {username}
            </span>
            <Button variant="secondary" size="sm" onClick={handleSignOut}>
              <LogOut className="size-4" aria-hidden />
              Log out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        <section>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome back, {username}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your two-factor authentication and download your personal VPN configuration.
          </p>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="shadow-panel">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <QrCode className="size-4 text-primary" aria-hidden />
                Google Authenticator
              </CardTitle>
              <CardDescription>
                Show the QR code already registered for your account, or replace it with a new one.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => totpMutation.mutate(false)}
                  disabled={totpMutation.isPending}
                >
                  {totpMutation.isPending && totpMutation.variables === false ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <QrCode className="size-4" aria-hidden />
                  )}
                  Show existing QR
                </Button>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button disabled={totpMutation.isPending}>
                      <RefreshCw className="size-4" aria-hidden />
                      Generate new QR
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Replace your authenticator secret?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Your current authenticator codes will stop working immediately. You will
                        need to scan the new QR code before your next VPN connection or sign-in.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => totpMutation.mutate(true)}>
                        Generate new secret
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>

              {totp && !totp.exists ? (
                <Alert>
                  <AlertTriangle className="size-4" aria-hidden />
                  <AlertDescription>
                    No authenticator secret exists yet for your account. Use “Generate new QR”.
                  </AlertDescription>
                </Alert>
              ) : null}

              {totp?.otpauth_uri && totp.secret ? (
                <TotpPanel uri={totp.otpauth_uri} secret={totp.secret} codes={totp.scratch_codes} />
              ) : null}
            </CardContent>
          </Card>

          <Card className="shadow-panel">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileDown className="size-4 text-primary" aria-hidden />
                Your client file
              </CardTitle>
              <CardDescription>
                Download the OpenVPN configuration issued to your account.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md border border-border bg-muted/60 p-4">
                <p className="font-mono text-sm">{username}.ovpn</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {profileQuery.isPending
                    ? "Checking availability…"
                    : profileQuery.data?.available
                      ? `${(profileQuery.data.size_bytes / 1024).toFixed(1)} KB · updated ${
                          profileQuery.data.modified_at
                            ? new Date(profileQuery.data.modified_at).toLocaleString()
                            : "unknown"
                        }`
                      : "No configuration file is available for your account yet."}
                </p>
              </div>

              <Button
                onClick={handleDownload}
                disabled={!profileQuery.data?.available}
                className="w-full sm:w-auto"
              >
                <Download className="size-4" aria-hidden />
                Download my .ovpn file
              </Button>

              <p className="text-xs text-muted-foreground">
                Keep this file private — it contains the keys that identify you on the VPN.
              </p>
            </CardContent>
          </Card>
        </div>

        <Card className="shadow-panel">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="size-4 text-primary" aria-hidden />
              Activity history
            </CardTitle>
            <CardDescription>
              Every QR code generation and configuration download recorded for your account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HistoryTable
              events={historyQuery.data?.events ?? []}
              loading={historyQuery.isPending}
              error={historyQuery.error ? errorText(historyQuery.error, "Could not load history.") : null}
            />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function TotpPanel({ uri, secret, codes }: { uri: string; secret: string; codes: string[] }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const QRCode = (await import("qrcode")).default;
      const png = await QRCode.toDataURL(uri, { margin: 1, width: 240, errorCorrectionLevel: "M" });
      if (active) setDataUrl(png);
    })();
    return () => {
      active = false;
    };
  }, [uri]);

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex size-[240px] shrink-0 items-center justify-center rounded-md border border-border bg-white">
          {dataUrl ? (
            <img src={dataUrl} alt="Google Authenticator setup QR code" width={240} height={240} />
          ) : (
            <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
          )}
        </div>
        <div className="min-w-0 space-y-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Setup key
            </p>
            <p className="mt-1 break-all font-mono text-sm">{secret}</p>
          </div>
          <Separator />
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Emergency scratch codes
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {codes.length ? (
                codes.map((code) => (
                  <Badge key={code} variant="secondary" className="font-mono">
                    {code}
                  </Badge>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">None available</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const ACTION_LABELS: Record<HistoryEvent["action"], string> = {
  qr_generated: "New QR generated",
  qr_viewed: "Existing QR viewed",
  ovpn_downloaded: "Client file downloaded",
};

function HistoryTable({
  events,
  loading,
  error,
}: {
  events: HistoryEvent[];
  loading: boolean;
  error: string | null;
}) {
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (loading) {
    return <p className="py-6 text-sm text-muted-foreground">Loading activity…</p>;
  }
  if (!events.length) {
    return <p className="py-6 text-sm text-muted-foreground">No activity recorded yet.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[220px]">Date &amp; time</TableHead>
          <TableHead>Action</TableHead>
          <TableHead className="hidden sm:table-cell">Details</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.map((event) => (
          <TableRow key={event.id}>
            <TableCell className="font-mono text-xs">
              {new Date(event.created_at).toLocaleString()}
            </TableCell>
            <TableCell>
              <Badge
                variant={event.action === "ovpn_downloaded" ? "secondary" : "outline"}
                className="font-normal"
              >
                {ACTION_LABELS[event.action] ?? event.action}
              </Badge>
            </TableCell>
            <TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell">
              {event.detail ?? "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
