import { Link, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Heart, Bell, MapPin, UserRound } from "@/components/icons";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

/**
 * Top-right auth slot. Renders a "Sign in" CTA when logged out and an
 * avatar + dropdown (Favorites / My Alerts / Account / Sign out) when
 * logged in. State comes from `useAuth`; sign-out invalidates every
 * query so user-scoped caches don't leak to the next visitor.
 */
export function AuthNav() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();

  if (loading) {
    return <div className="h-9 w-9 rounded-full bg-muted/40" aria-hidden />;
  }

  if (!user) {
    return (
      <Link
        to="/auth/sign-in"
        data-testid="nav-sign-in"
        aria-label="Sign in"
        title="Sign in"
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-teal-600 px-3 text-white transition-colors hover:bg-teal-700 dark:bg-teal-500 dark:hover:bg-teal-600"
      >
        <UserRound size={16} aria-hidden />
        <span className="text-sm font-medium">Sign In</span>
      </Link>
    );
  }

  const initials = (user.email ?? "?").split("@")[0].slice(0, 2).toUpperCase();

  const onSignOut = async () => {
    await supabase.auth.signOut();
    queryClient.clear();
    router.invalidate();
    router.navigate({ to: "/" });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-600 text-white transition-colors hover:bg-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-teal-500 dark:hover:bg-teal-600"
          data-testid="nav-user-menu"
          aria-label="Account menu"
        >
          <Avatar className="h-7 w-7">
            <AvatarFallback className="bg-transparent text-white text-xs font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate">{user.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/favorites" className="flex items-center gap-2">
            <Heart className="h-4 w-4 text-teal-600" fill="currentColor" /> Favorites
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid="nav-my-spots"
          onClick={() => {
            if (typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent("watervoice:open-my-spots"));
            }
          }}
          className="flex items-center gap-2"
        >
          <MapPin className="h-4 w-4 text-violet-600" /> My spots
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/alerts" className="flex items-center gap-2">
            <Bell className="h-4 w-4" /> My alerts
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/account" className="flex items-center gap-2">
            <UserRound className="h-4 w-4" /> Account
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={onSignOut}
          data-testid="nav-sign-out"
          className="flex items-center gap-2 text-destructive hover:!bg-red-50 hover:!text-destructive focus:!bg-red-50 focus:!text-destructive"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
