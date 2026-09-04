# T1 model — training project

Goal: replace Gemini Flash-Lite in Calliad's T1 tier (`lib/llm/gemini.ts` `t1Json`/`t1Text`)
with a small open model we fine-tuned ourselves, per the plan from the "our own Calliad LLM"
discussion (2026-09-04) — option C, the specialization play. T1 is cheap classification /
extraction / structured-output work; Sonnet/Opus keep the conversational brain and hard
judgment (deck advice, syllabus parsing, persona) untouched.

This directory is a standalone project, not part of the deployed app — excluded from the root
`tsconfig.json` and never imported by anything under `app/`/`lib/`. Run scripts with `tsx`
directly (`npx tsx build.ts`).

## The task surface

24 distinct T1 call sites (inventoried 2026-09-04 by reading every `t1Json`/`t1Text` site in
the codebase — see the commit that added this file for the full per-task breakdown: prompt
text, output schema, token budget, real input shape). They fall into three shapes:

- **A — relative-date extraction**, `{ok, ...fields}` with a `"Now" is <local time>` anchor:
  `extract_event`, `extract_calendar_change`, `extract_task`, `extract_flight`,
  `extract_restaurant`, `save_fact`-adjacent, `parse_travel_email`. Ground truth is
  **computable, not model-labeled** — given a phrase and a reference "now", there's a
  provably correct resolved date. This is the highest-value, most scalable category because
  the labels are exact by construction, not an LLM's opinion.
- **B — classification / judgment over text**: `intent_classify`, `correction_capture`,
  `taste_capture`, `taste_identify`, `note_index`, `detect_turn`, `behavior_rule_extract`,
  `behavior_rule_scope`, `capture_descriptor`, `email_recipient`. Needs real linguistic
  diversity and sometimes genuine judgment calls; ground truth comes from hand-authored seed
  examples (many prompts already have good few-shot examples embedded) plus Calliad's own
  real corrected data as it accumulates (`correction_candidates`, `behavior_rules`, `notes`
  kind='correction') — that data is Noah's own usage, not distilled from any model's output.
- **C — ID-selection / boolean over a short DB-row list**: `behavior_rule_revive`,
  `behavior_rule_veto`, `behavior_rule_lifecycle`, `behavior_rule_compiler`, `quiz_grade`,
  `watcher_page_diff`. Structurally simple; synthesizable via templates + programmatic list
  construction where the "correct" answer is which item the phrase was constructed to mean.

**Explicitly avoided:** generating training data by asking Claude "what's the right answer"
at scale. Anthropic's terms permit training non-competing models on Claude outputs but not
building a competing model that way — for a private single-user tool this is very likely fine,
but the cleaner and higher-quality path is ground truth we compute or author ourselves, which
this pipeline does for category A and mostly for B/C. Gemini (already in the stack, a
different vendor) is fair game for paraphrasing INPUT text once a label is already fixed —
never for deciding the label itself.

**Real usage is thin** (289 total messages as of 2026-09-04, and most `intent_classify` audit
rows are verification probes from this dev session, not organic use) — so the training set has
to be primarily synthetic for now, topped up with real corrected data as Calliad accumulates
it over time. That's fine for category A (synthetic IS ground truth there) and workable for
B/C with careful hand-authoring; it's the reason B/C need more care than a quick generator.

## Status (2026-09-04)

**Built:** the NY-timezone-correct date engine (`lib/tz.ts`, DST-verified), the relative-date
phrase resolver (`lib/relativeDate.ts`), and generators for `extract_event`, `extract_task`,
`extract_calendar_change`, and `quiz_grade` (hand-authored — small, simple, already has a
non-LLM fast-path in production so it's low-priority). Verified individual records by hand
against their "Now is..." anchor, including across a DST boundary and month/year rollovers.

```
extract_event              train=486  eval=54
extract_task                train=481  eval=54
extract_calendar_change     train=324  eval=36
quiz_grade                   train=40   eval=4
TOTAL                        train=1331 eval=148
```

Output: `data/<task>-train.jsonl` / `-eval.jsonl` per task, plus `data/t1-all-{train,eval}.jsonl`
combined. Format: one JSON object per line, `{"messages":[{role:system,...},{role:user,...},
{role:assistant,...}]}` — OpenAI-style chat SFT format (what Fireworks/Together both expect).
`system` = the task's fixed instructions (verbatim from the production prompt, generalized to
not assume a specific caller — `"Now" will be given as...` instead of a baked-in string).
`user` = the interpolated variable content for that call. This means, at serving time, the
harness that calls the fine-tuned model reconstructs the same two-part message — a small
change to how `t1Json` builds its request, not to any prompt's wording.

**Design choice: one joint model, not 24 separate fine-tunes.** All 24 tasks share a base
model and a LoRA adapter (or a couple, if categories turn out to need different learning
rates); which task is which is carried entirely by the system prompt, exactly mirroring how
`t1Json(purpose, prompt, opts)` already dispatches by prompt content today. Shared
JSON-formatting and instruction-following skill transfers across tasks, there's one thing to
deploy, and Fireworks' multi-LoRA serving (see below) is built for exactly this shape.

**Not yet built:** category B and C generators (12 of the 24 tasks) — the intent classifier is
the highest-value one there (it's the newest, highest-traffic, and hardest task). Next
session's work.

## Base model & platform (researched, not yet chosen for real)

- **Model:** small (7-9B) models are now genuinely competitive on structured/tool-calling
  work — Qwen3.5-9B is called out as "the sweet spot" for single-GPU real workloads; a
  model fine-tuned specifically for tool-calling (Llama-3-Groq-70B/8B-Tool-Use, via SFT+DPO
  targeted at correct tool calls) tops the Berkeley Function-Calling Leaderboard, which
  validates that the SFT recipe this project uses is the right one for this task shape.
  NuExtract-3 (Qwen-backbone, purpose-built for structured JSON extraction) is worth a direct
  comparison for the category-A tasks specifically. Pick the actual base once B/C are further
  along and there's a full eval set to compare candidates against — don't commit early.
- **Platform:** Fireworks AI — LoRA/qLoRA fine-tuning, JSONL dataset upload (what this
  pipeline already produces), and multi-LoRA serving explicitly aimed at "personal assistants
  or per-customer customization" (no dedicated GPU needed). Together AI is the fallback if
  Fireworks doesn't fit once we're hands-on with it.

## What's next

1. Build category B (`intent_classify` first — highest value) and C generators.
2. Build a small held-out eval harness: run the eval JSONL through a candidate model, score
   exact-match / schema-valid / field-level accuracy per task, so model and base choices are
   measured, not guessed.
3. **Needs Noah:** create a Fireworks AI account and an API key. I can't sign up for a paid
   third-party service on your behalf — that's the one blocking step. Once the key exists, add
   it to `.env.local` as `FIREWORKS_API_KEY` and I'll wire up the actual submission (dataset
   upload -> fine-tune job -> eval -> a `LOCAL_LLM_URL`-style route in `lib/llm/` that
   `t1Json`/`t1Text` can call instead of Gemini).
4. Once a fine-tuned model beats Gemini Flash-Lite on the eval set for a given task, swap that
   one task's call site over — task by task, not a single big cutover, so a regression is
   caught early and stays cheap to revert.
