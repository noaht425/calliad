# Phase 1 — read-only awareness + the anchor

*Started 2026-08-30, on top of `phase-0`. PLAN.md §9. Reuses OAuth/CalDAV from branch
`phase-1-reference`.*

## Progress

### ✅ Integrations — Gmail (one label) + iCloud calendar  *(code done; needs Noah's setup + `0002` migration + deploy)*
- `supabase/migrations/0002_integrations.sql` — `connected_services`, `calendar_events`, `email_items`.
- `lib/integrations/icloud-calendar.ts` — restored from `phase-1-reference` (CalDAV, iCal parser,
  `syncCalendarEvents`: −7d → +365d window, upsert on `(user_id,uid)`, prune vanished events).
- `lib/integrations/gmail.ts` — **trimmed** (no travel parsing): OAuth + token refresh (Doug's
  pattern), `scanGmailLabel()` pulls `label:<label> newer_than:30d` into `email_items`. Default
  label `Calliad`, stored in `connected_services.metadata.label`.
- `lib/integrations/context.ts` — `getIntegrationContext(userId)` → `{ events[], emails[] }`,
  the awareness slice for the brief/nudges (not wired into the brain yet).
- Routes: `/api/auth/gmail/{authorize,callback}`, `/api/auth/icloud/connect` (test → pick
  calendar → save), `/api/integrations` (GET status+counts+preview, POST `{what}` = sync now),
  `/api/cron/sync` (CRON_SECRET; GET for Vercel Cron, POST for external pingers).
- `vercel.json` — added `/api/cron/sync` daily `0 11 * * *` (Hobby-plan cron limit → daily;
  finer cadence via an external pinger or the brief-triggered sync).
- Settings page — Connect Gmail / Connect iCloud / Sync now / counts.
- Deps: `googleapis` + `tsdav` back in.

### ✅ Calendar + mail wired into the brain
- `TurnState.integrations` → `prompt.ts` renders a fresh layer-4 block (events plain,
  email `<untrusted>`-fenced) after the cache breakpoints. `/api/chat` fetches
  `getIntegrationContext` (next 14d events + 8 recent labeled emails) per turn.
- Multi-calendar iCloud: `metadata.calendars = [{url,name}]`, per-calendar prune,
  disconnect/re-pick in Settings. iCloud CalDAV can't see subscribed ("Other")
  calendars or the auto Birthdays calendar — an "add calendar by ICS URL" option is a
  possible follow-up if a needed feed lives there.

### ⏭ Next
- [ ] Morning brief — cron + endpoint, composes from calendar + mail + open loops.
- [ ] Memory tables `0003` — `profile_facts`, `open_loops`, `taste_log`; profile *slice* by intent.
- [ ] Syllabus ingestion (build against a stand-in PDF; real syllabi later).
- [ ] Morning brief cron; nudge v1 (assignment 48h / exam 72h).
- [ ] T1 = Gemini wired (`GOOGLE_AI_KEY`).
- [ ] Frictionless capture (link → reading list); cheap-win Q&A.

## Setup Noah must do (for the integrations to work)

1. **Apply `0002`** — Supabase → SQL Editor → paste `supabase/migrations/0002_integrations.sql` → Run.
2. **Google Cloud OAuth client** (for Gmail):
   - console.cloud.google.com → new project "calliad" → APIs & Services → **Enable "Gmail API"**.
   - OAuth consent screen → External → app name "Calliad", your email; add scope
     `.../auth/gmail.readonly`; add yourself as a Test user.
   - Credentials → Create OAuth client ID → **Web application** → Authorized redirect URI:
     `https://calliad-psi.vercel.app/api/auth/gmail/callback` → create.
   - Copy the client ID + secret → `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `.env.local`
     **and** Vercel env (Production). Also set `NEXT_PUBLIC_APP_URL=https://calliad-psi.vercel.app`.
3. **Gmail label** — in Gmail, make a label `Calliad` and a filter that applies it to whatever
   you want Calliad to see (start narrow — e.g. from your professors / a course list).
4. **Apple app-specific password** (for iCloud calendar) — appleid.apple.com → Sign-In & Security
   → App-Specific Passwords → generate one, label it "Calliad". (Needs 2FA on the Apple ID.)
5. **Deploy**, then in the app → **Settings → Integrations**: Connect Gmail (OAuth), Connect
   iCloud (Apple ID + that app password → pick your calendar), **Sync now**.
6. Verify: `GET /api/integrations` (with your bearer) shows both connected and non-zero counts.
