# Calliad

Noah's personal assistant (Jarvis-inspired). Conceptually forked from Doug's Calliad; will
diverge. Kept entirely separate from A Bent Fork — own repo, own Anthropic API account, own
billing.

**No code yet.** This folder is the planning + profile material. Building starts once Doug's
Calliad repo is in hand.

## Reading order

1. **`PLAN.md`** — the source of truth. Architecture, the pattern library, model tiers, the
   phased roadmap, open decisions, and the §12 checklist for reconciling against Doug's code.
2. **`specs/hub-skeleton.md`** and **`specs/system-prompt-assembly.md`** — Phase 0 design.
   Drafted pre-repo; each ends with a "reconcile against Calliad" checklist.
3. **`persona.md`** — Calliad's voice (v1.0, locked). Identity, the "AI-tell" anti-pattern list,
   reminder/nudge tone rules, an 18-example few-shot set for the system prompt.
4. **`profile.md`** — everything Calliad should know about Noah. Human-authoritative; the
   assistant proposes additions, Noah confirms.
5. **`taste-log.md`** — likes / dislikes / bail patterns, for the "would I like this?" feature.
6. **`inputs/`** — raw source material (Spotify, playtime, favorites, course schedule, academic
   calendar, the preferences summary, Apple Reminders usage). Batch-ingestion data, not
   per-turn context.

Also: the user's cross-session memory (`MEMORY.md` in the Claude memory dir) has
`calliad_assistant_project`, `user_noah_profile`, and related entries — loaded automatically in
a new session.

## Status / what's next

- ✅ Plan, persona, profile, Phase 0 specs.
- ⏳ **Waiting on:** Doug's Calliad repo, and Noah's 4 course syllabi (drop in `inputs/`).
- Small open profile gaps: Class-of-2027 confirm, assigned work hours + which alternating
  Saturdays, Greek class time.

## Bootstrapping a fresh session

> Read `~/Desktop/Calliad/PLAN.md` and everything in `~/Desktop/Calliad/specs/`. Doug's Calliad
> repo is at `<path>`. Let's do the §12 reconciliation.
