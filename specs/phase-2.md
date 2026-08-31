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

## ⏭ Next
- [ ] "Would I like this?" (Noah picked it) — needs `taste_log` seeded (~15-20 from
  `planning/taste-log.md`) + metadata APIs (TMDB / Open Library).
- [ ] Profile *slice* by intent + `profile_facts` propose→confirm.
- [ ] Web-fetch tool (answer questions *about* a link).
- [ ] Flight search, restaurant hand-off (later).
