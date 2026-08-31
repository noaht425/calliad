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
- Email "drafts" need no gate (nothing is sent — the brain just composes text).

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

## ⏭ Next
- [ ] Tier routing beyond modes — cheap-win Q&A / trivia → T1.
- [ ] Web-fetch tool (answer questions *about* a link).
### ✅ Flight search + restaurant hand-off (no booking)
- `lib/travel/detect.ts` — intent + T1 param extraction.
- `lib/travel/flights.ts` — Google Flights + route-aware Alaska search links always;
  indicative Amadeus fares when `AMADEUS_CLIENT_ID/SECRET` set (test inventory, flagged).
  Brain applies profile prefs (Alaska, NYC-airport routing, aisle, avoid Lufthansa); never books.
- `lib/travel/restaurant.ts` — OpenTable / Resy / Google / Maps pre-filled links + party/time.
  Programmatic booking is closed (Resy no API, OpenTable partner-only) → hand-off only.
- `/api/chat` wires both as `toolResult` (T2). No migration. `AMADEUS_*` optional.
