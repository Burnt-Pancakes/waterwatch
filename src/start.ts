import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "./integrations/supabase/auth-attacher";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

/**
 * Catch-up backstop for the weekly feedback report.
 *
 * The Monday cron posts to the app URL, and a cold app server can silently
 * drop that request. On real page traffic we cheaply check whether the report
 * is overdue and, if so, fire the send without blocking the response.
 */
const weeklyFeedbackBackstop = createMiddleware().server(async ({ next, request }) => {
  try {
    const url = new URL(request.url);
    const isPageRequest =
      request.method === "GET" &&
      !url.pathname.startsWith("/api/") &&
      !url.pathname.startsWith("/_serverFn/") &&
      (request.headers.get("accept") ?? "").includes("text/html");

    if (isPageRequest) {
      void import("./lib/weeklyFeedback.server")
        .then((m) => m.maybeRunWeeklyFeedbackOnVisit())
        .catch(() => {});
    }
  } catch {
    /* never let the backstop affect the page response */
  }
  return await next();
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware, weeklyFeedbackBackstop],
  functionMiddleware: [attachSupabaseAuth],
}));
