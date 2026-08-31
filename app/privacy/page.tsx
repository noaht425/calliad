export const metadata = { title: 'Calliad — Privacy' };

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-[var(--text-body)]">
      <h1 className="text-2xl font-semibold mb-2">Privacy Policy</h1>
      <p className="text-sm text-[var(--text-muted)] mb-8">Last updated 2026-08-30</p>

      <div className="space-y-4 text-sm leading-relaxed">
        <p>
          Calliad is a private personal assistant built and used by a single person (Noah Turner).
          It is not a public service and has no other users.
        </p>

        <h2 className="text-base font-semibold pt-4">What it accesses</h2>
        <p>
          With the owner&apos;s explicit consent, Calliad connects to:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Google (Gmail)</strong> — read-only access (<code>gmail.readonly</code>) to
            messages the owner has applied a specific label to, used only to summarise them back
            to the owner.
          </li>
          <li>
            <strong>Apple iCloud Calendar</strong> — read access to calendars the owner selects,
            to show upcoming events.
          </li>
        </ul>

        <h2 className="text-base font-semibold pt-4">How data is used and stored</h2>
        <p>
          Data retrieved from these services is used solely to provide the owner with reminders,
          a daily brief, and answers to their own questions. It is stored in a private database
          (Supabase) controlled by the owner and in an audit log for cost and behaviour
          transparency. It is <strong>never sold, never shared with third parties</strong>, and
          never used for advertising or analytics.
        </p>
        <p>
          Message and calendar text may be sent to the owner&apos;s own paid API accounts with
          Anthropic (Claude) and Google (Gemini) to generate responses, under those providers&apos;
          standard terms. No data is used to train models.
        </p>

        <h2 className="text-base font-semibold pt-4">Retention and revocation</h2>
        <p>
          The owner can disconnect any integration at any time from within the app, which deletes
          the stored connection and its synced data. Google access can also be revoked at{' '}
          <a className="underline" href="https://myaccount.google.com/permissions">
            myaccount.google.com/permissions
          </a>
          .
        </p>

        <h2 className="text-base font-semibold pt-4">Contact</h2>
        <p>noaht425@gmail.com</p>
      </div>
    </main>
  );
}
