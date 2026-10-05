import { useEffect, useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { validatePassword } from "@/lib/auth/passwordValidation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyRound } from "@/components/icons";

export const Route = createFileRoute("/auth/update-password")({
  head: () => ({ meta: [
      { name: "description", content: "WaterWatch DMV update password for DC-area water access and water quality." },
      { property: "og:title", content: "Update password — WaterWatch DMV" },
      { property: "og:description", content: "WaterWatch DMV update password for DC-area water access and water quality." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
{ title: "Update password — WaterWatch DMV" }] }),
  component: UpdatePasswordPage,
});

function UpdatePasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Supabase's reset link redirects here with a recovery token in the URL hash.
  // The client SDK consumes it and fires PASSWORD_RECOVERY / SIGNED_IN.
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const issue = validatePassword(pw);
    if (issue) return setError(issue);
    if (pw !== confirm) return setError("Passwords do not match.");
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (err) return setError(err.message);
    router.navigate({ to: "/" });
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-sm">
        <h1 className="flex items-center gap-2 text-xl font-semibold mb-4 text-foreground">
          <KeyRound className="h-5 w-5 text-teal-600" />
          Set a new password
        </h1>
        {!ready ? (
          <p className="text-sm text-muted-foreground">Validating reset link…</p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pw">New password</Label>
              <Input
                id="pw"
                type="password"
                autoComplete="new-password"
                required
                value={pw}
                onChange={(e) => setPw(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm">Confirm</Label>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
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
              <KeyRound className="h-4 w-4" />
              {busy ? "Updating…" : "Update password"}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
