# Phase 0 — concrete task list

*Derived 2026-08-30 from `specs/reconciliation.md`, `specs/hub-skeleton.md`, `specs/system-prompt-assembly.md`,
and PLAN.md §9/§14. Ordered, checkable, each task tagged **[reuse] / [adapt] / [new]** against
Doug's `dougt425/calliad`. "reuse" = copy the file ~as-is; "adapt" = start from Doug's and
change it; "new" = doesn't exist in the donor.*

## Scope (from `hub-skeleton.md` §1)

**In:** fork + prune + platform setup; the new DB tables; `brain/call.ts` (Claude, streaming,
cost, spend cap) + `brain/prompt.ts` (layered, cached, persona-prefixed); the dumb router
seam; `/chat` `/webhook` `/health` `/admin/killswitch`; the hourly heartbeat cron; the kill
switch; config + startup validation; pass the §10 acceptance test.

**Explicitly OUT of Phase 0** (→ Phase 1+): Gmail / iCloud calendar wiring, embeddings +
memory *slice* retrieval (profile.md is loaded as plain text), `profile_facts` / `open_loops`
/ `taste_log` / `people` tables, proactive triggers and nudges, the approval queue *exercised*
(schema only in Phase 0), modes, tools exposed to the brain, voice/STT/TTS, multi-user, nav
rework.

---

## Build progress (live — updated 2026-08-30)

**Code-complete and `next build`-green** on `noaht425/calliad` (commits `f520f2a` seed,
`ab76c60` Track A, `06c4390` Tracks B–E):

- ✅ **A** — forked/seeded (private repo, no upstream; full donor on branch `phase-1-reference`),
  pruned to the skeleton, deps swapped to `@anthropic-ai/sdk@0.122`, planning docs → `planning/`,
  `.env.local` scaffolded with generated hub + VAPID secrets.
- ✅ **B** — `supabase/migrations/0001_init.sql` written (not yet applied — needs live DB).
  `lib/hub/{config,audit}.ts`.
- ✅ **C** — `lib/router/{tiers,route}.ts`, `lib/brain/{prompt,call}.ts`; persona.md + trimmed
  profile.md vendored to `content/`.
- ✅ **D** — `/api/chat` (real SSE brain route), `/api/health`, `/api/admin/killswitch`,
  `/api/webhook/[source]`.
- ✅ **E** — `/api/cron/heartbeat` + `vercel.json` cron.
- ⏳ **F3/F4** — chat panel already streams SSE; kill-switch UI is read-only in settings (curl
  to set). Revisit against Doug's UI refresh.
- ⛔ **Blocked on Noah:** real `ANTHROPIC_API_KEY` + Supabase creds in `.env.local`;
  `supabase link` + apply `0001_init.sql`; then Vercel import + env vars; then **G** (run the
  §10 acceptance test — nothing has executed end-to-end yet).

---

## Pre-work — accounts (only Noah can do these; blocks everything)

- [ ] **P1. Anthropic account + key.** Separate from Noah's personal Claude. Generate an API
  key. Set **prepaid credits with auto-recharge OFF**, or a hard monthly cap — start ~$10.
- [ ] **P2. Vercel project** on Noah's account (empty for now — connected in A2).
- [ ] **P3. Supabase project** on Noah's account. Note the project URL, `anon` key, and
  `service_role` key. Enable the `pgvector` extension now (free, saves a migration in Phase 1).
- [ ] **P4. VAPID keypair** for web-push — `npx web-push generate-vapid-keys`. Keep both halves.

*Decisions #1 (host) and #4 (DB) are settled by the fork: Vercel + Supabase Postgres. #3
(Apple Reminders) is Phase 2.*

---

## Track A — Fork & platform  *(depends on: P1–P3)*

- [ ] **A1. Fork the donor.** `dougt425/calliad` → a new repo on Noah's GitHub (keep the name
  `calliad`). This is a one-time seed — set **no upstream remote**; never `git pull upstream`.
  *[reuse — the whole repo, as a starting commit]*
- [ ] **A2. Wire deploy.** Connect the repo to the Vercel project (P2); add all env vars (A5)
  in the Vercel dashboard; confirm a clean build deploys.
- [ ] **A3. Prune the tree.** Delete what Phase 0–1 doesn't use, get it building green:
  - `lib/`: `abentfork.ts`, `alexa-*.ts`, `amazon.ts`, `unsubscribe-detector.ts`,
    `trip-*.ts`, `tmdb.ts`, `curation-*.ts`, `icloud-contacts.ts`, `vcard-parse.ts`,
    `calendar-detector.ts`, `todo-detector.ts`, `action-executor.ts`, `og-fetch.ts`,
    `projectColors.ts`.
  - `app/`: the `trips/`, `projects/`, `family/`, `people/`, `shopping/`, `watchlist/`,
    `unsubscribes/`, `folders/`, `birthdays/`, `search/`, `share-target/`, `inbox/` page
    routes and their `app/api/*` counterparts.
  - `app/api/`: `abentfork/`, `alexa/`, `amazon/`, `contacts/`, `unsubscribes/`,
    `trips/`, `projects/`, `sync/intelligence/`, `today/briefing/`, `watch-list/`,
    `reading-list/`, `calendar/`, `gmail/` (Gmail comes back in Phase 1 — keep a copy on a
    branch), `cron/watch-list-refresh/`, `cron/remind/`.
  - `supabase/`: keep `schema.sql` (captures/folders — Phase 1 ingestion staging) and
    `push-schema.sql`; the rest (`trips`, `projects`, `alexa`, `gmail`, `unsubscribes`,
    `profile`, `folders-rename`, `project-domain`) can go.
  - **Keep:** `app/layout.tsx`, `manifest.json`, `public/sw.js`, `next.config.ts`,
    `lib/auth.tsx`, `lib/supabase.ts`, `lib/supabase.server.ts`, `lib/db.ts` (Dexie offline
    queue — harmless), `lib/context.ts` (skeleton for `brain/prompt.ts` layer 4),
    `lib/types.ts`, `components/{GlobalChatPanel,PushSetup,BottomNav,GlobalCaptureBar}.tsx`,
    `app/login/page.tsx`, `app/page.tsx`, `app/api/push/subscribe/route.ts`.
  *[adapt — deletion pass]*
- [ ] **A4. Trim `BottomNav.tsx`** to just what exists (Today + Settings), or hide it. No full
  nav rework in Phase 0. *[adapt]*
- [ ] **A5. Config + startup validation.** `lib/config.ts` — read env, **fail loudly at
  startup / first request if any required var is missing** (Doug has none). Phase 0 vars:
  `ANTHROPIC_API_KEY`, `SPEND_CAP_USD_MONTH` (default `10`), `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_SECRET`,
  `WEBHOOK_SECRET`, `CRON_SECRET`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  `TZ_DEFAULT` (`America/New_York`). *(Phase 1 adds `GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_AI_KEY`
  for embeddings; Phase 3 adds `GROQ_API_KEY`.)* *[new]*
- [ ] **A6. Add `@anthropic-ai/sdk`** to `package.json`; remove `@google/generative-ai`,
  `groq`, `groq-sdk` (return in later phases). *[adapt]*

---

## Track B — Data model  *(depends on: P3, A1)*

- [ ] **B1. Adopt Supabase CLI migrations.** `supabase/migrations/` + `supabase db push` in CI
  — not hand-run SQL in the dashboard (Doug's method). *[new]*
- [ ] **B2. `0001_init.sql`** — the Phase 0 tables from `hub-skeleton.md` §3, verbatim:
  `config`, `conversations` (id/surface/started_at/last_at/title — **replaces** Doug's flat
  `conversations` table), `messages`, `audit_log`, `model_calls`, `actions` (schema only).
  Add RLS policies + `grant ... to service_role` in the style of Doug's `schema.sql`. Single
  user, so RLS is `auth.uid() = user_id` or a hardcoded allow for the service role.
  Indexes: `idx_messages_conv`, `idx_audit_ts`, `idx_audit_kind`, `idx_model_calls_ts`. *[new]*
- [ ] **B3. Seed `config`.** Rows: `killswitch_level='off'`,
  `spend_cap_usd_month=<SPEND_CAP_USD_MONTH>`, `spend_month='YYYY-MM'` (current),
  `spend_month_to_date_usd='0'`. *[new]*
- [ ] **B4. `lib/memory/db.ts`** — thin helpers over `adminClient` for `config` get/set,
  `conversations`/`messages` read+write, and the append-only `audit_log` / `model_calls`
  writers. No ORM. *[new]*

---

## Track C — Router + brain  *(depends on: A5, A6, B4)*

- [ ] **C1. `router/tiers.ts`** — T0/T1/T2/T3 definitions, model IDs, price table, and a
  `anthropicCostUsd()` helper. **Draft ready:** `specs/drafts/tiers.ts` — prices verified
  against `platform.claude.com/docs/.../pricing` on 2026-08-30 (Sonnet 5 $2/$10 in/out, now
  permanent; Opus 5 $5/$25; Haiku 4.5 $1/$5; cache write 1.25×/2×, cache read 0.1× base
  input). Re-verify at build + add a test that fails on drift. T1 Gemini rate still a TODO in
  the draft. *[new]*
- [ ] **C2. `brain/prompt.ts`** — layered assembly per `system-prompt-assembly.md`, Phase 0
  subset:
  - Layer 1–2 (frozen): `persona.md` v1.0 in full (identity, voice principles, anti-pattern
    list, nudge-tone rules, 18-example few-shot) + the §3 operating rules → one `system`
    block with a `cache_control` breakpoint after it.
  - Layer 3: all of `profile.md` **except** the `inputs/` file-list refs and the Music
    deep-dive subsection → second `cache_control` breakpoint.
  - Layer 4 (fresh): current date/time + zone (`TZ_DEFAULT`), last ~10–20 turns from
    `messages`.
  - Layer 7: Noah's message (or, for the heartbeat, nothing — heartbeat never calls the brain).
  - No modes, no tools, no profile *slice*. Ship the `<untrusted>` fence helper but leave it
    unused. Record which layers/ids went in, in the `model_call` audit payload.
  Start from `lib/context.ts`'s parallel-fetch shape for layer 4. *[adapt → mostly new]*
- [ ] **C3. `brain/call.ts`** — the Claude call wrapper (`hub-skeleton.md` §6):
  1. **Spend-cap pre-check**: roll `config.spend_month` if the month changed (reset MTD → 0);
     if `spend_month_to_date_usd >= spend_cap_usd_month` → proactive: defer + log `spend_cap`;
     direct message: downgrade to T1, or if already T1 proceed and have the reply note the cap;
     always log `spend_cap`.
  2. Assemble via `brain/prompt.ts`.
  3. Call `@anthropic-ai/sdk` **streaming**, `max_tokens` sized to purpose, 2 retries with
     backoff on transient errors.
  4. Capture `usage` — `input_tokens`, `output_tokens`, `cache_read_input_tokens`,
     `cache_creation_input_tokens` (**verify these field names against the SDK**,
     `system-prompt-assembly.md` §11); compute `cost_usd` from `tiers.ts`; measure latency.
  5. Write a `model_calls` row + an `audit_log` `model_call` entry; increment
     `spend_month_to_date_usd`.
  6. Return the stream to the caller.
  7. Hard failure after retries → log `error`, return the in-persona fallback
     ("Something broke on my end, try that again in a minute."). *[new]*
- [ ] **C4. `router/route.ts`** — `InboundEvent → RouteDecision` (`hub-skeleton.md` §5):
  - Kill-switch first: `pause_all` → drop proactive (log), one-line "I'm paused" to a direct
    message; `pause_proactive` → drop proactive, messages proceed.
  - Phase 0 body is deliberately dumb: any inbound message →
    `{handled:'brain', tier:'T2', mode:'default', tools:[], persona:'full', reason:'phase0 passthrough'}`.
    Heartbeat trigger → `{handled:'rule', …}`, writes an audit row, no model call.
  - Log the full decision as `route_decision`. *[new]*

---

## Track D — HTTP surface  *(depends on: C3, C4)*

- [ ] **D1. `POST /api/chat`** — replace Doug's Gemini route. Auth = Supabase bearer (single
  user = Noah). Body `{text, conversationId?}` → create a `conversations` row if none →
  `route()` → `brain.call()` → **SSE stream** the reply to the client → save user + assistant
  `messages` rows → emit `inbound_message`, `route_decision`, `model_call`, `outbound_message`
  audit rows in that order. *[adapt — same URL, new internals]*
- [ ] **D2. `POST /api/webhook/[source]`** — check a per-source secret (`WEBHOOK_SECRET` for
  now), log `trigger_fired`, return `200`. No processing. *[new]*
- [ ] **D3. `GET /api/health`** — `200 {ok:true, killswitch:<level>, spendMonthToDate:<usd>}`.
  No auth. *[new]*
- [ ] **D4. `POST /api/admin/killswitch`** — check `ADMIN_SECRET`; body
  `{level:'off'|'pause_proactive'|'pause_all'}` → update `config` → log `killswitch` (old →
  new, actor). *[new]*

---

## Track E — Scheduler  *(depends on: B4, A2)*

- [ ] **E1. `vercel.json` `crons`** — one entry, hourly, hitting `POST /api/cron/heartbeat`.
  Scheduling lives **in the repo**, unlike Doug's out-of-tree setup. *[new]*
- [ ] **E2. `app/api/cron/heartbeat/route.ts`** — check `CRON_SECRET` (header or
  `Authorization: Bearer`, matching Doug's pattern), write one `audit_log` `trigger_fired`
  row (`job:'heartbeat'`), return `200`. Proof the scheduler is alive. *[adapt — Doug's cron
  auth pattern, trivial body]*

---

## Track F — Persona & PWA surface  *(depends on: A3, D1)*

- [ ] **F1. Land `persona.md` in the repo** (e.g. `content/persona.md`) and load it in
  `brain/prompt.ts` layer 1. Confirm it sits **above** the first cache breakpoint. *[new]*
- [ ] **F2. Land the trimmed `profile.md`** (or load from `~/Desktop/Calliad/profile.md` at
  build/deploy) for layer 3. Decide: vendored copy in-repo vs. an env-pointed path. Phase 0:
  vendored copy is simplest. *[new]*
- [ ] **F3. Point `GlobalChatPanel.tsx` at `/api/chat`** and **consume the SSE stream** (Doug's
  panel is request/response — it awaits `assistantCapture.transcript`). Render tokens as they
  arrive. Strip / hide the voice-note button and browser-TTS for Phase 0. *[adapt]*
- [ ] **F4. Kill-switch reachability.** Phase 0 can be `curl` against `/api/admin/killswitch`;
  optionally a single toggle on `app/settings/page.tsx`. Document the curl in the README. *[new]*
- [ ] **F5. Strip the PWA precache of dead routes** — `next.config.ts` `@ducanh2912/next-pwa`
  config is fine as-is; just confirm no build warnings after the A3 prune. *[reuse]*

---

## Track G — Acceptance  *(depends on: all of D + E + F)*

- [ ] **G1. Run the `hub-skeleton.md` §10 seven-step test** end to end on the deployed app:
  1. `POST /api/chat {text:"what's my week look like"}` with the bearer →
  2. `route_decision` logged as `T2 / default / phase0 passthrough` →
  3. brain assembles (persona + trimmed profile), calls `claude-sonnet-5`, **streams an
     in-persona reply** →
  4. `model_calls` has a row with input/output token counts and non-zero `cost_usd` →
  5. `audit_log` contains, in order: `inbound_message`, `route_decision`, `model_call`,
     `outbound_message` →
  6. `POST /api/admin/killswitch {level:'pause_all'}` → next `/chat` returns the paused reply,
     logs `killswitch` then `outbound_message` →
  7. set `SPEND_CAP_USD_MONTH=0.001`, redeploy, send a message → reply still comes (downgraded
     or with a note), `spend_cap` logged.
- [ ] **G2. Cache check.** Send two messages in one session; confirm
  `usage.cache_read_input_tokens > 0` on the second (`system-prompt-assembly.md` §2). If it's
  zero, audit the prefix for a silent invalidator (timestamp above a breakpoint, etc.).
- [ ] **G3. Persona spot-check.** The reply reads like `persona.md` — no "I'd be happy to
  help", no listicle to a conversational question, dry, short-by-default. If not, the few-shot
  isn't landing above the breakpoint or `max_tokens` is too tight.
- [ ] **G4. Tag Phase 0 done** in the repo; open the Phase 1 checklist (Gmail + iCloud
  calendar + memory tables + syllabus ingestion + morning brief).

---

## Suggested order

```
P1–P4  (accounts — parallel, do first)
  └─ A1 → A2 → A3 → A4 → A5 → A6        (fork & prune to green build)
        ├─ B1 → B2 → B3 → B4            (schema)
        └─ C1 ─┐
           C2 ─┤ (brain — C2/C3 can go in parallel once C1 + B4 land)
           C3 ─┘
              └─ C4 → D1 → D2/D3/D4     (router then HTTP)
                    └─ E1 → E2          (scheduler)
                    └─ F1 → F2 → F3 → F4 → F5   (persona + surface)
                          └─ G1 → G2 → G3 → G4  (acceptance)
```

Critical path is **A → C2/C3 → D1 → G1**. B, E, F hang off it and can be done by a second pass
or in parallel.

## Refresh-proof drafts (done 2026-08-30, in `specs/drafts/`)

These don't touch Doug's UI and drop straight into the fork once it exists:

- `0001_init.sql` — the six Phase 0 tables (`config`, `conversations`, `messages`, `audit_log`,
  `model_calls`, `actions`) with RLS enabled + `service_role` grants; `audit_log` / `model_calls`
  get INSERT/SELECT only (append-only by grant). → task **B2/B3**.
- `tiers.ts` — tier map + verified Anthropic price table + `anthropicCostUsd()`. → task **C1**.
- `brain-prompt.ts` — layered assembly skeleton: persona+rules cached block, profile cached
  block, fresh current-state, the turn; `fenceUntrusted()` helper. → task **C2**.
- `brain-call.ts` — call-wrapper skeleton: month-roll + spend-cap pre-check (defer vs
  downgrade), streaming loop with 2 retries, `usage`→`anthropicCostUsd`→`model_calls` +
  `audit_log` + MTD increment, in-persona fallback. → task **C3**.
- `router-route.ts` — `route(InboundEvent) → RouteDecision`: kill-switch first (pause_all →
  drop proactive / paused one-liner to Noah; pause_proactive → drop proactive), then the Phase
  0 dumb body (message → T2 passthrough, heartbeat → rule/audit-only). Logs `route_decision`
  itself. → task **C4**.
- `health-route.ts` — `GET /api/health`, unauth, `force-dynamic`: `{ok, killswitch,
  spendMonthToDate, spendCap, spendMonth}`; 503 (not 500) on DB flakiness. → task **D3**.
- `admin-killswitch-route.ts` — `POST /api/admin/killswitch` (`x-admin-secret`), validates
  level, updates `config`, logs `killswitch` (previous → level); bonus `GET` for the current
  level. → task **D4**.

They have `TODO` markers where fork-specific wiring is needed (Supabase client import,
persona/profile file delivery, SDK streaming-shape confirmation).

## Micro-decisions folded in (change if you disagree)

| # | Decision | Picked |
|---|---|---|
| a | Repo name | keep `calliad`, new repo under Noah's account, no upstream remote |
| b | Migrations | Supabase CLI (`supabase/migrations/` + `db push`), not dashboard SQL |
| c | `/chat` auth | Supabase bearer (single user) — not a separate shared secret |
| d | Doug's flat `conversations` table | replaced by the spec's `conversations` + `messages` pair |
| e | `profile.md` / `persona.md` delivery | vendored copies in-repo for Phase 0; env-pointed path is a Phase 1 nicety |
| f | T1 provider in `tiers.ts` | defined now, wired in Phase 1 (no Gemini calls in Phase 0) |
