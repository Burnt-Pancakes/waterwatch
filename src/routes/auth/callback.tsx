import { useEffect } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth/callback")({
  head: () => ({ meta: [
      { name: "description", content: "WaterWatch DMV signing you in for DC-area water access and water quality." },
      { property: "og:title", content: "Signing you in — WaterWatch DMV" },
      { property: "og:description", content: "WaterWatch DMV signing you in for DC-area water access and water quality." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
{ title: "Signing you in — WaterWatch DMV" }] }),
  component: CallbackPage,
});

function CallbackPage() {
  const router = useRouter();
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") router.navigate({ to: "/" });
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.navigate({ to: "/" });
    });
    return () => subscription.unsubscribe();
  }, [router]);
  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4">
      <p className="text-sm text-muted-foreground">Signing you in…</p>
    </main>
  );
}
