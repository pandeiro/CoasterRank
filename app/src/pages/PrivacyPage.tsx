import { Link } from 'react-router-dom'

const LAST_UPDATED = 'August 27, 2026'

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl py-8">
      <h1 className="display-heading text-3xl text-ink">Privacy Policy</h1>
      <p className="mt-2 text-xs text-muted">Last updated: {LAST_UPDATED}</p>

      <div className="mt-8 space-y-8 text-sm leading-7 text-muted">
        <section>
          <h2 className="mb-3 text-base font-semibold text-ink">1. Introduction</h2>
          <p>
            This Privacy Policy explains how CoasterRank Contributors (&ldquo;we&rdquo;,
            &ldquo;us&rdquo;, or &ldquo;our&rdquo;) collects, uses, and protects your personal
            information when you use CoasterRank (&ldquo;the Service&rdquo;). By using the Service,
            you agree to the collection and use of information as described here.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-base font-semibold text-ink">2. Information We Collect</h2>
          <p>We collect the following information:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="text-ink">Account information:</strong> Your email address and
              display name, provided when you create an account via Supabase authentication.
            </li>
            <li>
              <strong className="text-ink">User Content:</strong> Coaster submissions, ratings,
              rankings, and any other content you contribute to the Service.
            </li>
            <li>
              <strong className="text-ink">Server logs:</strong> Standard web server log data
              including IP address, browser type, operating system, and access timestamps. These are
              collected automatically by our hosting providers.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-base font-semibold text-ink">3. How We Use Your Information</h2>
          <p>We use the information we collect to:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>Provide, operate, and maintain the Service.</li>
            <li>Create and manage your account.</li>
            <li>Display your profile name alongside your rankings and submissions.</li>
            <li>Prevent abuse, spam, and unauthorized access.</li>
            <li>Improve the Service and develop new features.</li>
            <li>Communicate with you about your account or service updates.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-base font-semibold text-ink">4. Cookies &amp; Tracking</h2>
          <p>
            CoasterRank uses essential cookies to maintain your login session. We do not currently
            use third-party analytics trackers, advertising cookies, or cross-site tracking
            technologies.
          </p>
          <p className="mt-3">
            If we add privacy-friendly analytics in the future (such as Cloudflare Web Analytics),
            we will update this policy and provide appropriate notice.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-base font-semibold text-ink">5. Data Sharing</h2>
          <p>
            We do not sell your personal information. We share data only in the following
            circumstances:
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="text-ink">Service providers:</strong> We use Supabase for
              authentication and database hosting. Their use of data is governed by their own
              privacy policy.
            </li>
            <li>
              <strong className="text-ink">Legal requirements:</strong> We may disclose information
              if required by law, regulation, or legal process.
            </li>
            <li>
              <strong className="text-ink">User Content:</strong> Your submissions and rankings are
              visible to other users and licensed under{' '}
              <a
                href="https://creativecommons.org/licenses/by/4.0/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline transition-colors hover:text-ink"
              >
                CC BY 4.0
              </a>
              , meaning others may share and adapt your contributions with attribution.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-base font-semibold text-ink">6. Data Retention</h2>
          <p>
            We retain your account information and User Content for as long as your account is
            active. If you delete your account, we will remove your personal information within a
            reasonable timeframe, though residual copies may exist in backups for a limited period.
          </p>
          <p className="mt-3">
            User Content that has been shared or adapted by others under the CC BY 4.0 license may
            persist beyond account deletion.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-base font-semibold text-ink">7. Your Rights</h2>
          <p>You have the right to:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>Access the personal information we hold about you.</li>
            <li>Correct inaccurate personal information.</li>
            <li>Request deletion of your account and personal data.</li>
            <li>Export your data in a portable format.</li>
            <li>Object to or restrict certain processing of your data.</li>
          </ul>
          <p className="mt-3">
            To exercise any of these rights, email us at{' '}
            <a
              href="mailto:coaster.rank.app@gmail.com"
              className="underline transition-colors hover:text-ink"
            >
              coaster.rank.app@gmail.com
            </a>
            . We will respond within 30 days.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-base font-semibold text-ink">8. Children&rsquo;s Privacy</h2>
          <p>
            CoasterRank is not directed at children under 13. We do not knowingly collect personal
            information from children under 13. If you believe a child has provided us with personal
            information, please contact us and we will remove it.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-base font-semibold text-ink">9. International Users</h2>
          <p>
            CoasterRank is operated from the United States. If you access the Service from outside
            the US, your information may be transferred to and processed in the US. By using the
            Service, you consent to such transfers.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-base font-semibold text-ink">10. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. If we make material changes, we
            will post a notice on the site and update the &ldquo;Last updated&rdquo; date above.
            Continued use of the Service after changes are posted constitutes acceptance of the
            updated policy.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-base font-semibold text-ink">11. Contact</h2>
          <p>
            For privacy-related questions or requests, email us at{' '}
            <a
              href="mailto:coaster.rank.app@gmail.com"
              className="underline transition-colors hover:text-ink"
            >
              coaster.rank.app@gmail.com
            </a>
            .
          </p>
        </section>
      </div>

      <div className="mt-12 border-t border-line pt-6">
        <Link to="/terms" className="text-xs text-muted underline transition-colors hover:text-ink">
          View Terms of Service
        </Link>
      </div>
    </div>
  )
}
