import { describe, expect, it } from "vitest";
import { buildStatusAlertEmail } from "./statusAlertEmail";

const OPTS = {
  siteName: "Four Mile Run",
  status: "unsafe",
  sampledAt: new Date().toISOString(),
  siteSlug: "four-mile-run",
  unsubscribeToken: "test-token-abc",
  appUrl: "https://watervoice.app",
};

describe("buildStatusAlertEmail", () => {
  it("html contains the site name", () => {
    const { html } = buildStatusAlertEmail(OPTS);
    expect(html).toContain("Four Mile Run");
  });

  it("html contains the status label", () => {
    const { html } = buildStatusAlertEmail(OPTS);
    expect(html).toContain("Unsafe");
  });

  it("html contains the unsubscribe link with the token", () => {
    const { html } = buildStatusAlertEmail(OPTS);
    expect(html).toContain("test-token-abc");
    expect(html).toContain("/api/guest-alert/unsubscribe");
  });

  it("subject contains the site name", () => {
    const { subject } = buildStatusAlertEmail(OPTS);
    expect(subject).toContain("Four Mile Run");
  });
});
