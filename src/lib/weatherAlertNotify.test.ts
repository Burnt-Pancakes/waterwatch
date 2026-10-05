import { describe, expect, it } from "vitest";
import { buildWeatherAlertEmail } from "./weatherAlertNotify";

const sampleAlert = {
  nws_alert_id: "urn:oid:1.2.3",
  event: "Flood Advisory",
  severity: "Minor",
  urgency: "Expected",
  headline: "Flood Advisory until 6 PM EDT",
  description: "Minor flooding in low-lying areas near waterways.",
  effective_at: "2026-06-17T10:00:00-04:00",
  expires_at: "2026-06-17T18:00:00-04:00",
  area_desc: "Prince George's County",
};

describe("buildWeatherAlertEmail", () => {
  it("includes event, site name, and advisory details in subject and body", () => {
    const { subject, html } = buildWeatherAlertEmail({
      siteName: "Bladensburg Waterfront Park",
      siteSlug: "bladensburg-waterfront-park",
      alert: sampleAlert,
      appUrl: "https://watervoice.app",
    });

    expect(subject).toBe("Weather advisory for Bladensburg Waterfront Park — Flood Advisory");
    expect(html).toContain("Flood Advisory");
    expect(html).toContain("Bladensburg Waterfront Park");
    expect(html).toContain(sampleAlert.headline!);
    expect(html).toContain(sampleAlert.description!);
    expect(html).toContain("Prince George's County");
    expect(html).toContain("https://watervoice.app/sites/bladensburg-waterfront-park");
  });

  it("omits headline and description blocks when both are null", () => {
    const { html } = buildWeatherAlertEmail({
      siteName: "Test Site",
      siteSlug: "test-site",
      alert: {
        ...sampleAlert,
        headline: null,
        description: null,
        effective_at: null,
        expires_at: null,
      },
      appUrl: "https://watervoice.app",
    });
    expect(html).not.toContain("margin:0 0 12px;font-weight:600;");
    expect(html).toContain("—");
  });
});
