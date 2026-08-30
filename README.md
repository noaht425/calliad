# Calliad

Noah's personal assistant — an event-driven hub that helps plan and run the day, starting from
calendar + coursework and expanding outward. Private, single-user for now, multi-user-capable
later. Own Anthropic account, own billing; separate from A Bent Fork.

**Code-seeded** from [`dougt425/calliad`](https://github.com/dougt425/calliad) (@ `6ba0638`,
2026-08-30) — reuses the PWA shell, Supabase auth, web-push, Gmail OAuth, the cron pattern, and
the capture/retrieval data layer. Diverges on the brain (Gemini → Claude, with tiers + caching
+ cost accounting), the memory model, and the graduated-authorization gate. **No upstream
relationship** — the seed was one-time; changes from Doug's repo are cherry-picked by hand.

## Layout

- `app/`, `components/`, `lib/`, `public/`, `supabase/` — the Next.js app (App Router, Vercel).
- `planning/` — the pre-build material: `PLAN.md` (source of truth), `persona.md`,
  `profile.md`, `taste-log.md`, `inputs/`.
- `specs/` — design docs: `hub-skeleton.md`, `system-prompt-assembly.md`, `reconciliation.md`
  (§12 reuse/adapt/new pass against Doug's code), `phase-0-tasks.md` (the build checklist),
  `drafts/` (Phase 0 code drafts staged for drop-in).

## Status

Phase 0 — the hub skeleton: message in → router → Claude replies in persona → every step
logged with token cost → kill switch. See `specs/phase-0-tasks.md`.

## Local dev

```bash
cp .env.local.example .env.local   # then fill ANTHROPIC_API_KEY + the Supabase values
npm install
npm run dev                        # http://localhost:3000  (or: .claude/launch.json → port 3001)
```

Health check: `GET /api/health` → `{ ok, killswitch, spendMonthToDate }`.

> Next.js 16 has breaking changes from earlier versions — see `AGENTS.md` and
> `node_modules/next/dist/docs/` before changing framework-level code.
