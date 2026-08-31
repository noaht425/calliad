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
- `TurnState.integrations` → `prompt.ts` renders a fresh layer-4 "Live data" block (events
  plain, email `<untrusted>`-fenced) after the cache breakpoints. Always emitted — when the
  window is empty it says so and forbids inventing a schedule from profile class-times.
  `/api/chat` fetches `getIntegrationContext` (next 14d events + 8 recent labeled emails).
- New operating rules: no thinking out loud; Live data is ground truth, profile is reference.
- Multi-calendar iCloud: `metadata.calendars = [{url,name}]`, per-calendar prune,
  disconnect/re-pick in Settings.
- **Recurrence:** `fetchCalendarObjects({ expand: true })` — iCloud returns concrete instances;
  row key `uid::start`. iCloud CalDAV can't see subscribed ("Other") calendars or the auto
  Birthdays calendar (ICS-URL subscribe = possible follow-up).
- **Ignore-list:** `IGNORE_TITLE_SUBSTRINGS` in `icloud-calendar.ts` drops stale open-ended
  recurrences (old piano/trumpet lessons, house cleaners). Extend as they surface.

### ✅ Class schedule materialised (`lib/integrations/schedule.ts`)
- Noah's classes live only in his transcript. `materializeSchedule(userId)` generates dated
  `calendar_events` rows (`source: 'schedule'`) for every meeting Sep 8 – Dec 14 (4 classes +
  Wed counseling), skipping Trinity Days / Thanksgiving, DST-correct ET→UTC. Flows into the
  brain like any other event. `POST /api/integrations {what:'schedule'}` + Settings "reload".
  **Greek course time still TBD** — add to `CLASSES` and reload when set.

### ✅ Morning brief
- `lib/brief/compose.ts` — today+week from `getIntegrationContext` + last 6 turns → brain
  (`purpose:brief`, proactive, T2, 600 tok) → persisted as a `cron` conversation. `occasion`
  'scheduled' | 'manual' varies the framing (manual drops "morning brief").
- `lib/hub/push.ts` — web-push helper (VAPID, prunes 410s).
- `/api/cron/brief` — daily 12:00 UTC (8am EDT / 7am EST), after `/api/cron/sync` 11:00,
  heartbeat 10:00. CRON_SECRET + kill-switch + quiet-hours guarded. Pushes + audits.
- `/api/brief` — bearer manual run (`?push=1`). "Run morning brief now" button in Settings.
- **Home surfacing:** `/api/brief/latest` (most recent cron conversation, last 18h) →
  `Chat.tsx` loads it on mount, so the home screen opens on today's brief and replies thread
  onto it. Tapping the push now lands somewhere useful.
- **Weather + news:** `lib/brief/extras.ts` — Open-Meteo (no key; Hartford coords, swap when
  Noah's not in term) + NPR/BBC RSS (no key, last ~30h, deduped top 6). Failure-tolerant.
  `composeBrief` appends a fenced extras block; instruction asks for a one-line weather note
  + 2–3 headlines.

### ✅ Working memory + T1 (Gemini)
- `0003_memory.sql` — `open_loops`, `profile_facts`, `taste_log`.
- `lib/llm/gemini.ts` — T1 tier: `gemini-3.5-flash-lite` (2.5 retired for new keys) JSON classifier, records a
  `model_calls` row (`tier T1`), no-op without `GOOGLE_AI_KEY`.
- `lib/memory/{loops,detect}.ts` — `relevantLoops` / `upsertLoop` (title-merge) /
  `setLoopStatus`; `detectLoopsFromTurn` runs a cheap T1 pass after each chat turn and
  files open loops (fire-and-forget from `/api/chat`).
- Open loops rendered into the brain ("Open loops" block) + the brief.
- `/api/loops` (GET / POST manual / PATCH done|dropped|due_at) + Settings list.
- Prompt cache TTL bumped 5m → **1h** (bursty usage shares one ~$0.03 prefix write).
- **Tasks UI (2026-08-31):** a real `/tasks` page (4th nav tab) over the same
  `open_loops` store — add box, grouped Overdue / Today / This week / Later / No
  date, tap-circle to complete, +1d / +1w / today / tomorrow to (re)schedule,
  drop. Syllabus deadlines show here too. Chat "add a task" now runs
  `lib/actions/task.ts::extractTask` (T1) for a clean title + a due date when one
  is stated ("call the dentist tomorrow" → dated; "buy printer ink" → not).
  (Apple Reminders was tried and reverted — Apple blocks CalDAV reads of
  "upgraded" lists; see the reverted commit.)

### ✅ Nudge v1
- `0004_nudges.sql` — `open_loops.last_nudged_at`.
- `lib/memory/loops.ts::loopsDueForNudge` — open dated loops inside the deadline window
  (exam-type 72h / else 48h), not yet nudged; `markNudged`.
- `lib/nudge/compose.ts` — nudges the single most-urgent loop, one next action, calm
  (persona reminder-tone rules), T2, persisted; `{force}` previews any dated loop without
  marking.
- `/api/cron/nudge` 18:00 UTC + `/api/nudge` manual (`?force=1`). Settings "Run nudge check".
- **Cron consolidation** (Hobby caps at 2): `/api/cron/brief` now runs sync → brief at 12:00;
  `/api/cron/nudge` at 18:00. `heartbeat`/`sync` routes kept for manual/external use.

### ✅ Medication check-in (2026-08-31)
Persona/profile say Calliad should *actively* ask ("did you take your meds?") since Noah never
ticks the Apple Reminders box — but nothing triggered it. Now:
- `0009_med_log.sql` — one row per day (`sent_count`, `taken`, `taken_at`, `note`).
- `lib/health/meds.ts` — `medCheckin({followUp})` (push, ≤2/day, skips once confirmed),
  `recordMed`, `classifyMedReply` (took / not-yet), `medContextLine` (a per-turn brain line
  when the check-in's outstanding).
- `/api/chat` catches "took my meds" / "not yet" / a bare "yes" while a check-in is open →
  `recordMed`, short reply; otherwise `medStatus` rides in the prompt so the brain can raise
  it once, gently, in context.
- `/api/cron/med` (external ping ~11am — Hobby's 2 crons are used) + the 18:00 nudge cron runs
  a `followUp` backstop. `/api/med` (GET status/history, `?checkin=1` test, POST answer) +
  Settings "Medication" (14-day dot strip, quick "took it", test check-in).

### ✅ Syllabus ingestion (pattern C — the anchor engine)
- `0005_documents.sql` — `documents` (kind/course/raw_text/extracted).
- `lib/ingest/syllabus.ts` — PDF (native Claude `document` block) or text → Sonnet →
  strict JSON `{course, exams[], assignments[], grading[], notes}`; records a `model_calls`
  row (T2/extract); files dated exams+assignments as `open_loops` (`source:'syllabus'`,
  tagged `<course>`+`exam|assignment`). Clean-replace per course on re-ingest.
- `/api/ingest/syllabus` (multipart PDF or JSON `{text}`; GET lists). Settings upload +
  list. `test/stand-in-syllabus-CLCV-390.pdf` placeholder — Noah swaps in real syllabi.
- Verified: both exams w/ dates+topics, 3 dated papers + weekly-responses (null date),
  full grading. Deadlines flow into brief + nudge automatically.

### ✅ Frictionless capture
- `0006_lists.sql` — `list_items` (kind reading|watch|link, url unique/user).
- `lib/capture/link.ts` — OG/twitter meta (Chrome UA, full meta parser) + YouTube/Vimeo
  oEmbed title fallback; kind from host/og:type; T1 neutral descriptor (subject+scope,
  never the thesis — pattern M) w/ og:description fallback; dedupe on url.
- `/api/chat` handles a bare/short URL inline (no model call) → captured + confirmed;
  `detectLoopsFromTurn` told to skip bookmarked links.
- `/api/capture` (GET/POST/PATCH) — also accepts `x-capture-token` == `CAPTURE_TOKEN`
  (resolves to `CAPTURE_USER_EMAIL`) for an **iOS Shortcut** (PWA share_target doesn't
  work on iOS). `/share-target` page kept for Android/other.
- `/reading` page + BottomNav entry.

### Also this session
- **Password login** — `/login` does email+password (`signInWithPassword`), code as fallback;
  "Set password" in Settings (`updateUser`). Supabase free tier can't edit email templates
  (no SMTP) → magic link can't become a code, and iOS opens the link in Safari whose session
  never reaches the installed PWA. Password sidesteps both.
- **Dropped `@ducanh2912/next-pwa`** — its Workbox precache served stale pages after every
  deploy and its worker overwrote `public/sw.js` (push). App is online-only. Install +
  share-target from `manifest.json`; `public/sw.js` (push) registered by `PushSetup`.

### ⏭ Next (Phase 1 tail / Phase 2)
- [ ] Profile *slice* by intent + `profile_facts` propose→confirm.
- [ ] Cheap-win Q&A (fits with the Phase 2 router).

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

### ✅ A Bent Fork recipe tool (2026-08-31)
Noah's own site (`abentfork.com`, Next.js) has no search API but clean JSON-LD Recipe schema
on every page and a full sitemap.
- `lib/tools/recipes.ts` — `getIndex()` (sitemap → slug list, 1h cache), `searchRecipes(q)`
  (token match on slugs, stop-worded), `getRecipe(slugOrUrl)` (fetch page → parse
  `application/ld+json` Recipe → name / ingredients / steps / prep-cook-total / yield /
  cuisine). `runRecipe(q)`: one strong match → pull the full recipe; several → list them;
  none → say it's not one of his, offer general help flagged as not-ABF.
- `/api/chat` — `isRecipeQuery` ("recipe for X", "how do I make X", "what can I make with X",
  "substitute for X in Y") → `toolResult`. Block tells the model to give the recipe faithfully
  and only help *around* it (subs, scaling, technique).
- Verified: "cacio e pepe" → full recipe; "chicken tikka" → right match first.
