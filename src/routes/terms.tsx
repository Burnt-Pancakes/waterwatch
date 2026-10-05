import { createFileRoute, Link } from "@tanstack/react-router";
import { AppFooter } from "@/components/ui/AppFooter";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },

      { title: "Terms of Use — WaterWatch DMV" },
      {
        name: "description",
        content: "Terms of Use for WaterWatch DMV water quality advisory app.",
      },
      { property: "og:title", content: "Terms of Use — WaterWatch DMV" },
      {
        property: "og:description",
        content: "Terms of Use for WaterWatch DMV water quality advisory app.",
      },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-card px-4 py-3">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <Link to="/" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            ← Back
          </Link>
          <Link to="/" className="text-base font-bold text-primary">
            WaterWatch DMV
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-8 px-4 py-8">
        <div>
          <h1 className="text-2xl font-bold">Terms of Use</h1>
          <p className="mt-1 text-sm text-muted-foreground">Last updated: June 2026</p>
        </div>

        <Section title="1. Acceptance of Terms">
          <p>
            By using WaterWatch DMV, you agree to these Terms of Use. If you do not agree, do not
            use the app.
          </p>
        </Section>

        <Section title="2. Informational Purpose Only">
          <p>
            WaterWatch DMV provides water quality, tidal, and river condition data for informational
            purposes only. Nothing in this app constitutes a safety determination, health advisory,
            or recommendation to enter any body of water.
          </p>
        </Section>

        <Section title="3. Limitation of Liability">
          <p>
            WaterWatch DMV, its developers, contributors, and data partners are not liable for any
            illness, injury, property damage, or harm of any kind arising from your use of this app
            or your decision to enter the water. Use of this app is entirely at your own risk.
          </p>
        </Section>

        <Section title="4. Third-Party Data">
          <p>
            Water quality data is sourced from third-party government agencies including DOEE, DC
            Water, USGS, NOAA, and NWS. We do not independently verify this data and are not
            responsible for its accuracy, timeliness, or completeness.
          </p>
        </Section>

        <Section title="5. No Warranty">
          <p>
            This app is provided "as is" without warranty of any kind, express or implied, including
            but not limited to warranties of accuracy, fitness for a particular purpose, or
            non-infringement.
          </p>
        </Section>

        <Section title="6. Changes to Terms">
          <p>
            We reserve the right to update these terms at any time. Continued use of the app
            constitutes acceptance of updated terms.
          </p>
        </Section>

        <Section title="7. Governing Law">
          <p>These terms are governed by the laws of the District of Columbia, United States.</p>
        </Section>

        <Section title="8. Contact">
          <p>
            For questions about these terms, contact:{" "}
            <a
              href="mailto:rajivsundar@gmail.com"
              className="text-primary underline underline-offset-4"
            >
              rajivsundar@gmail.com
            </a>
          </p>
        </Section>
      </main>

      <AppFooter />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-base font-bold text-foreground">{title}</h2>
      <div className="text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}
