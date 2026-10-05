import { useEffect, useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "@/components/icons";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  getUserProfile,
  updateUserProfile,
  listUserAlerts,
  deleteUserAlertById,
  deleteUserAccount,
} from "@/lib/userProfile.functions";
import { formatTriggerOn } from "@/lib/alertTriggers";

export const Route = createFileRoute("/_authenticated/account")({
  head: () => ({ meta: [
      { name: "description", content: "WaterWatch DMV account for DC-area water access and water quality." },
      { property: "og:title", content: "Account — WaterWatch DMV" },
      { property: "og:description", content: "WaterWatch DMV account for DC-area water access and water quality." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
{ title: "Account — WaterWatch DMV" }] }),
  component: AccountPage,
});

export function AccountPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();

  // Server function stubs
  const fetchProfile = useServerFn(getUserProfile);
  const saveProfile = useServerFn(updateUserProfile);
  const fetchAlerts = useServerFn(listUserAlerts);
  const doDeleteAlert = useServerFn(deleteUserAlertById);
  const doDeleteAccount = useServerFn(deleteUserAccount);

  // ── Profile state ──────────────────────────────────────────────────────────
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["user-profile"],
    queryFn: () => fetchProfile({ data: undefined }),
    staleTime: 60_000,
  });

  const [displayName, setDisplayName] = useState("");
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name ?? "");
      setEmailAlerts(profile.email_alerts_enabled ?? true);
    }
  }, [profile]);

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    try {
      await saveProfile({
        data: { displayName: displayName || null, emailAlertsEnabled: emailAlerts },
      });
      void qc.invalidateQueries({ queryKey: ["user-profile"] });
      toast.success("Profile updated");
    } catch {
      toast.error("Failed to save — try again");
    } finally {
      setSavingProfile(false);
    }
  };

  // ── Alerts state ───────────────────────────────────────────────────────────
  const { data: alerts, isLoading: alertsLoading } = useQuery({
    queryKey: ["user-alerts"],
    queryFn: () => fetchAlerts({ data: undefined }),
    staleTime: 60_000,
  });

  const handleDeleteAlert = async (alertId: string, siteName: string) => {
    try {
      await doDeleteAlert({ data: { alertId } });
      void qc.invalidateQueries({ queryKey: ["user-alerts"] });
      toast.success(`Alert removed for ${siteName}`);
    } catch {
      toast.error("Could not remove alert");
    }
  };

  // ── Download data ──────────────────────────────────────────────────────────
  const handleDownload = () => {
    if (typeof window === "undefined") return;
    const payload = {
      exportedAt: new Date().toISOString(),
      userEmail: user?.email ?? null,
      alerts: alerts ?? [],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "watervoice-my-data.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Sign out ───────────────────────────────────────────────────────────────
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    void router.navigate({ to: "/" });
  };

  // ── Delete account ─────────────────────────────────────────────────────────
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDeleteAccount = async () => {
    setDeleting(true);
    try {
      await doDeleteAccount({ data: undefined });
      await supabase.auth.signOut();
      void router.navigate({ to: "/" });
    } catch {
      toast.error("Could not delete account — please try again");
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  return (
    <main className="min-h-screen bg-background pb-24 text-foreground dark:bg-gray-900">
      <header className="sticky top-0 z-10 border-b border-border bg-card px-4 py-3">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <Link to="/" className="text-base font-bold text-primary">
            WaterWatch DMV
          </Link>
          <h1 className="text-base font-semibold">Account</h1>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-5 px-4 py-5">
        {/* ── A. Profile ─────────────────────────────────────────────────── */}
        <Card title="Profile">
          {profileLoading ? (
            <div className="space-y-3 animate-pulse">
              <div className="h-9 rounded bg-muted/50" />
              <div className="h-9 rounded bg-muted/50" />
            </div>
          ) : (
            <div className="space-y-3">
              <Field label="Display name">
                <input
                  type="text"
                  data-testid="profile-display-name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name (optional)"
                  maxLength={80}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-2 focus:outline-offset-2 focus:outline-teal-600 dark:bg-gray-700 dark:text-white"
                />
              </Field>
              <Field label="Email">
                <input
                  type="email"
                  value={user?.email ?? ""}
                  readOnly
                  aria-label="Email address (read-only)"
                  className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground"
                />
              </Field>
              <button
                type="button"
                onClick={handleSaveProfile}
                disabled={savingProfile}
                className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-800 disabled:opacity-50 focus:outline-2 focus:outline-offset-2 focus:outline-teal-600"
              >
                {savingProfile ? "Saving…" : "Save"}
              </button>
            </div>
          )}
        </Card>

        {/* ── B. Notifications ─────────────────────────────────────────── */}
        <Card title="Notifications">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              data-testid="email-alerts-toggle"
              checked={emailAlerts}
              onChange={(e) => {
                setEmailAlerts(e.target.checked);
                void saveProfile({ data: { emailAlertsEnabled: e.target.checked } }).then(() => {
                  void qc.invalidateQueries({ queryKey: ["user-profile"] });
                });
              }}
              className="mt-0.5 h-4 w-4 rounded border-border accent-teal-700"
            />
            <span className="text-sm">
              <span className="font-medium">Email alerts enabled</span>
              <br />
              <span className="text-muted-foreground">
                Receive email when water quality changes at your saved sites.
              </span>
            </span>
          </label>
        </Card>

        {/* ── C. My Alerts ─────────────────────────────────────────────── */}
        <Card title="My Alerts">
          {alertsLoading ? (
            <div className="space-y-2 animate-pulse">
              <div className="h-10 rounded bg-muted/50" />
              <div className="h-10 rounded bg-muted/50" />
            </div>
          ) : !alerts || alerts.length === 0 ? (
            <p data-testid="alerts-empty-state" className="text-sm text-muted-foreground">
              No alerts set. Tap the bell icon on any site to create one.
            </p>
          ) : (
            <ul className="space-y-2">
              {alerts.map((alert) => (
                <li
                  key={alert.id}
                  className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{alert.siteName}</p>
                    <p className="text-xs text-muted-foreground">
                      Notify on: {formatTriggerOn(alert.triggerOn)}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove alert for ${alert.siteName}`}
                    onClick={() => handleDeleteAlert(alert.id, alert.siteName)}
                    className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus:outline-2 focus:outline-offset-2 focus:outline-teal-600"
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* ── D. Data and Privacy ──────────────────────────────────────── */}
        <Card title="Data & Privacy">
          <div className="space-y-3">
            <button
              type="button"
              onClick={handleDownload}
              className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-muted focus:outline-2 focus:outline-offset-2 focus:outline-teal-600"
            >
              Download my data (JSON)
            </button>
            <div className="flex gap-4 text-sm">
              <a href="/terms" className="text-primary underline-offset-4 hover:underline">
                Terms of Use
              </a>
              <a href="/privacy" className="text-primary underline-offset-4 hover:underline">
                Privacy Policy
              </a>
            </div>
          </div>
        </Card>

        {/* ── E. Danger Zone ───────────────────────────────────────────── */}
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
          <h2 className="mb-3 text-sm font-bold text-red-700 dark:text-red-400">Danger Zone</h2>
          <div className="space-y-2">
            <button
              type="button"
              data-testid="sign-out-btn"
              onClick={handleSignOut}
              className="w-full rounded-md border border-teal-700 px-4 py-2 text-sm font-medium text-teal-700 transition-colors hover:bg-teal-50 dark:border-teal-500 dark:text-teal-400 dark:hover:bg-teal-950 focus:outline-2 focus:outline-offset-2 focus:outline-teal-600"
            >
              Sign out
            </button>
            <button
              type="button"
              data-testid="delete-account-btn"
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full rounded-md border border-red-500 px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-100 dark:border-red-400 dark:text-red-400 dark:hover:bg-red-950 focus:outline-2 focus:outline-offset-2 focus:outline-red-500"
            >
              Delete account
            </button>
          </div>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl dark:bg-gray-900">
            <h2 id="delete-dialog-title" className="text-base font-bold text-foreground">
              Delete your account?
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              This will permanently delete your account, favorites, and alerts. This cannot be
              undone.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="flex-1 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="delete-account-confirm-btn"
                onClick={handleDeleteAccount}
                disabled={deleting}
                className="flex-1 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm dark:bg-gray-800">
      <h2 className="mb-3 text-sm font-bold text-teal-700 dark:text-teal-400">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground dark:text-gray-300">
        {label}
      </label>
      {children}
    </div>
  );
}
