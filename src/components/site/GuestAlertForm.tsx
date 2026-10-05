import { useState } from "react";
import { Bell, CheckCircle } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface GuestAlertFormProps {
  siteId: string;
  siteName: string;
}

export function GuestAlertForm({ siteId, siteName }: GuestAlertFormProps) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");
    setErrorMsg(null);

    try {
      const res = await fetch("/api/guest-alert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, siteId }),
      });

      if (res.status === 429) {
        setStatus("error");
        setErrorMsg("Too many requests. Please try again later.");
        return;
      }
      if (!res.ok) {
        setStatus("error");
        setErrorMsg("Could not save subscription. Please try again.");
        return;
      }

      setStatus("success");
    } catch {
      setStatus("error");
      setErrorMsg("Network error. Please try again.");
    }
  };

  if (status === "success") {
    return (
      <div
        data-testid="guest-alert-success"
        className="mt-3 flex items-center gap-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950 dark:text-green-300"
      >
        <CheckCircle size={16} aria-hidden />
        Check your inbox for a confirmation email.
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} data-testid="guest-alert-form" className="mt-3 space-y-2">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Bell size={13} aria-hidden />
        Get alerted when {siteName} status changes
      </p>
      <div className="flex gap-2">
        <Input
          type="email"
          placeholder="your@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          data-testid="guest-alert-email"
          className="h-8 text-sm"
        />
        <Button
          type="submit"
          size="sm"
          disabled={status === "loading"}
          data-testid="guest-alert-submit"
          className="h-8 shrink-0"
        >
          {status === "loading" ? "…" : "Alert me"}
        </Button>
      </div>
      {errorMsg && (
        <p data-testid="guest-alert-error" className="text-xs text-destructive">
          {errorMsg}
        </p>
      )}
    </form>
  );
}
