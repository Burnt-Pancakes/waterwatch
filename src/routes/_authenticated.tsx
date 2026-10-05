import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

/**
 * Protected layout. We re-validate with `getUser()` (not `getSession`) so
 * the gate trusts the Auth server. Server functions called from children
 * remain protected by `requireSupabaseAuth` — this layout is the UX
 * shortcut, not the trust boundary.
 */
export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/auth/sign-in" });
    }
  },
  component: () => <Outlet />,
});
