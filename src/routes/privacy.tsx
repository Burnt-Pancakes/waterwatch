import { createFileRoute, Link } from "@tanstack/react-router";
import { AppFooter } from "@/components/ui/AppFooter";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },

      { title: "Privacy Policy — WaterWatch DMV" },
      {
        name: "description",
        content: "Privacy Policy for WaterWatch DMV water quality advisory app.",
      },
      { property: "og:title", content: "Privacy Policy — WaterWatch DMV" },
      {
        property: "og:description",
        content: "Privacy Policy for WaterWatch DMV water quality advisory app.",
      },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
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
          <h1 className="text-2xl font-bold">Privacy Policy</h1>
          <p className="mt-1 text-sm text-muted-foreground">Last updated: September 2026</p>
        </div>

        <Section title="1. Information We Collect">
          <p>
            When you create an account, we collect your email address and any display name you
            provide. We collect site preferences, favorites, and alert settings you configure.
          </p>
        </Section>

        <Section title="2. How We Use Your Information">
          <p>
            We use your email to send water quality alert notifications you have explicitly
            requested. We do not sell, share, or rent your personal information to third parties.
          </p>
        </Section>

        <Section title="3. Data Storage">
          <p>
            Your data is stored securely via Supabase. We retain your data as long as your account
            is active. You may download or delete your data at any time from the Account page.
          </p>
        </Section>

        <Section title="4. Cookies and Analytics">
          <p>
            We do not use advertising cookies. We may use anonymous usage analytics to improve the
            app.
          </p>
        </Section>

        <Section title="5. Third-Party Services">
          <p>
            This app uses Supabase (database), USGS, NOAA, NWS, DOEE, and DC Water (data sources),
            and Nominatim/OpenStreetMap (geocoding). Each service has its own privacy policy.
          </p>
        </Section>

        <Section title="6. Children's Privacy">
          <p>
            This app is not directed at children under 13. We do not knowingly collect data from
            children.
          </p>
        </Section>

        <Section title="7. Feedback and Focus Group Rounds">
          <p>
            From time to time we invite people to answer short questions inside the app about what
            is useful and what is missing. Taking part is optional. You can dismiss the questions at
            any time and the app will not ask again more than twice on the same browser.
          </p>
          <p className="mt-2">
            When you answer, we store the answer you chose or typed, which page you were on, and a
            random identifier that lets us group one browser's answers together. We do not collect
            your name, email, location, or account details as part of feedback, and we do not link
            feedback to your account if you have one. Free-text answers are read by people on the
            WaterWatch team to decide what to build. They are not used to train any AI model and are
            not shared or sold.
          </p>
          <p className="mt-2">
            Feedback is kept through the end of the round and for up to twelve months after so we can
            compare rounds, then it is deleted. If you want your feedback removed sooner, email the
            contact address below and tell us roughly when you answered; we will delete the matching
            entries.
          </p>
        </Section>

        <Section title="8. Changes to This Policy">
          <p>
            We may update this policy periodically. Continued use of the app constitutes acceptance
            of the updated policy.
          </p>
        </Section>

        <Section title="9. Contact">
          <p>
            For privacy questions, contact:{" "}
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
