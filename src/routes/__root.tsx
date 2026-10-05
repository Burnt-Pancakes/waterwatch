import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { BottomTabBar } from "@/components/ui/BottomTabBar";
import { FirstUseDisclaimer } from "@/components/ui/FirstUseDisclaimer";
import { InstallPrompt } from "@/components/ui/InstallPrompt";
import { FocusGroup } from "@/components/focusGroup/FocusGroup";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { title: "WaterWatch DMV" },
      { name: "theme-color", content: "#00695C" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { name: "apple-mobile-web-app-title", content: "WaterWatch DMV" },
      {
        name: "description",
        content:
          "Paddlers, kayakers, and families in the DC Metro Area have no quick, plain-language answer to the question: Is it safe to get in the water today? This helps.",
      },
      { name: "author", content: "Lovable" },
      { property: "og:title", content: "WaterWatch DMV" },
      {
        property: "og:description",
        content:
          "Paddlers, kayakers, and families in the DC Metro Area have no quick, plain-language answer to the question: Is it safe to get in the water today? This helps.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "WaterWatch DMV" },
      {
        name: "twitter:description",
        content:
          "Paddlers, kayakers, and families in the DC Metro Area have no quick, plain-language answer to the question: Is it safe to get in the water today? This helps.",
      },
      {
        property: "og:image",
        content:
          "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/2c67fdb5-4386-4a2e-8275-61b4c07ff005",
      },
      {
        name: "twitter:image",
        content:
          "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/2c67fdb5-4386-4a2e-8275-61b4c07ff005",
      },
      {
        name: "description",
        content:
          "DC Water Watch provides real-time fecal bacteria advisories for DC Metro water access points.",
      },
      {
        property: "og:description",
        content:
          "DC Water Watch provides real-time fecal bacteria advisories for DC Metro water access points.",
      },
      {
        name: "twitter:description",
        content:
          "DC Water Watch provides real-time fecal bacteria advisories for DC Metro water access points.",
      },
      {
        property: "og:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/9f7a03b6-cf0e-4504-ae84-34917dfef0d4/id-preview-3dc9c6ae--29b73689-ffd3-4244-8dc7-8cba22d39c96.lovable.app-1780061162609.png",
      },
      {
        name: "twitter:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/9f7a03b6-cf0e-4504-ae84-34917dfef0d4/id-preview-3dc9c6ae--29b73689-ffd3-4244-8dc7-8cba22d39c96.lovable.app-1780061162609.png",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.json" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <RootContent />
    </QueryClientProvider>
  );
}

function RootContent() {
  const router = useRouter();
  const qc = useQueryClient();

  // Invalidate router + queries on auth changes so user-scoped data
  // doesn't leak across sessions. Wired ONCE at the root.
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      router.invalidate();
      qc.invalidateQueries();
    });
    return () => subscription.unsubscribe();
  }, [router, qc]);

  return (
    <>
      <Outlet />
      <Toaster />
      <BottomTabBar />
      <FocusGroup />
      <FirstUseDisclaimer />
      <InstallPrompt />
    </>
  );
}
