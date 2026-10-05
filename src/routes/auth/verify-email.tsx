import { useEffect } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth/verify-email")({
  head: () => ({ meta: [
      { name: "description", content: "WaterWatch DMV verifying email for DC-area water access and water quality." },
      { property: "og:title", content: "Verifying email — WaterWatch DMV" },
      { property: "og:description", content: "WaterWatch DMV verifying email for DC-area water access and water quality." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
{ title: "Verifying email — WaterWatch DMV" }] }),
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
  const router = useRouter();
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        toast.success("Email verified — alerts active");
        router.navigate({ to: "/" });
      }
    });
    return () => subscription.unsubscribe();
  }, [router]);
  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4">
      <p className="text-sm text-muted-foreground">Verifying your email…</p>
    </main>
  );
}
