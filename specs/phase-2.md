# Phase 2 — judgment, modes, light action

*Started 2026-08-30 on top of Phase 1. PLAN.md §9. Priority order (Noah): Italian tutor →
morphology → spaced repetition → confirmation-gated writes.*

## Done

### ✅ Router + mode switching
- `0007` — `conversations.mode` (sticky).
- `lib/router/route.ts` — real intent detection: mode-switch phrases (`parla italiano`,
  `quiz me`, `study plan`, `english please` to exit), one-shot morphology detection
  (`tools:['morphology']`), otherwise carry the sticky mode. `setMode` persisted.
- `lib/brain/prompt.ts` — layer-5 `MODE_OVERLAY` (italian-tutor / study-coach / quiz /
  morphology) + optional `toolResult` block. `/api/chat` threads currentMode → route →
  persist; SSE `done` carries mode; `Chat.tsx` shows a mode chip.

### ✅ Italian tutor mode
- Overlay: converse at B1, correct briefly inline, localise idioms, English only if stuck.
  T2. Enter with "parla/parliamo (in) italiano" etc.; exit with "english".

### ✅ Latin/Greek morphology tool (deterministic)
- `lib/tools/morphology.ts` — Perseids/Morpheus service (`services.perseids.org`, no key):
  `analyzeForm(word, lat|grc)` → `[{lemma, pos, features}]`; `runMorphology(query)` picks the
  word, detects language, returns a GROUND-TRUTH block. Wired via `decision.tools`. Verified:
  `mercatorem→mercator acc.sg 3rd decl`, Greek `λύουσι→λύω` all analyses.
- Latin input is de-macronned before the request (`ferō`→`fero`; Morpheus-lat returns nothing
  for length-marked forms). `Body` is parsed as object *or* array — ambiguous forms (`fero`→2
  analyses) come back as `Body[]` and were silently dropped before. Homograph index stripped
  from Latin lemmas (`sum1`→`sum`). Re-verified: `ferō`, `rēgī`, `ferunt`, `sum`, `πόλεως`.

### ✅ Spaced-repetition quiz (pattern N)
- `0008` — `quiz_items` (Leitner box/due_at/streak, unique per user+lang+prompt) +
  `conversations.mode_state jsonb`.
- `lib/quiz/items.ts` — add / counts / nextDue / `judge` (normalised match → T1 fallback,
  stricter for `form` cards) / `grade` (correct: box+1, interval 1/2/4/8/16/30d; wrong:
  box 0, retry ~10 min).
- `lib/quiz/session.ts::quizTurn` — grade the pending item, advance to next due, hand the
  brain a `toolResult` (what to ask; never the answer).
- `/api/chat`: quiz mode → `quizTurn`; `"[lang] quiz: PROMPT = ANSWER"` adds a card inline.
- `/api/quiz` (GET/POST/DELETE) + Settings deck manager. **Deck starts empty — Noah seeds it.**

### ✅ Graduated-authorization gate + calendar writes
- `lib/actions/gate.ts` — `proposeAction` → pending `actions` row (table from `0001`);
  `pendingFor`; `decideAction` (approved → execute by kind, rejected → drop); full
  `action_proposed`/`decided`/`executed` audit trail. `kind:'create_event'` wired via
  restored `lib/integrations/icloud-calendar-write.ts::createCalendarEvent` (CalDAV PUT).
- `lib/actions/detect.ts` — calendar-write vs task-add intent; T1 `extractEvent`
  (relative dates vs `TZ_DEFAULT`); yes/no matchers.
- `/api/chat`: pending action + yes/no → decide; **task/reminder add → silent** (open loop,
  no gate — per the operating rules); **calendar write → propose + one "yes"**.

### ✅ Draft email through the gate (2026-08-31) — compose + hand off, no send
- `lib/actions/email.ts` — `isEmailDraft` (explicit "draft/write/compose an email", or
  "email X and tell them …", or "reply to that email"; **not** "remind me to email X" — that's
  a task and is caught first). `composeEmail(userId, request)`: T1/regex pulls the recipient
  (falls back to matching a name against `email_items.from_addr`); **T2 writes the body** in
  Noah's voice, returns `{subject, body}`. `buildMailto()` → a `mailto:` link. `handoffEmail()`
  is the gate executor for `kind:'draft_email'` — assembles the review block + link, sends
  nothing (no Gmail write scope, matches the flight/restaurant deep-link pattern).
- `/api/chat`: draft request → `composeEmail` → `proposeAction(kind:'draft_email', confirm)`
  with the request stashed in the payload → reply previews the draft. Then **yes** →
  `decideAction` → `mailto:` hand-off; **anything else while a draft is pending** → treated as
  a revision (re-compose with "Noah's revision: …", re-propose).
- Verified against prod: detection, T2 compose (~$0.0017/draft), recipient pull, mailto build.

## Apply
`0007_conversation_mode.sql` and `0008_quiz.sql` in the Supabase SQL Editor.

### ✅ "Would I like this?" (pattern L + M)
- `taste_log` seeded from `planning/taste-log.md` (59 entries; done via probe against prod).
  `content/taste-log.md` vendored for the "What makes Noah bail" section.
- `lib/taste/judge.ts` — title/kind extract → Open Library (books, no key) or TMDB
  (screen, `TMDB_API_KEY` optional, degrades) → brain gets the full log + bail patterns as
  ground truth; NO spoilers, weigh myth-retelling fidelity.
- `/api/chat` detects "would I like / should I watch|read|play"; `/api/taste` + Settings manager.
- **Optional:** `TMDB_API_KEY` (themoviedb.org) for film/show metadata.
- **Write path (2026-08-31):** `lib/taste/capture.ts` — a reaction to a named work in chat
  ("just finished X, loved it" / "bailed on Y" / "Z was mid") → `isTasteReaction` gate → T1
  extract `{title, kind, verdict, why}` → upsert `taste_log` (match on title; changed verdict
  updates in place). Silent tier, runs before the profile-fact path so "remember I loved X"
  lands here, not in `profile_facts`. Seed markdown now drifts behind the DB by design.

### ✅ Profile slicing + learned facts
- `lib/brain/profile.ts` — `content/profile.md` split by `## ` heading. Always-in CORE
  (Identity / Health / Daily rhythm / Working style) stays inside the cached breakpoint;
  `profileSections(text, mode)` intent-matches the rest and they ride along fresh per turn.
  Cuts the cached-prefix and the fresh profile payload roughly in half on a typical turn.
- `prompt.ts` — `PROFILE_CORE` replaces the whole-file slice; "About Noah — relevant to
  this turn" + "Learned about Noah" blocks appended *after* both cache breakpoints.
- `profile_facts` — "remember that I…" / "fyi I prefer…" in chat → T1 extract →
  `confirmed` fact (silent tier, no gate, since Noah asked). `learnedFacts()` folds them
  back into the prompt. `/api/facts` (GET/POST/PATCH/DELETE) + Settings "Learned about you"
  panel to keep/correct/delete. No migration (`profile_facts` shipped in 0003).
- Brief + nudge seed `profileSections()` with their own intent strings.

### ✅ Adopt Doug's UI refresh (2026-08-31)
- Second one-time donor pull from `dougt425/calliad` (`6ba0638..1800145`). Full write-up:
  `specs/reconciliation.md` §8.
- Foundation taken wholesale: `app/globals.css` token system + 4 themes, `ThemeProvider`,
  `PageLayout` primitives, Newsreader/Bitter fonts, `workshop-bg.webp`.
- `BottomNav` + `GlobalChatPanel` rebuilt in the new visual language over Calliad's own
  wiring (SSE stream, sticky conversation, brief-on-open). Voice/photo deferred to the STT
  work. Every page reskinned zinc/`dark:` → tokens; Settings → Appearance / theme picker.
- Skipped Doug's PIM pages, his nudges/push/TMDB re-solves, and schedule-conflict detection.

### ✅ Web-fetch tool (2026-08-31)
- `lib/tools/webfetch.ts` — `fetchReadable(url)`: one GET (Chrome UA, 12 s, 1.5 MB cap),
  HTML/plain-text only, prefers `<article>`/`<main>`/`<body>`, strips script/style/nav/chrome,
  entity-decodes, truncates at 4000 words. SSRF guard blocks localhost / private / link-local
  hosts and non-http schemes. `runWebFetch(url, question)` → a `toolResult` block with the body
  fenced as `<untrusted source="web">`.
- `/api/chat` — after the capture check: a message with a URL that's *also* a question (or a
  "summarise / tl;dr / what does it say" verb), or "read the last thing I saved" (falls back to
  the newest `list_items` row). Wired as the first `toolResult` branch after quiz. T2 answers
  from the page text only.
- Not a browser: no JS, no crawl, no PDF/video. JS-rendered pages and paywalls return a plain
  "couldn't read it".

### ✅ Tier routing for cheap-win Q&A (2026-08-31)
- `lib/router/route.ts` `isCheapQA()` — generic factual/definitional/quick-calc questions from a
  clean default conversation route to T1 (cheapest Anthropic model = Haiku today), full persona
  still applied. Blocks on: first-person/`my`, calendar/course/email/trip context words, a URL,
  >28 words, or no "what is/who was/how many/define/how do you say" opener. Biased hard toward
  T2 — a miss costs cents, a wrong downgrade weakens a real answer.

### ✅ Flight search + restaurant hand-off (no booking)
- `lib/travel/detect.ts` — intent + T1 param extraction.
- `lib/travel/flights.ts` — Google Flights + route-aware Alaska search links always;
  indicative Amadeus fares when `AMADEUS_CLIENT_ID/SECRET` set (test inventory, flagged).
  Brain applies profile prefs (Alaska, NYC-airport routing, aisle, avoid Lufthansa); never books.
- `lib/travel/restaurant.ts` — OpenTable / Resy / Google / Maps pre-filled links + party/time.
  Programmatic booking is closed (Resy no API, OpenTable partner-only) → hand-off only.
- `/api/chat` wires both as `toolResult` (T2). No migration. `AMADEUS_*` optional.

---

## Phase 2 complete (2026-08-31)

Every item on the PLAN.md §9 Phase 2 list is built: router + tiers, the graduated-auth gate,
confirmation-gated writes (calendar hold, draft email), flight + restaurant hand-off,
"would I like this?", morphology, Italian tutor, spaced-repetition quiz. Plus off-list:
profile slicing + learned facts, taste-log write path, web-fetch, cheap-Q&A tier routing,
and the adoption of Doug's UI refresh. Next: Phase 3 (voice — Stage 1 done — and delegated
agents). Standing small fixes: Greek class time, weather location, taste-log bail-patterns
refresh.
