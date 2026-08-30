# Spec — §12 reconciliation against Doug's Calliad

*Written 2026-08-30 against `dougt425/calliad` @ `563a9b6` (last commit 2026-08-30 08:11 -0700).
This is the "what turns §3 modules from new to reuse" pass called for in PLAN.md §12. Read
alongside PLAN.md §3/§8/§11 and the two Phase 0 specs.*

---

## 0. Headline

Doug's Calliad is a **Next.js 16 app on Vercel + Supabase**, not an always-on hub, and its
brain runs on **Google Gemini + Groq, not Anthropic**. The reusable value is real but it's in
the *shell and the plumbing*, not the brain:

- **Reuse nearly as-is:** the PWA shell (installable, service worker, push), Supabase auth,
  web-push notification delivery, Gmail OAuth + token-refresh, **iCloud CalDAV calendar**
  (read + write + sync — settled 2026-08-30, Noah's household is on iPhones and doesn't use
  Google Calendar), the cron-endpoint pattern, the "feed a document → LLM → structured JSON"
  extraction shape, the `getUserContext` fan-out, `pgvector` + `gemini-embedding-001` for
  retrieval.
- **Adapt heavily:** the LLM call layer (provider swap Gemini→Claude for everything
  reasoning-shaped — keep Gemini for embeddings, Groq for STT — plus tiers, caching, cost
  accounting the plan wants and the repo lacks), the system-prompt assembly (flat string
  today), the data model (Doug's is travel-shaped), the "action card" mechanism (it's a
  suggestion/confirm loop, not a general auth gate).
- **Build new:** audit log, spend cap, kill switch, router seam, graduated-authorization gate,
  memory *slice* retrieval, syllabus ingestion, morning brief in persona, everything in §8
  Phase 2+.
- **Missing vs. the plan's assumptions:** any inbound webhook receiver, Gmail Pub/Sub push
  (Doug **polls**), a persona/few-shot layer, an in-repo scheduler (crons are triggered from
  *outside* the repo). The plan assumed Google Calendar — **corrected to iCloud CalDAV**,
  which Doug already has, so this is a net *gain* (calendar drops from "new" to "reuse"), with
  one tradeoff: no push, so "Calendar watch" becomes a polling sweep.

Recommendation on decision #9 is in §5: **fork as a donor repo, adopt its architecture
(Next/Vercel/Supabase), no upstream relationship.**

---

## 1. Doug's actual stack (measured, not assumed)

| Layer | What it is |
|---|---|
| Framework | Next.js `16.3.1` (App Router, `runtime = 'nodejs'` on API routes), React 19 |
| Host | Vercel (serverless functions; `maxDuration` bumped to 120–300s on the heavy routes) |
| DB | Supabase Postgres + `pgvector` (768-dim `gemini-embedding-001`). RLS on every table; `adminClient` (service role) bypasses RLS server-side |
| Client store | Dexie / IndexedDB — offline capture queue only (`lib/db.ts`) |
| Auth | Supabase Auth, **email OTP** (`signInWithOtp` / `verifyOtp`). Bearer token in `Authorization` header on every API call |
| PWA | `@ducanh2912/next-pwa` (Workbox) for offline/precache + a hand-written `public/sw.js` for push. `manifest.json` with `share_target` |
| Push | `web-push` + VAPID. Subscriptions in `push_subscriptions`; delivery loop lives in the cron routes |
| LLM | **Google Gemini** — `gemini-3.6-flash` (chat, extraction, briefing), `gemini-2.5-flash-lite` (cheap classification), `gemini-embedding-001` (embeddings). SDK: `@google/generative-ai` |
| STT | **Groq** `whisper-large-v3-turbo` (`groq-sdk`) — `/api/chat/transcribe`, `/api/transcribe` |
| TTS | Browser `SpeechSynthesisUtterance` client-side + a voice picker. No server TTS, no Piper |
| Calendar | **iCloud CalDAV** via `tsdav` — Apple ID + app-specific password. **No Google Calendar anywhere** |
| Email | Gmail API (`googleapis`), scope `gmail.readonly` only. Poll-based scan, no Pub/Sub |
| Other integrations | Alexa shopping lists (`alexa-cookie2`), iCloud Contacts (CardDAV), TMDB (watch-list enrichment), abentfork.com push (outbound) |
| Scheduling | **Not in the repo.** Cron routes exist and are guarded by `CRON_SECRET`; whatever pings them (Vercel Cron dashboard config or an external pinger) is outside the tree — `vercel.json` is `{}` |
| Prompt assembly | `lib/context.ts` — one function builds a flat Markdown string. No layering, no caching, no persona file, no few-shot, no untrusted-content fencing |
| Cost/observability | None. No token counting, no spend tracking, no audit log, no request log beyond `console.*` |

Everything is one big table: **`captures`** (discriminated by `source`: `chat`, `assistant`,
`email`, `sent_email`, `action`, `voice`, `manual`, `alexa`, …). Reading list / watch list /
to-dos / notes are all `captures` rows filed into a `folders` row. Structured extras live in a
`metadata jsonb` column. Other tables: `folders`, `projects`, `trips`, `family_members`,
`user_profiles`, `connected_services`, `memories`, `conversations`, `push_subscriptions`,
`unsubscribes`.

---

## 2. The §12 checklist, item by item

### ☑ Stack, framework, deploy target
Next.js 16 / Vercel / Supabase. See §1. **Implication for us:** the Phase 0 spec's "always-on
lightweight hub with a cron scheduler" is not what Doug built and, for one user on a $10/mo
budget, not what we should build either. Serverless + platform cron is less to keep alive.
Adopt his shape. This also quietly settles **decision #1** (host → Vercel) and **decision #4**
(DB → Postgres/Supabase, which is what "multi-user later" wants anyway).

### ☑ The PWA — framework, backend comms, auth, push, pointing at a separate hub
- **Framework:** it's not a separate SPA — the "PWA" is the Next app itself. Installable via
  `manifest.json`; `@ducanh2912/next-pwa` handles precache/offline; `public/sw.js` handles push
  + notification-click routing. Chat surface = `components/GlobalChatPanel.tsx` (a slide-up
  panel mounted globally in `layout.tsx`), talking to `/api/chat` over `fetch` with the
  Supabase bearer token. Voice note button in the same panel → `/api/chat/transcribe`.
- **"Point it at a separate hub"** is moot under the fork recommendation — the PWA and the hub
  are the same deployment, as with Doug. If we ever did split them, the coupling points are:
  the bearer-token contract, the `sendChatMessage` shape in `lib/api.ts`, and the
  `{ userCapture, assistantCapture }` response envelope.
- **Reuse:** `layout.tsx`, `manifest.json`, `sw.js`, `next.config.ts` (PWA wrapper),
  `PushSetup.tsx`, `BottomNav.tsx` scaffold, `GlobalChatPanel.tsx`, `lib/auth.tsx`,
  `lib/supabase.ts` / `lib/supabase.server.ts`. **Adapt:** nav items (Doug's are
  Today/Todos/Reading/Travel/More — ours become Today/Coursework/Reading/…); the chat panel
  currently shows only the last assistant line, no streaming — add SSE streaming for Phase 0.
- **New:** nothing structural.

### ☑ Gmail + Calendar OAuth: scopes, token storage, refresh
- **Gmail:** `google.auth.OAuth2`. Scope: **`gmail.readonly` only**. Flow:
  `/api/auth/gmail/authorize` (redirect, `state` = base64url userId) →
  `/api/auth/gmail/callback` → `exchangeGmailCode` stores into `connected_services`
  (`service='gmail'`, `access_token` column, **`refresh_token` inside `metadata` jsonb**).
  Refresh is automatic via `oauth2.on('tokens')` writing the new access token back. This is
  clean and directly reusable. **Adapt:** the search queries are travel-specific
  (`category:travel`, `label:Calliad`) — ours become a coursework label / sender filter. Add
  `gmail.metadata` or keep readonly; we never need send.
- **Calendar:** **there is no Google Calendar integration.** Doug connects **iCloud** via
  `/api/auth/icloud/connect` — user pastes Apple ID + an app-specific password, stored in
  `connected_services` (`service='icloud_calendar'`, password in `access_token`). Reads via
  `tsdav` CalDAV, parsed by a hand-rolled iCal parser in `lib/icloud-calendar.ts`, cached into
  a `calendar_events` table by `syncCalendarEvents`. Writes via `lib/icloud-calendar-write.ts`.
  **Decision for us — settled 2026-08-30: use Doug's iCloud CalDAV path.** Noah and household
  are on iPhones and don't use Google Calendar, so CalDAV is the natural fit and there's
  nothing to build — copy `lib/icloud-calendar.ts` + `lib/icloud-calendar-write.ts` +
  `/api/auth/icloud/connect` + `syncCalendarEvents` + the `calendar_events` table roughly
  as-is. Calendar moves from **new** to **reuse + adapt**. Consequences to absorb:
  - **No "Calendar watch" push trigger.** CalDAV/iCloud has no webhook. PLAN.md §3 lists
    "Calendar watch" as a Pub/Sub-style push trigger — with iCloud it becomes a **polling
    sweep** (`syncCalendarEvents` on a ~15–30 min cron). Fine for a coursework assistant;
    deadlines don't move minute-to-minute. Update §3 wording.
  - **Auth is an app-specific password, not OAuth.** Needs 2FA on the Apple ID; Noah
    generates the password at appleid.apple.com, one per app, revocable. Simpler to stand up
    than an OAuth consent screen — and it means the Google Cloud project is only needed for
    Gmail.
  - **Sync latency:** phone-side edits show up at the next poll, not instantly.
  - **Bonus / lead for decision #3:** iCloud CalDAV also exposes Reminders as `VTODO`
    calendars (Doug filters them out). `tsdav` can read/write those — a plausible path for the
    Apple Reminders integration that decision #3 leaves open, without a Shortcuts hook or an
    EventKit bridge. Worth a spike in Phase 2.
- **Token storage pattern is the reusable asset:** `connected_services` (one row per
  user×service, secrets in columns + `metadata`, `on('tokens')` refresh writer).

### ☑ Data model for captures / reading list / watch list
- One `captures` table, `source`-discriminated, `metadata jsonb` for structured payloads,
  `folder_id` for filing, `pgvector` embedding + a GIN FTS index for retrieval, an RPC
  `search_captures` for semantic search. Reading list = captures tagged `reading-list` in a
  "Reading" folder; watch list = same with TMDB enrichment in `metadata`.
- **Reuse the philosophy** (append-heavy capture log + folders + jsonb + vector/FTS retrieval
  — it's a good base for our memory stores and open-loops). **Adapt the specifics:** our Phase
  1 spec wants typed tables (`profile_facts`, `open_loops`, `people`, `people_observations`,
  `taste_log`). Doug has none of those — `memories(category,key,value)` and a flat
  `conversations` log is the whole memory model. Build our tables; optionally keep `captures`
  as the raw-inbox / ingestion-staging table.
- **New:** `audit_log`, `model_calls`, `actions` (the real queue), `config` (killswitch +
  spend counters) — none exist.

### ☑ Proactive nudge mechanism: cron? triggers? where it runs
- **Cron endpoints, pinged from outside the repo.** `/api/cron/remind` and
  `/api/cron/watch-list-refresh` check `x-cron-secret`; `/api/gmail/scan` accepts
  `Authorization: Bearer $CRON_SECRET` for the cron path and a user JWT for manual runs.
- **The real "intelligence" sweep is `/api/sync/intelligence`** — it runs ~10 detectors in
  sequence (trip reconciliation, project matching, stale-inbox cleanup, shopping re-file, todo
  promotion, calendar-card detection, curation detectors, trip-prep lead-time reminders,
  follow-up checker, unsubscribe monitor). But it's auth'd by **user JWT only**, so today it's
  triggered client-side (on app open), not by cron.
- **Delivery:** each cron route does its own `web-push` loop over `push_subscriptions`, drops
  410-Gone subs, and also writes an inbox `captures` row so the nudge is visible in-app.
- **Reuse:** the cron-route + `CRON_SECRET` pattern, the web-push delivery loop, the
  detector-library structure (`lib/*-detector.ts`, each a pure `async (userId) => void`).
  **Adapt:** move scheduling *into* the repo (`vercel.json` `crons`), so it's legible and
  version-controlled per the plan's "audit log makes cost legible" ethos. Add quiet-hours
  (1–7am) and the kill-switch check at the top of every cron route. **New:** the actual
  schedule for *our* jobs (6:30 brief, 72h-exam / 48h-assignment sweep), and a T0 rules layer
  so most sweeps cost no tokens.

### ☑ LLM call layer: models, prompt assembly, caching
- **Provider:** Gemini. Direct `genai.getGenerativeModel({ model, systemInstruction }).generateContent(...)`
  calls scattered across ~8 routes/libs. Tool use = Gemini `functionDeclarations` defined
  inline in `/api/chat` (11 tools), `FunctionCallingMode.ANY`, a mandatory `respond` tool
  carrying the user-facing text. Action-card replies use a separate classify-then-execute
  pass. `gemini-2.5-flash-lite` is used ad hoc for the cheap classification steps — a de facto
  2-tier split, but not formalized.
- **No prompt caching. No token/cost capture. No retry/backoff. No streaming** (route awaits
  the full generation, returns JSON).
- **Prompt assembly:** `lib/context.ts::getUserContext()` fans out ~11 Supabase queries in
  parallel; `buildSystemPrompt()` concatenates them into one Markdown string with an ~8-line
  hardcoded persona preamble ("You are Calliad — warm, direct, quietly clever…"). No layers,
  no cache breakpoints, no `<untrusted>` fencing, no mode overlays, no few-shot.
- **Reuse:** the `getUserContext` fan-out *pattern* (parallel fetch → shape into a typed
  `UserContext`) is a good skeleton for our layer-4 "current state" builder. The Gemini
  `functionDeclarations` catalog is a useful *inventory* of what a personal assistant's tools
  look like (calendar add, todo add, list adds, save-memory, save-note).
- **Adapt / rebuild:** this is the single biggest piece of new work. We need
  `brain/call.ts` (Claude via `@anthropic-ai/sdk`, streaming, retries, `usage` capture →
  `model_calls` + `audit_log`, spend-cap pre-check) and `brain/prompt.ts` (the 7-layer
  assembly from `specs/system-prompt-assembly.md`, two cache breakpoints, persona.md as the
  frozen prefix, the untrusted fence). None of that exists to reuse — Doug's layer is a
  worked example of the *inputs*, not the *architecture*.

#### Why Doug is on Gemini, and what the swap to Claude actually costs

**Where Gemini is used** (every call site, so the swap surface is fully known):

| Call site | Model | Job |
|---|---|---|
| `/api/chat` | `gemini-3.6-flash` | main conversational turn + tool calling (11 `functionDeclarations`, `FunctionCallingMode.ANY`) |
| `/api/chat` (action-card path) | `gemini-3.6-flash` | classify a reply to a card as yes/no/skip/choice/mismatch, then a follow-up generation |
| `/api/today/briefing` | `gemini-3.6-flash` | the "Today" greeting |
| `lib/gmail.ts` | `gemini-3.6-flash` | `extractTravelEvents`, `extractSentEmailInsights` — the pattern-C extractors |
| `/api/chat/transcribe` | `gemini-2.5-flash-lite` | tag/summarize a voice note, decide is-question / is-todo / shopping-items |
| `/api/sync/intelligence` | `gemini-2.5-flash-lite` | re-extract shopping items |
| `lib/action-executor.ts` | `gemini-3.6-flash` | "does Alaska fly this route" one-shot for the flight deep link |
| everywhere | `gemini-embedding-001` (768-dim) | capture embeddings for `pgvector` search |
| STT | Groq `whisper-large-v3-turbo` | not Gemini — separate provider |

So it's really **flash for anything user-facing or extractive, flash-lite for cheap
classification** — a de facto T1/T2 split that maps cleanly onto our tier plan, just not
named as such.

**Likely reasons for the choice** (informed guesses — confirm with Doug, question 4):

- **Free / near-free at his volume.** Gemini Flash has a genuine free tier and Flash pricing
  is very low; `gemini-embedding-001` is free. For a solo hobby app with no spend cap wired,
  "don't think about the bill" is the whole point. Claude has no free tier.
- **One Google account already in play.** He's using Google APIs for Gmail and Google AI
  Studio keys are trivial to mint next to that. Fewer accounts/keys.
- **Flash is fast** and the app makes *lots* of small serial calls (the intelligence sweep
  alone fires a dozen), several inside Vercel's function-timeout window — latency per call
  matters more than reasoning depth for classify/extract/tag work.
- **Native structured-output ergonomics.** Gemini's `responseSchema` / `functionDeclarations`
  and "just ask for JSON" style is what the code leans on constantly; it returns JSON reliably
  enough that Doug parses with a bare `JSON.parse` + a try/catch fallback everywhere.
- **Not a considered head-to-head with Claude**, most likely — it's the default that was
  cheapest and closest to hand, not a decision defended against alternatives.

**What the swap to Claude costs — mostly mechanical, some genuine:**

- **Tool-calling API shape is different.** Gemini: `functionDeclarations` with `SchemaType.*`
  enums, `FunctionCallingMode.ANY` to force a call, a mandatory `respond` tool that carries
  the assistant's text. Anthropic: `tools: [{name, input_schema (JSON Schema), description}]`,
  `tool_choice: {type: "any"|"tool"|"auto"}`, and **text comes back as normal content blocks
  alongside `tool_use` blocks** — no `respond` wrapper needed. The 11-tool catalog ports
  almost 1:1; the orchestration loop around it is rewritten (and it's a rewrite you want
  anyway — Doug's is a single non-streaming `generateContent` with no tool-result round-trip).
- **System prompt:** Gemini `systemInstruction` (one string) → Anthropic top-level `system`,
  which can be an **array of blocks with `cache_control`** — this is the feature the assembly
  spec's two cache breakpoints depend on, and Gemini's implicit caching doesn't give you that
  control. Net positive, but it's new code.
- **`usage` field names:** Gemini `usageMetadata.{promptTokenCount, candidatesTokenCount}` →
  Anthropic `usage.{input_tokens, output_tokens, cache_read_input_tokens,
  cache_creation_input_tokens}`. The cost table in `tiers.ts` is Anthropic's numbers.
- **JSON reliability:** no `response_mime_type: "application/json"` on Anthropic. Get strict
  JSON via a tool with an `input_schema`, or prefill the assistant turn with `{`. The bare
  `JSON.parse(raw.replace(/```json/,''))` pattern all over `lib/gmail.ts` should become a
  tool-call with a schema when those extractors are cloned.
- **Embeddings:** Anthropic has **no embeddings endpoint.** `gemini-embedding-001` is free and
  already wired to `pgvector(768)`. Simplest path: **keep Gemini (or Voyage) just for
  embeddings** — it's not a persona surface, it costs ~nothing, and ripping out pgvector to
  chase a pure-Anthropic stack buys nothing. This is the one place "Gemini" legitimately stays
  in the fork.
- **STT:** already Groq, already not Anthropic — leave it. Anthropic doesn't do STT.
- **Persona quality:** this is the *reason* for the swap, per PLAN.md §6 — the conversational
  surface wants Sonnet-tier to hold a persona and dry humor without AI-tells. Flash is fine
  for extract/classify (T1) and Doug's ~8-line persona doesn't ask much of it. Our persona.md
  + 18-example few-shot is a much heavier lift on the model, so **T2 conversational turns go
  to Claude Sonnet; T1 extract/classify/tag can stay on Flash-lite or move to Haiku** —
  decide from the cost ledger, exactly as the plan says.

**Bottom line:** the provider swap is a contained rewrite of `brain/call.ts` and the tool
loop, plus a find-and-replace of `usage` accounting. The *inputs* Doug assembled (the tool
catalog, the extractor prompts, the context fan-out) all carry over. Keep Gemini embeddings
and Groq STT; everything reasoning-shaped moves to Claude with tiering.

#### Model-routing policy (settled 2026-08-30)

**Default to free/cheap; escalate to Claude only when it materially improves quality.** Noah's
call. Concretely:

| Tier | Provider / model | Work | Bill impact |
|---|---|---|---|
| **T0** | none — rules | most triggers: "exam within 72h?", "assignment due 48h?", "new email in label?", data-gathering for the brief | free |
| **T1** | **Gemini Flash-Lite** (routing, tagging, email triage, capture classification, metadata disambiguation) · **Gemini Flash** (syllabus/document extraction, cheap-win Q&A, first drafts a T2 call will polish) | high-frequency mechanical work — not persona, not judgment | ~free at one-person volume (Flash-Lite ≈ 10× cheaper than Haiku, Flash ≈ 3×) |
| **T2** | **Claude Sonnet** | conversational turns, morning-brief *phrasing*, nudge *phrasing*, "would I like this?", study-coach framing, language tutoring | the metered line, under the spend cap |
| **T3** | **Claude Opus** | hard reasoning Noah explicitly asks for | rare, deliberate |
| sidecars | **Gemini embeddings**, **Groq Whisper STT** | permanent, not cost-driven — Anthropic has neither endpoint | ~free |

Rules of thumb:
- "Proactive" ≠ "cheap". The brief and nudges are the *voice Noah hears* → their final phrasing
  pass is T2. Only the data behind them is T0.
- Escalation is allowed and expected — if a T1 route is visibly worse (bad extraction, wrong
  tone leaking into something user-facing, non-English degradation), move it up a tier and note
  it in the audit log. Don't defend a cheap tier that's hurting quality.
- Anything language-tutor-shaped (Italian/Latin/Greek grading, idioms) starts at T2 — cheap
  models degrade faster off-English.
- The audit log's per-call cost rows are how we tell whether a route is worth its tier. Revisit
  the mapping from real numbers, not guesses (matches PLAN.md §5 and Phase 4's local-brain
  decision).

### ☑ The webhook receiver pattern
- **No inbound webhook receiver exists.** `lib/abentfork.ts` + `/api/abentfork/push` are the
  *outbound* side (Calliad → abentfork.com). The PWA `share_target` (`/share-target`, GET) is
  the closest thing to an inbound hook — OS share-sheet → querystring → capture.
- **New:** `POST /webhook/:source` per the Phase 0 spec. The share-target handler is a small
  reuse for "receive a link/text from the phone."

### ☑ Persona / prompt approach, if any
- ~8 lines, hardcoded in `buildSystemPrompt()`, addressed to "Doug". No file, no versioning,
  no few-shot, no anti-pattern list, no nudge-tone rules.
- **New:** wire `persona.md` v1.0 as the layer-1 frozen prefix (with the 18-example few-shot
  and the anti-pattern / nudge-tone rules) per `specs/system-prompt-assembly.md`. Nothing to
  reuse here beyond confirming the *spot* it plugs into (`systemInstruction`).

### ☑ Per-module: reusable as-is vs. needs rework
See the table in §3.

---

## 3. §3 components → reuse / adapt / new

| §3 component | Verdict | Detail |
|---|---|---|
| **Interfaces — PWA shell** | **Reuse** | `layout.tsx`, `manifest.json`, `sw.js`, next-pwa config, `PushSetup`, `lib/auth.tsx`, Supabase clients. Strip Doug's page routes; keep the frame. |
| **Interfaces — chat surface** | **Reuse + adapt** | `GlobalChatPanel.tsx` works; add SSE streaming, wire to our `/chat`. Voice-note button already there. |
| **Triggers — cron scheduler** | **Adapt** | Reuse the `CRON_SECRET` route pattern + web-push loop. Move schedule into `vercel.json`. Add kill-switch + quiet-hours guards. Write our own jobs. |
| **Triggers — inbound webhooks** | **New** | No receiver exists. Build `/webhook/:source`. `share-target` is a small partial reuse. |
| **Triggers — Gmail push (Pub/Sub)** | **New** | Doug polls. Either build Pub/Sub push, or accept polling for Phase 1 and revisit. |
| **Triggers — Calendar watch** | **Adapt → polling** | iCloud CalDAV has no push. Reuse `syncCalendarEvents` on a 15–30 min cron instead of a watch subscription. |
| **Router** | **New** | No router seam exists — `/api/chat` goes straight to Gemini. Build `router/route.ts` returning `RouteDecision`; Phase 0 stub per the spec. |
| **Brain — model call** | **Adapt (mostly new)** | Provider swap Gemini→Claude. New: streaming, retries, `usage`→cost, spend-cap pre-check, tier table. |
| **Brain — prompt assembly** | **Adapt** | Keep the `getUserContext` fan-out idea. Rebuild as the 7-layer, 2-breakpoint, persona-prefixed, untrusted-fenced assembler. |
| **Integrations — Gmail** | **Reuse + adapt** | OAuth scaffold + token refresh reuse as-is. Swap the search queries; point captures at coursework, not trips. |
| **Integrations — Calendar** | **Reuse + adapt** | Settled: iCloud CalDAV. Copy `lib/icloud-calendar*.ts`, `/api/auth/icloud/connect`, `syncCalendarEvents`, `calendar_events` table. App-password auth, not OAuth. Poll, don't watch. |
| **Integrations — capability registry** | **New** | Doug has an implicit one (the inline `CHAT_TOOLS` array). Formalize it. |
| **Integrations — GitHub / flights / morphology / …** | **New** | None present. |
| **Memory — profile facts** | **New** | Doug: `user_profiles` (fixed travel columns) + `memories(cat,key,value)`. We need `profile_facts` + `profile.md` as source of truth + the slice logic. |
| **Memory — open loops** | **New** | No equivalent. `captures` + `metadata.remind_at` is the nearest primitive. |
| **Memory — taste log** | **New** | No equivalent. |
| **Memory — people files** | **Adapt** | `family_members` (name/rel/birthday/anniversary/notes) is a start; add `people_observations` propose→confirm. |
| **Memory — retrieval slice** | **Adapt** | Reuse `pgvector` + `search_captures` RPC + GIN FTS. New: the *slice-by-intent* selection the assembly spec wants (Doug injects everything, every call). |
| **Action queue** | **New** | Writes execute inline in `/api/chat` today. "Action cards" / "curation cards" (`captures` source=`action`, multi-turn yes/no/choice via `executeActionCard` / `executeCuration`) are a *suggestion-confirm* loop — a useful reference for the UI/'1-tap' tier, but not a risk-tiered pre-execution gate. Build `actions` table + the graduated-auth gate (pattern J). |
| **Audit log** | **New** | Nothing. `console.*` only. Build `audit_log` + `model_calls` append-only. |
| **Kill switch** | **New** | Nothing. Build `config` flag + `/admin/killswitch` + checks in router and every cron route. |
| **Spend cap** | **New** | Nothing. Build the pre-check in `brain/call.ts`. |
| **Config / secrets** | **Reuse pattern** | `.env` + `process.env`. Add startup validation (Doug has none). |
| **Where it runs** | **Adopt Doug's** | Vercel serverless + platform cron, not a long-lived hub. |

---

## 4. §8 capability catalog — quick pass

| Capability | vs. Doug | Notes |
|---|---|---|
| **Day/week schedule + coursework** (anchor) | **New**, but both halves have a base | `extractTravelEvents()` in `lib/gmail.ts` is pattern C done well — feed text + a date anchor, get typed JSON back. Clone it for syllabus → `{course, exams[], assignments[], topics[], weights}`. Calendar half is now **reuse** (iCloud CalDAV, see §2) — new work is only the syllabus extractor + the deadline/exam rules layer. |
| Context-injected Q&A ("what animal") | **Adapt** | `/api/chat` already does context-injected Q&A; the voice-note path even does retrieval-augmented answers over past captures. Reuse the shape; add web/vision later. |
| Recipe help (query A Bent Fork) | **Reuse-ish** | `lib/abentfork.ts` is an outbound push, not a query API — but it proves the cross-app call. Recipe *lookup* is new. |
| Reading/watch capture + neutral blurb | **Adapt** | Capture + folder + TMDB enrichment all exist. New: the *neutral blurb* prompt discipline (pattern M) — Doug's watch enrichment writes full synopses. |
| Italian / language modes | **New** | No mode system. `systemInstruction` is the injection point. |
| Spaced repetition | **New** | — |
| Latin/Greek morphology (tool-backed) | **New** | — |
| "Would I like this?" | **New** | Needs the taste log, which is new. |
| Flight search | **New** | Doug builds a *deep link* to Alaska/Google Flights (`action-executor.ts::buildFlightSearchUrl`) — no real flight API. |
| Restaurant hand-off | **New** | — |
| Confirmation-gated writes | **Adapt** | Calendar/todo/list writes exist but fire immediately. Re-route them through the new `actions` gate. |
| Name that song | **New** | Mic infra (getUserMedia + MediaRecorder) exists in the chat panel; fingerprint API is new. |
| Delegated coding | **New** | — |
| MTG sim front-end | **New** | — |

**STT for Phase 3 Stage 1 is already done** — Groq `whisper-large-v3-turbo`, push-to-talk in
the chat panel. TTS is browser-only today (no Piper); fine for early testing, matches the
plan's "cheap cloud fallback first."

---

## 5. Decision #9 — fork vs. shared core vs. fully separate

**Recommendation: fork Doug's repo as a one-time donor, adopt its architecture, and keep no
upstream relationship.**

Reasoning:

- **Shared core is the wrong shape.** A shared package (brain + prompt + memory + integrations
  as an npm dep both apps consume) only pays off if the shared surface is stable and both
  consumers track it. Here the *core itself* is where the two diverge hardest: different LLM
  provider, different persona, different memory model, different calendar backend, different
  auth gate philosophy, different user. You'd be versioning a package whose every release
  breaks one of the two consumers, and coordinating that with Doug, for a solo project. Skip.
- **Fully separate (greenfield, read Doug's code for reference) throws away the one thing
  that's genuinely done:** a working installable PWA with push, Supabase auth wired end to
  end, Gmail OAuth with token refresh, the cron + web-push delivery loop, and a sane
  capture/retrieval data layer. Rebuilding that from zero is weeks for no gain.
- **Fork captures exactly that running start** and lets you diverge immediately and without
  guilt. Day one: fork, then delete `trips`, `unsubscribes`, `alexa`, `amazon`,
  `abentfork` (keep as reference), `projects`, `family`/`people` pages you don't need yet,
  `icloud-contacts`, `tmdb` — roughly half the `app/` and `lib/` trees. What remains is the
  shell + auth + push + Gmail OAuth + **iCloud CalDAV** + Supabase wiring. Then build the hub
  (`router`, `brain`, `memory`, `audit`, `actions`, `killswitch`) *inside* it as new modules,
  and move everything reasoning-shaped from Gemini to Claude (keeping Gemini for embeddings and
  Groq for STT — see the Gemini/Claude subsection in §2).
- **No upstream merges.** Provider and purpose diverge too far for `git pull upstream` to ever
  be clean. Treat Doug's repo as frozen source material. If Doug ships something great later
  (a better iCal parser, say), cherry-pick that file by hand.
- **This also adopts Doug's platform choices**, which resolves three open decisions in the
  plan's favor: **#1 host → Vercel** (serverless + platform cron, nothing to keep alive),
  **#4 DB → Supabase Postgres** (already there; `pgvector` already there; multi-user-ready,
  which "personal now, multi-user later" wants). The Phase 0 spec's "always-on lightweight
  hub" language should be revised to "Vercel app + `vercel.json` crons."

**Cost:** you carry some travel-assistant cruft through the initial cleanup, and the first
commit history isn't yours. Both are cheap. **Keep your own repo, own Vercel project, own
Supabase project, own Anthropic account** — the fork is a code seed, not shared infra.

Concretely, the copy-and-adapt list (not a dependency, a starting point):
`layout.tsx`, `manifest.json`, `public/sw.js`, `next.config.ts`, `lib/auth.tsx`,
`lib/supabase*.ts`, `components/{GlobalChatPanel,PushSetup,BottomNav,GlobalCaptureBar}.tsx`,
`components/PushSetup` + `push_subscriptions` schema + `/api/push/subscribe`,
`lib/gmail.ts` (OAuth + refresh half), `/api/auth/gmail/*`, `lib/icloud-calendar.ts` +
`lib/icloud-calendar-write.ts` + `/api/auth/icloud/connect` + `/api/calendar/sync`,
`/api/cron/*` pattern, `lib/context.ts` (as a skeleton for the layer-4 builder), the
`captures`/`folders` + `pgvector` + `search_captures` schema.

---

## 6. Questions for Doug

1. **Where do the crons actually run?** `vercel.json` is empty and there's no scheduler in the
   tree. Vercel Cron configured in the dashboard? cron-job.org? What's the cadence on
   `/api/gmail/scan`, `/api/cron/remind`, `/api/cron/watch-list-refresh`, and who triggers
   `/api/sync/intelligence` (it's user-JWT only)?
2. **Google Cloud project / OAuth consent screen** — is the Gmail OAuth app in
   "testing" or "production", and are you fine with Noah standing up a *separate* Google Cloud
   project + OAuth client (recommended), or did you intend to share one?
3. ~~**Calendar:** any reason you went iCloud CalDAV over Google Calendar?~~ **Resolved
   2026-08-30:** Noah's household is on iPhones and doesn't use Google Calendar → copying
   Doug's iCloud CalDAV path. Remaining ask to Doug: is the `calendar_events` table schema in
   `supabase/*.sql` current, and any CalDAV gotchas (recurring-event expansion, timezone edge
   cases in the hand-rolled iCal parser) worth knowing?
4. **Gemini model strings** (`gemini-3.6-flash`, `gemini-2.5-flash-lite`) — just confirming
   those are current/intentional and not typos, in case any of Doug's prompt tuning is
   model-specific and worth knowing about.
5. **Supabase:** is the schema in `supabase/*.sql` the complete current state, or have there
   been dashboard-side migrations since (RLS tweaks, the `calendar_events` table, the
   `search_captures` RPC signature)?
6. **`web-push` / VAPID keys** — Noah generates his own pair (yes, presumably), just
   confirming nothing else is keyed to Doug's.

---

## 7. Deltas to fold back into the Phase 0 specs

- **`specs/hub-skeleton.md` §2 module layout** assumes a standalone `calliad-hub/` TS service.
  Rebase onto Next.js App Router: `src/` modules become `lib/` modules; `server/http.ts`
  routes become `app/api/{chat,webhook/[source],health,admin/killswitch}/route.ts`;
  `scheduler/cron.ts` becomes `vercel.json` `crons` + `app/api/cron/*/route.ts`.
- **§3 data model** — SQLite → Supabase Postgres. Keep every table as specified; add RLS
  policies + `service_role` grants like Doug's. `pgvector` is already available for the Phase
  1+ embeddings note.
- **§7 inbound HTTP** — auth is Supabase bearer token (single user = Noah), not a shared
  secret, for `/chat`. `/webhook/:source` and `/admin/*` keep their own secrets. `CRON_SECRET`
  for cron routes, matching Doug.
- **§3 "Calendar watch" trigger** — no push with iCloud CalDAV. Reword to a polling sweep:
  `syncCalendarEvents` on a 15–30 min cron. Calendar connect is an app-specific-password form
  (`/api/auth/icloud/connect`), not an OAuth leg — no consent screen, no Google Cloud project
  for calendar (Gmail still needs one).
- **§9 config** — `ANTHROPIC_API_KEY`, `SPEND_CAP_USD_MONTH` are new; also need
  `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`,
  `GOOGLE_CLIENT_ID/SECRET` (Gmail), `GOOGLE_AI_KEY` (embeddings only),
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`, `CRON_SECRET`, `GROQ_API_KEY` (STT,
  Phase 3). iCloud creds are per-user in `connected_services`, not env. Add the startup
  validation Doug lacks.
- **`specs/system-prompt-assembly.md`** — Doug's `buildSystemPrompt` is a single unlayered
  string with no caching; adopt the assembly spec's design wholesale, and note that the
  provider's `usage` field names to verify are Anthropic's
  (`cache_read_input_tokens`, `cache_creation_input_tokens`), not Gemini's.
- **§10 acceptance test** still valid; step 3's "streams an in-persona reply" needs SSE added
  to `GlobalChatPanel` (Doug's is request/response).
