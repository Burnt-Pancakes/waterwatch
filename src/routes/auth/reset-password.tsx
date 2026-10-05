import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { sendPasswordReset } from "@/lib/auth.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Send, ArrowLeft, KeyRound } from "@/components/icons";

export const Route = createFileRoute("/auth/reset-password")({
  head: () => ({ meta: [
      { name: "description", content: "WaterWatch DMV reset password for DC-area water access and water quality." },
      { property: "og:title", content: "Reset password — WaterWatch DMV" },
      { property: "og:description", content: "WaterWatch DMV reset password for DC-area water access and water quality." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
{ title: "Reset password — WaterWatch DMV" }] }),
  component: ResetPage,
});

function ResetPage() {
  const reset = useServerFn(sendPasswordReset);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await reset({ data: { email, origin: window.location.origin } });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send reset email.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-sm">
        <h1 className="flex items-center gap-2 text-xl font-semibold mb-4 text-foreground">
          <KeyRound className="h-5 w-5 text-teal-600" />
          Reset your password
        </h1>
        {sent ? (
          <p className="text-sm text-muted-foreground" data-testid="reset-sent">
            If an account exists for that email, a reset link has been sent.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4" data-testid="reset-form">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="reset-email"
              />
            </div>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <Button
              type="submit"
              disabled={busy}
              className="w-full bg-teal-600 text-white shadow hover:bg-teal-700"
            >
              <Send className="h-4 w-4" />
              {busy ? "Sending…" : "Send reset link"}
            </Button>
          </form>
        )}
        <p className="mt-4 text-sm text-center">
          <Link
            to="/auth/sign-in"
            className="inline-flex items-center gap-1 text-teal-700 hover:underline"
          >
            <ArrowLeft className="h-4 w-4" /> Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
