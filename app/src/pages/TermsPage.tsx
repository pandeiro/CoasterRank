import { Link } from 'react-router-dom'

const LAST_UPDATED = 'August 27, 2026'

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl py-8">
      <h1 className="display-heading text-3xl text-ink">Terms of Service</h1>
      <p className="mt-2 text-xs text-muted">Last updated: {LAST_UPDATED}</p>

      <div className="mt-8 space-y-8 text-sm leading-7 text-muted">
        <section>
          <h2 className="mb-3 text-base font-semibold text-ink">1. Acceptance of Terms</h2>
          <p>
            By creating an account, submitting coasters, or otherwise using CoasterRank (&ldquo;the
            Service&rdquo;), you agree to these Terms of Service. If you do not agree, please do not
            use the Service.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-base font-semibold text-ink">2. Description of Service</h2>
          <p>
            CoasterRank is a free, community-driven platform for ranking roller coasters. Users can
            submit coaster information, rate and rank coasters, and view aggregated community
            rankings. The Service is operated by CoasterRank Contributors.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-base font-semibold text-ink">3. User Accounts</h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>You must provide accurate information when creating an account.</li>
            <li>You are responsible for maintaining the security of your account credentials.</li>
            <li>You may not share your account or allow others to use it.</li>
            <li>You must be at least 13 years old to create an account.</li>
            <li>One account per person — duplicate accounts may be merged or removed.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-base font-semibold text-ink">4. User Content &amp; License</h2>
          <p>
            You retain ownership of any content you submit to CoasterRank, including coaster
            submissions, ratings, reviews, and rankings (&ldquo;User Content&rdquo;).
          </p>
          <p className="mt-3">
            By submitting User Content, you grant CoasterRank Contributors a worldwide,
            non-exclusive, royalty-free license to use, display, reproduce, modify (for formatting
            purposes), and distribute your User Content under the{' '}
            <a
              href="https://creativecommons.org/licenses/by/4.0/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline transition-colors hover:text-ink"
            >
              Creative Commons Attribution 4.0 International License (CC BY 4.0)
            </a>
            . This allows the platform to display, share, and build upon your contributions while
            giving you credit as the original author.
          </p>
          <p className="mt-3">
            You can request removal of your User Content at any time by contacting us, though we may
            retain copies in backups or where already shared by others under the CC BY 4.0 license.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-base font-semibold text-ink">5. Moderation</h2>
          <p>We reserve the right to:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>Remove any User Content that violates these Terms or our community standards.</li>
            <li>Suspend or terminate accounts that engage in prohibited conduct.</li>
            <li>Edit or remove submissions that contain inaccurate or misleading information.</li>
          </ul>
          <p className="mt-3">
            We will make reasonable efforts to notify you before or after taking moderation action,
            but we are not obligated to do so in all cases.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-base font-semibold text-ink">6. Prohibited Conduct</h2>
          <p>You may not use the Service to:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>Submit false, misleading, or deliberately inaccurate information.</li>
            <li>Harass, bully, or intimidate other users.</li>
            <li>Spam, including repetitive or irrelevant submissions.</li>
            <li>Impersonate another person or entity.</li>
            <li>Scrape, mine, or bulk-extract data from the Service without permission.</li>
            <li>
              Use automated tools (bots, scripts) to interact with the Service unless authorized.
            </li>
            <li>Upload content that is illegal, hateful, or infringes on others&rsquo; rights.</li>
            <li>Attempt to gain unauthorized access to other accounts or system infrastructure.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-base font-semibold text-ink">7. Intellectual Property</h2>
          <p>
            The CoasterRank application code is released under the{' '}
            <Link to="/" className="underline transition-colors hover:text-ink">
              MIT License
            </Link>
            . The coaster reference data is released under{' '}
            <Link to="/" className="underline transition-colors hover:text-ink">
              CC BY 4.0
            </Link>
            . The CoasterRank name, logo, and design are property of CoasterRank Contributors.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-base font-semibold text-ink">8. Disclaimers</h2>
          <p>
            The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without
            warranties of any kind, whether express or implied. We do not guarantee that the Service
            will always be safe, secure, error-free, or that rankings will reflect objective truth.
            Coaster rankings are based on community opinions and should be taken as subjective.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-base font-semibold text-ink">9. Limitation of Liability</h2>
          <p>
            To the maximum extent permitted by law, CoasterRank Contributors shall not be liable for
            any indirect, incidental, special, consequential, or punitive damages arising out of
            your use of the Service. Our total liability to you for any claim arising from the
            Service shall not exceed one hundred US dollars ($100).
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-base font-semibold text-ink">10. Changes to These Terms</h2>
          <p>
            We may update these Terms from time to time. If we make material changes, we will notify
            users by posting a notice on the site. Your continued use of the Service after changes
            are posted constitutes acceptance of the updated Terms.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-base font-semibold text-ink">11. Contact</h2>
          <p>
            Questions about these Terms? Email us at{' '}
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
    </div>
  )
}
