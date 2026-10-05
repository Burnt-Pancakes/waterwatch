import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * Client-side auth state with the canonical Supabase pattern:
 *   1) Subscribe to onAuthStateChange FIRST.
 *   2) Then call getSession() to seed the initial state.
 *
 * Doing it in this order avoids missing an auth event that fires while
 * the initial session fetch is in flight.
 *
 * SECURITY NOTE: this hook is for UI state only (nav avatar, redirects).
 * Never use the returned `user` to authorize data access — server
 * functions guarded by `requireSupabaseAuth` are the trust boundary.
 */
export function useAuth(): {
  user: User | null;
  session: Session | null;
  loading: boolean;
} {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  return { user: session?.user ?? null, session, loading };
}
