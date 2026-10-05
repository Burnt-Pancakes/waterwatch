import { useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { signUpUser } from "@/lib/auth.functions";
import { validatePassword } from "@/lib/auth/passwordValidation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserPlus, ArrowLeft, Mail } from "@/components/icons";

export const Route = createFileRoute("/auth/sign-up")({
  head: () => ({
    meta: [
      { property: "og:title", content: "Sign up — WaterWatch DMV" },
      { property: "og:description", content: "WaterWatch DMV sign up for DC-area water access and water quality." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },

      { title: "Sign up — WaterWatch DMV" },
      {
        name: "description",
        content:
          "Create a free WaterWatch DMV account to save favorite launches and receive water quality alerts.",
      },
    ],
  }),
  component: SignUpPage,
});

function SignUpPage() {
  const router = useRouter();
  const signUp = useServerFn(signUpUser);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const passwordIssue = password ? validatePassword(password) : null;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const issue = validatePassword(password);
    if (issue) {
      setError(issue);
      return;
    }
    setBusy(true);
    try {
      const res = await signUp({
        data: { email, password, origin: window.location.origin },
      });
      setSent(res.email);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign-up failed.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <AuthShell title="Check your email" icon={<Mail className="h-5 w-5 text-teal-600" />}>
        <p className="text-sm text-muted-foreground" data-testid="signup-success">
          Verification link sent to <span className="font-medium text-foreground">{sent}</span>.
          Click the link in that email to activate your account.
        </p>
        <Button
          variant="link"
          className="mt-4 px-0"
          onClick={() => router.navigate({ to: "/auth/sign-in" })}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to sign in
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Create your account" icon={<UserPlus className="h-5 w-5 text-teal-600" />}>
      <form onSubmit={onSubmit} className="space-y-4" data-testid="signup-form">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid="signup-email"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-testid="signup-password"
          />
          <p className="text-xs text-muted-foreground">
            At least 8 characters, with one uppercase letter and one number.
          </p>
          {passwordIssue && (
            <p className="text-xs text-destructive" role="alert">
              {passwordIssue}
            </p>
          )}
        </div>
        {error && (
          <p className="text-sm text-destructive" role="alert" data-testid="signup-error">
            {error}
          </p>
        )}
        <Button
          type="submit"
          disabled={busy}
          className="w-full bg-teal-600 text-white shadow hover:bg-teal-700"
        >
          <UserPlus className="h-4 w-4" />
          {busy ? "Creating account…" : "Create account"}
        </Button>
        <p className="text-xs text-muted-foreground">
          By creating an account you agree to our{" "}
          <Link to="/" className="underline">
            Terms
          </Link>{" "}
          and{" "}
          <Link to="/" className="underline">
            Privacy Policy
          </Link>
          .
        </p>
        <p className="text-sm text-center text-muted-foreground">
          Already have an account?{" "}
          <Link to="/auth/sign-in" className="font-medium text-teal-700 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}

function AuthShell({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm">
        <Link to="/" className="block text-center text-2xl font-bold text-foreground mb-6">
          WaterWatch DMV
        </Link>
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <h1 className="flex items-center gap-2 text-xl font-semibold mb-4 text-foreground">
            {icon}
            {title}
          </h1>
          {children}
        </div>
      </div>
    </main>
  );
}
