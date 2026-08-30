# Spec — Phase 0 hub skeleton

*Draft, 2026-08-30. Target shape for the smallest working version of the hub. Everything here
gets reconciled against Doug's Calliad code once the repo is in hand (§12 of PLAN.md) — reuse
its PWA adapter, OAuth, LLM-call layer, and nudge scheduler; the new/adapted parts are the DB
schema, router contract, audit format, and spend-cap logic below.*

---

## 1. Phase 0 scope

The smallest thing that proves the loop:

> a message comes in → the router decides → the brain replies **in persona** → every step is
> logged **with token cost** → there's a kill switch.

**In:** inbound HTTP (chat + webhook receiver), the router seam (dumb for now), the brain call
wrapper with cost accounting + spend cap, the SQLite store, the append-only audit log, the
kill switch, config/secrets loading, the scheduler wired but idle.

**Deferred:** Gmail/Calendar integrations, real memory retrieval and the profile *slice*
(Phase 0 loads all of `profile.md` as text), proactive triggers, the approval queue being
exercised (schema exists, unused), voice, multi-user.

---

## 2. Module layout

Target tree (adapt to Calliad's actual structure after the repo lands). Assumes TypeScript,
matching Calliad's stack.

```
calliad-hub/
  src/
    index.ts             entry — start server + scheduler, load config, open DB
    config.ts            env/secrets loading + startup validation (fail fast)
    killswitch.ts        global pause flag (off | pause_proactive | pause_all)

    server/
      http.ts            POST /chat, POST /webhook/:source, GET /health, POST /admin/killswitch
      auth.ts            shared-secret / token checks for inbound (reuse Calliad's)

    scheduler/
      cron.ts            job registry — Phase 0 registers only an hourly no-op heartbeat

    router/
      route.ts           normalized event → RouteDecision  (see §5)
      tiers.ts           T0/T1/T2/T3 definitions + model IDs + price table

    brain/
      call.ts            model call wrapper: streaming, retries, usage capture, spend cap (§6)
      prompt.ts          system-prompt assembly — see specs/system-prompt-assembly.md

    memory/
      db.ts              connection + migration runner
      migrations/        0001_init.sql, ...
      conversations.ts   threads + message history
      audit.ts           append-only writer + cost denormalization (§4)
      actions.ts         pending-action queue (schema only in Phase 0)

    surface/
      pwa.ts             adapter to Doug's Calliad PWA — send/receive/stream

  data/
    calliad.db           SQLite (Phase 0–3; revisit Postgres at multi-user)
  .env
```

---

## 3. Data model

SQLite for Phase 0–3. **`profile.md` stays the human-authoritative source of truth** and is
loaded as text at startup — no `profile_facts` table yet (that arrives in Phase 1 with the
slice logic). The DB holds only runtime state and the append-only record.

### Phase 0 tables

```sql
-- Runtime flags and counters. One row per key.
CREATE TABLE config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL            -- ISO 8601 UTC
);
-- seeded: killswitch_level='off', spend_cap_usd_month, spend_month='YYYY-MM',
--         spend_month_to_date_usd='0'

CREATE TABLE conversations (
  id         TEXT PRIMARY KEY,        -- uuid
  surface    TEXT NOT NULL,           -- 'pwa' | 'cron' | 'webhook'
  started_at TEXT NOT NULL,
  last_at    TEXT NOT NULL,
  title      TEXT
);

CREATE TABLE messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role            TEXT NOT NULL,      -- 'user' | 'assistant' | 'system'
  content         TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_messages_conv ON messages(conversation_id, created_at);

-- Append-only. No UPDATE, no DELETE. The single source for "what did it do / cost".
CREATE TABLE audit_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       TEXT NOT NULL,            -- ISO 8601 UTC
  kind     TEXT NOT NULL,           -- see §4 enum
  actor    TEXT NOT NULL,           -- 'noah' | 'calliad' | 'system' | 'cron'
  ref      TEXT,                    -- conversation id / action id / job name
  payload  TEXT NOT NULL            -- JSON, kind-specific
);
CREATE INDEX idx_audit_ts ON audit_log(ts);
CREATE INDEX idx_audit_kind ON audit_log(kind, ts);

-- Denormalized cost rows (also present as audit_log 'model_call' entries) for easy summing.
CREATE TABLE model_calls (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  ts               TEXT NOT NULL,
  conversation_id  TEXT,
  purpose          TEXT NOT NULL,   -- 'chat' | 'brief' | 'extract' | 'route' | ...
  tier             TEXT NOT NULL,   -- 'T1' | 'T2' | 'T3'
  model            TEXT NOT NULL,
  input_tokens     INTEGER NOT NULL,
  cached_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens    INTEGER NOT NULL,
  cost_usd         REAL NOT NULL,
  latency_ms       INTEGER
);
CREATE INDEX idx_model_calls_ts ON model_calls(ts);

-- Schema present in Phase 0, exercised in Phase 2.
CREATE TABLE actions (
  id          TEXT PRIMARY KEY,
  ts          TEXT NOT NULL,
  kind        TEXT NOT NULL,        -- 'send_email' | 'create_event' | 'book' | 'merge_pr' | ...
  summary     TEXT NOT NULL,        -- human-readable, shown to Noah for approval
  risk_tier   TEXT NOT NULL,        -- 'silent' | 'confirm' | 'named_consequence'
  status      TEXT NOT NULL,        -- 'pending' | 'approved' | 'rejected' | 'done' | 'failed'
  payload     TEXT NOT NULL,        -- JSON — everything needed to execute
  created_by  TEXT NOT NULL,        -- conversation id or job name
  decided_at  TEXT,
  executed_at TEXT,
  result      TEXT
);
```

### Phase 1+ tables (reserved — not created in Phase 0)

- `profile_facts(key, value, section, source, confirmed, updated_at)` — structured, drives the slice
- `open_loops(id, title, body, due_at, status, source, tags, created_at, updated_at)`
- `people(id, name, relationship, birthday, pronouns, notes_md, updated_at)`
- `people_observations(id, person_id, observation, confidence, status, source, created_at)` — propose→confirm
- `taste_log(id, title, kind, verdict, why, dated, created_at)`

---

## 4. Audit log format

Every meaningful step writes one row. `kind` is a closed enum:

| kind | when | payload highlights |
|------|------|--------------------|
| `inbound_message` | a message hits `/chat` | conversation_id, text, surface |
| `trigger_fired` | a cron/webhook trigger fires | job name, trigger data |
| `route_decision` | router returns | the full `RouteDecision` + `reason` |
| `model_call` | a brain call completes | model, tier, purpose, token counts, cost_usd, latency_ms |
| `tool_call` | a tool runs | tool name, args (fenced), result summary, ok/err |
| `action_proposed` | an action is queued | action id, kind, risk_tier, summary |
| `action_decided` | Noah approves/rejects | action id, decision |
| `action_executed` | an approved action runs | action id, result, ok/err |
| `outbound_message` | Calliad replies | conversation_id, text, surface |
| `spend_cap` | cap hit / near | month_to_date, cap, what was done (downgrade/defer/allow-with-note) |
| `killswitch` | level changed | old level, new level, actor |
| `error` | anything unhandled | where, message, stack (truncated) |

Rules: append-only (no updates/deletes), `ts` is ISO 8601 UTC, timestamps for *display* are
converted to Noah's current zone at read time. Untrusted content inside a payload (email
bodies, web text) is stored as-is but marked `"untrusted": true` at its key.

---

## 5. Router contract

```ts
type InboundEvent = {
  source: 'pwa' | 'cron' | 'webhook';
  kind: 'message' | 'trigger' | 'webhook';
  text?: string;              // for messages
  payload?: unknown;          // for triggers/webhooks
  conversationId?: string;
};

type RouteDecision = {
  handled: 'rule' | 'brain';     // 'rule' → no model call, router answered it
  tier: 'T0' | 'T1' | 'T2' | 'T3';
  mode: 'default' | 'study-coach' | 'italian-tutor' | 'careful-engineer'
      | 'document-extraction' | 'brief';
  tools: string[];               // tool names to expose this turn
  persona: 'full' | 'terse';
  reason: string;                // logged verbatim in route_decision
};
```

**Order of operations:**
1. Check the kill switch. `pause_all` → short-circuit: proactive events are dropped (logged);
   a direct message from Noah gets a one-line "I'm paused" reply. `pause_proactive` → proactive
   events dropped/logged; messages proceed normally.
2. Phase 0 logic is intentionally dumb — any inbound message returns
   `{ handled:'brain', tier:'T2', mode:'default', tools:[], persona:'full', reason:'phase0 passthrough' }`.
   The heartbeat trigger returns `{ handled:'rule', ... }` and just writes an audit row.
3. Phase 2 makes this smart (intent classification, tier/mode/tool selection). The **interface
   is the contract**; the intelligence is later.

---

## 6. Brain call wrapper (`brain/call.ts`)

Per call:

1. **Spend-cap pre-check.** Roll `config.spend_month` if the month changed (reset MTD to 0).
   If `spend_month_to_date_usd >= spend_cap_usd_month`:
   - proactive purpose → **defer**: don't call, log `spend_cap`, queue a note for the next brief.
   - direct Noah message → **downgrade** to T1 (or local later); if already T1, proceed and
     have the reply note the cap. Always log `spend_cap`.
2. **Assemble** the prompt via `brain/prompt.ts` (see the assembly spec).
3. **Call** the model, streaming, with `max_tokens` sized to purpose; 2 retries on transient
   errors with backoff.
4. **Capture** `usage` (input / cached / output tokens), compute `cost_usd` from `tiers.ts`
   price table, measure latency.
5. **Record** a `model_calls` row + an `audit_log` `model_call` entry. Increment
   `spend_month_to_date_usd`.
6. **Return** the streamed text to the caller (which forwards it to the surface + saves a
   `messages` row + logs `outbound_message`).
7. Hard failure after retries → log `error`, return a short in-persona fallback
   ("Something broke on my end, try that again in a minute.").

---

## 7. Inbound HTTP surface

| Route | Auth | Phase 0 behavior |
|-------|------|------------------|
| `POST /chat` | inbound shared secret | body `{ text, conversationId? }` → route → brain → stream reply (SSE if the PWA supports it). Creates a conversation if none. |
| `POST /webhook/:source` | per-source secret | log `trigger_fired`, return `200`. No processing yet. |
| `GET /health` | none | `200 {ok:true, killswitch, spendMonthToDate}` |
| `POST /admin/killswitch` | admin secret | body `{ level: 'off'|'pause_proactive'|'pause_all' }` → update `config`, log `killswitch`. |

---

## 8. Scheduler

A cron registry (`scheduler/cron.ts`). Phase 0 registers **one** job: an hourly heartbeat that
writes an `audit_log` `trigger_fired` row (`job: 'heartbeat'`) and nothing else — proof the
scheduler is alive. Phase 1 adds the 6:30 morning brief and the deadline/loop trigger sweep.

---

## 9. Config / secrets (`.env`, validated at startup)

| Var | Purpose |
|-----|---------|
| `ANTHROPIC_API_KEY` | Noah's **own** key, own account, own billing |
| `SPEND_CAP_USD_MONTH` | hard monthly ceiling (start low, e.g. `10`) |
| `DB_PATH` | default `./data/calliad.db` |
| `INBOUND_SHARED_SECRET` | `/chat` + `/webhook` auth (reuse Calliad's scheme) |
| `ADMIN_SECRET` | `/admin/*` auth |
| `PWA_*` | base URL + push credentials for the Calliad PWA adapter (from the repo) |
| `TZ_DEFAULT` | `America/New_York` (term); Noah's rhythm is bi-coastal — see profile |

Startup fails loudly if any required var is missing.

---

## 10. Phase 0 acceptance test

1. `POST /chat {text:"what's my week look like"}` with the secret →
2. `route_decision` logged as T2/default/passthrough →
3. brain assembles (persona + full `profile.md`), calls Claude, streams an **in-persona** reply →
4. `model_calls` has a row with input/output token counts and a non-zero `cost_usd` →
5. `audit_log` contains, in order: `inbound_message`, `route_decision`, `model_call`, `outbound_message` →
6. `POST /admin/killswitch {level:'pause_all'}` → next `/chat` returns the paused reply, logs `killswitch` then `outbound_message` →
7. set `SPEND_CAP_USD_MONTH=0.001`, restart, send a message → reply still comes (downgraded or with a note), `spend_cap` logged.

If all seven pass, Phase 0 is done and Phase 1 (integrations + real memory) can start.

---

## 11. Reconciliation checklist (do after the repo lands)

- [ ] Fork vs. shared-core vs. separate (decision #9).
- [ ] Map these modules onto Calliad's real layout.
- [ ] Reuse: PWA adapter, inbound auth, OAuth, LLM-call layer, nudge scheduler.
- [ ] Keep as new/adapted: DB schema, router contract, audit format, spend-cap logic, kill switch.
- [ ] Confirm the model/price table against the API (don't hardcode from memory).
