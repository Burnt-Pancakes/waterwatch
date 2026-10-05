import { useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { signInWithPassword, sendMagicLink } from "@/lib/auth.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogIn, Mail, UserPlus, KeyRound } from "@/components/icons";

export const Route = createFileRoute("/auth/sign-in")({
  head: () => ({ meta: [
      { name: "description", content: "WaterWatch DMV sign in for DC-area water access and water quality." },
      { property: "og:title", content: "Sign in — WaterWatch DMV" },
      { property: "og:description", content: "WaterWatch DMV sign in for DC-area water access and water quality." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
{ title: "Sign in — WaterWatch DMV" }] }),
  component: SignInPage,
});

function SignInPage() {
  const router = useRouter();
  const signIn = useServerFn(signInWithPassword);
  const magicLink = useServerFn(sendMagicLink);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [magicSent, setMagicSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { access_token, refresh_token } = await signIn({
        data: { email, password },
      });
      // Persist client-side so subsequent serverFns attach the bearer.
      await supabase.auth.setSession({ access_token, refresh_token });
      router.navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  const onMagicLink = async () => {
    setError(null);
    if (!email) {
      setError("Enter your email above first.");
      return;
    }
    setBusy(true);
    try {
      await magicLink({ data: { email, origin: window.location.origin } });
      setMagicSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send link.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm">
        <Link to="/" className="block text-center text-2xl font-bold text-foreground mb-6">
          WaterWatch DMV
        </Link>
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <h1 className="flex items-center gap-2 text-xl font-semibold mb-4 text-foreground">
            <LogIn className="h-5 w-5 text-teal-600" />
            Sign in
          </h1>
          <form onSubmit={onPasswordSubmit} className="space-y-4" data-testid="signin-form">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="signin-email"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                data-testid="signin-password"
              />
            </div>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            {magicSent && (
              <p className="text-sm text-teal-700">Magic link sent — check your email.</p>
            )}
            <Button
              type="submit"
              disabled={busy}
              className="w-full bg-teal-600 text-white shadow hover:bg-teal-700"
              data-testid="signin-submit"
            >
              <LogIn className="h-4 w-4" />
              {busy ? "Signing in…" : "Sign in"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onMagicLink}
              className="w-full border-teal-600 text-teal-700 hover:bg-teal-50 hover:text-teal-800"
            >
              <Mail className="h-4 w-4" />
              Email me a sign-in link
            </Button>
            <div className="flex justify-between text-sm">
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="gap-1.5 px-2 text-muted-foreground hover:text-foreground"
              >
                <Link to="/auth/reset-password">
                  <KeyRound className="h-3.5 w-3.5" />
                  Forgot password?
                </Link>
              </Button>
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="gap-1.5 px-2 text-teal-700 hover:bg-teal-50 hover:text-teal-800"
              >
                <Link to="/auth/sign-up">
                  <UserPlus className="h-3.5 w-3.5" />
                  Create account
                </Link>
              </Button>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}
