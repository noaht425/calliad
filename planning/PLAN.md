# Calliad — Planning Doc

*A personal assistant, in the spirit of Jarvis. Noah's build. Forked in concept from Doug's Calliad; will diverge.*

**Status:** planning / pre-Phase 0. No code yet.
**Last updated:** 2026-08-29

---

## 1. What this is

A private, always-available assistant that helps Noah plan and run his day — starting from
**calendar + coursework** (assignments due, exams coming up, what to study) and expanding
outward into travel, cooking, languages, projects, and more.

It is **not**:
- a chatbot you open and talk to and then forget
- an app that calls an LLM in a loop
- tied to Noah's personal Claude subscription, or to the A Bent Fork project

It **is**:
- event-driven — plain code watches; the model only reasons when there's something to reason about
- proactive (slightly forward-leaning, tunable)
- read-mostly to start; every action that changes the world is gated by explicit approval
- meant to sound like a person with a personality, not "an AI"

### Relationship to Doug's Calliad

Doug's Calliad already has: **a working PWA** (Noah's chat surface — decision #2 is settled on
reusing it), an LLM brain, Gmail (Travel label) + Google Calendar read access with working
OAuth, a reading/watch list, and proactive nudges. This project **reuses those modules where it
can** and diverges where a separate, single-user-now / multi-user-later tool needs something
different. Decision on "fork the repo vs. shared core vs. fully separate" is deferred until Noah
has read the Calliad code (see §12).

---

## 2. Design principles

1. **Separate from everything else.** Own Anthropic API account, own key, own billing, own
   repo. Isolated from Noah's personal Claude usage *and* from A Bent Fork.
2. **Event-driven, never an LLM in a poll loop.** Code checks "is there anything new?"; the
   model interprets only when the answer is yes.
3. **Tiered models.** Use the cheapest tier that does the job. Escalate deliberately.
4. **Read-mostly.** Every world-changing action (book, send, merge, reserve) passes through a
   graduated-authorization gate. Built once, reused everywhere.
5. **Deterministic tools for anything that must be correct** — prices, legality, Latin/Greek
   paradigms, song IDs. The model orchestrates and narrates; the tool is the source of truth.
6. **Sounds like a person, not an AI.** First-class requirement, not a polish pass (see §6).
7. **Descriptive, not substitutive.** Orient Noah; don't do his reading or thinking for him.
   Reading-list blurbs say what a piece is *about*, never its conclusions. Study help points
   at what to focus on, doesn't hand over answers.
8. **Minimize recurring cost.** Prefer one-time. Start hybrid (cloud brain, hard spend cap);
   revisit local hardware once the audit log shows real usage numbers — not before.
9. **Absorb, don't reinvent.** Calliad's Gmail/Calendar/OAuth/nudge code is reuse, not a
   rewrite target.
10. **Personal now, multi-user later.** Don't architect in a way that blocks per-user context.

---

## 3. Architecture

```
        triggers                       hub  (always-on, lightweight)                  Noah
  ┌────────────────────┐      ┌───────────────────────────────────────────┐    ┌──────────────┐
  │ cron scheduler     │      │  router                                   │    │ chat surface │
  │ Gmail push (Pub/Sub)│─────▶│    → needs the brain? which tier?         │───▶│ Calliad PWA  │
  │ Calendar watch     │      │    → needs a tool? which mode/persona?     │    │  (→ voice)   │
  │ inbound webhooks   │      │              │                            │    └──────────────┘
  │ Noah messaging it  │      │   ┌──────────┴───────────────┐            │
  └────────────────────┘      │   │ brain                    │            │
                              │   │  T0 rules → T1 cheap →    │            │
                              │   │  T2 cloud → T3 on request │            │
                              │   └──────────┬───────────────┘            │
                              │              │                            │
                              │  integrations│   memory      action queue │
                              │  (Gmail,     │   • profile    (approve /   │
                              │   Calendar,  │   • open loops   reject)    │
                              │   GitHub,    │   • taste log              │
                              │   flights…)  │                audit log   │
                              └───────────────────────────────────────────┘
```

### Components

| Component | Responsibility |
|---|---|
| **Triggers** | Cron scheduler; webhook receivers (Gmail Pub/Sub push, Calendar watch, generic inbound); the chat endpoint where Noah talks to it. |
| **Router** | Decides: does this need the model at all? Which tier? Which tool(s)? Which mode/persona? Cheap or rule-based. |
| **Brain** | The reasoning call. Assembles context + memory slice + tool defs, calls the right model tier, returns a response or a tool plan. |
| **Integrations** | One module per external service. Each exposes typed read functions now; write functions later, all behind the auth gate. Capability registry lists what's available. |
| **Memory** | Profile facts, open loops (working state), taste log. Brain reads a *relevant slice*, not the whole store. |
| **Action queue** | Pending world-changing actions awaiting Noah's approval. Approve/reject via chat or a small web view. |
| **Audit log** | Append-only. Every trigger, model call (with token counts + $), tool call, and action. This is how cost and behavior stay legible. |
| **Interfaces** | The **Calliad PWA** (Doug already built one — reuse it, arrives with the repo). Phase 3 adds voice on top of it. Phase 5: ambient / dedicated device. |

### Where it runs

The hub is light — the heavy/expensive part is only the model calls. Phase 0–3 can run on a
home machine or a ~$5–10/mo VPS (decision pending, §11). Local model hardware, if it happens,
is Phase 4.

### How a request flows — worked example (syllabus → exam nudge)

1. **Ingestion.** Noah forwards a syllabus PDF to the hub. Webhook receiver stores the raw file.
2. **Route.** Router sees "new document, type=syllabus" → send to brain with the
   *document-extraction* mode.
3. **Extract (T2).** Brain returns structured items: `{course, exam_date, topics[], weights,
   assignment_due_dates[]}`. Stored as open-loop items with dates.
4. **Schedule.** Cron now has date-anchored items. Nothing else happens for days.
5. **Trigger (T0, no model).** 72h before the exam date, a rule fires: "exam in 3 days."
6. **Compose (T2).** Brain builds a nudge: exam date, highest-weight topics, what Noah has and
   hasn't touched (from open loops / past conversations), delivered in persona.
7. **Deliver.** Message hits the chat surface: *"Latin midterm Thursday. Heaviest stuff is
   indirect statement and the subjunctive uses — you've asked me about neither. Want a focus
   plan?"*
8. **Refine (H).** Noah: "yeah, and I have 3 hours tonight." Brain uses the held result +
   the new constraint. No re-extraction.

Total model spend for the whole arc: a handful of T2 calls. Everything between steps 4 and 5
is free.

---

## 4. Pattern library

The capabilities Noah wants (§8) are combinations of these. A new domain ("help with my
taxes") is just "which patterns?"

| ID | Pattern | What it means | Shows up in |
|----|---------|---------------|-------------|
| **A** | **Standing profile** | A model of Noah applied without being re-told. It proposes new facts; he confirms. | flights, animal ID, recipes, Italian level, taste |
| **B** | **Context injection** | Every query is enriched with what's known — location, calendar, term dates, active projects — before the model sees it. | animal ID, study focus, most things |
| **C** | **Source ingestion → structured data** | Feed it a document; it extracts typed items (dates, amounts, topics) that then drive reminders and reasoning. | syllabus, later: leases, tickets, reading lists |
| **D** | **Search → shortlist → hand-off** | Assistant does the legwork, presents options, Noah pulls any irreversible trigger. | flights, reservations, feature-merge |
| **E** | **NL front-end to a tool** | Say it in English; assistant picks the invocation, runs it, explains the result. Tool is deterministic; model translates + narrates. | repo work, MTG sim, morphology |
| **F** | **Deterministic tool for correctness** | Never freehand a fact that can be looked up. Model orchestrates; tool is truth. | morphology, card/flight prices, song ID, game rules |
| **G** | **Mode switching** | One brain, different stance + tool access + output style, triggered by intent. | Italian tutor, careful-engineer, study coach |
| **H** | **Do-then-refine (working state)** | Assistant holds the last result so a follow-up doesn't restart from zero. | MTG ("now buff Archelos"), flights, study plan |
| **I** | **Routing by stakes + difficulty** | A sub-cent lookup and a multi-minute agent run get sized differently. | everything, via the router |
| **J** | **Graduated authorization** | Every world-changing action has a risk tier; confirmation friction scales: silent → one tap → explicit acceptance of a named consequence. | reservations w/ fee, flights, code merge, add-to-abentfork |
| **K** | **Frictionless capture** | Send it a thing (link, book rec, restaurant name); it files it on the right list with the right metadata, no forms. | reading/watch/book lists |
| **L** | **Taste modeling** | A longitudinal log of reactions → "would I like X?" judgments. Cold start (~15–20 items). Never spoils. | watch/book "would I like this" |
| **M** | **Descriptive, not substitutive** | Blurbs give subject + scope, never findings. Study help orients, doesn't answer. | reading list, study focus |
| **N** | **Spaced repetition over own material** | Active-recall quizzing over what Noah is actually learning (Latin, Greek, Italian) — not generic trivia. | "keep my mind sharp" |

### Cross-cutting: personality (see §6) is a principle, not a pattern.

---

## 5. Model tiers & routing

| Tier | Model | Used for | Notes |
|------|-------|----------|-------|
| **T0** | none (rules) | "New email in watched label? Exam within 72h? Assignment due within 48h?" | Free. Most triggers resolve here. |
| **T1** | cheap — cloud Haiku now, local 7–8B later | classification, "does this need attention?", field extraction, first-draft text | Free at the margin once local. |
| **T2** | cloud Sonnet | conversation, planning, morning brief, document extraction | Metered. Prompt-cache the stable prefix. Under the spend cap. |
| **T3** | cloud Opus | hard reasoning Noah explicitly asks for | Rare. Deliberate. |
| **delegated** | Claude Code / Agent SDK on a branch | "implement feature X" (idea 4) | Not the local brain. Runs tests, returns a diff, never auto-merges. |
| **worker** | a compute job, not necessarily an LLM | MTG sim runs (idea 5) | Assistant invokes + interprets. |

**Router logic** (cheap/rule-based): intent → mode → tier → tools. Persona/register also set
here (terse when Noah's moving, expansive when chatting).

**Cost note:** Phase 1 can collapse T1 into cloud Haiku and skip local entirely — keeps the
build simple; cost stays pennies/day. Local hardware is a Phase 4 decision driven by the
audit log.

---

## 6. Personality

A **first-class requirement.** Concretely:

- **Defined persona** — a name, a consistent voice, dry humor, actual opinions. Jarvis is the
  reference: wry, understated, genuinely helpful, will gently push back.
- **It has takes.** "Would I like this show?" → *"Probably not — it's the slow-burn ensemble
  kind you bailed on with [X]"*, not *"It depends on your preferences!"*
- **No AI-tells:** no "As an AI," no "I'd be happy to help!", no listicle answers to
  conversational questions, no reflexive hedging, no over-explaining.
- **Continuity is half of personhood.** It remembers the last conversation and refers back.
  Memory does a lot of this work.
- **Register-matches Noah** — concise when he's busy, more expansive when he's chatting.
- **Boundary:** personality is *delivery*. It must never bleed into fake confidence on facts.
  Persona for tone; tools for truth.

**Implementation:** strong persona system prompt + few-shot voice examples + explicit *don't*
rules + short-by-default. Consequence: the conversational surface wants **at least Sonnet-tier** —
small local models hold a persona noticeably worse. This trades against the no-recurring-cost
goal; decide deliberately (§11).

**Canonical doc: `persona.md`** (v1.0, voice locked 2026-08-29). Name Calliad (Cal/Calli),
non-binary / they-them, addresses Noah as "Noah". Contains the voice principles, the
"AI-tell" anti-pattern list, the reminder/nudge tone rules (ADHD/OCD/anxiety-aware), and an
18-example calibrated few-shot set ready for the system prompt.

---

## 7. Memory model

| Store | Contents | Seeded how |
|-------|----------|------------|
| **Profile facts** | Who Noah is, preferences (budget ranges, airline/seat/time prefs, dietary), people he cares about + their birthdays, recurring commitments, Italian level, what he's studying. | Hand-seeded; assistant proposes additions, Noah confirms. |
| **Open loops** | Working state. *"Latin midterm 10/16: indirect statement ✗, subjunctive ✗."* *"SF trip 9/12–15: flight ✓, hotel ✗, rental ✗."* | Written by triggers + conversations. |
| **Taste log** | Longitudinal: books/shows/films + Noah's reaction + why. Feeds pattern L. | Start logging Phase 1, before "would I like this" is any good. |
| **People files** | One growing note per person in Noah's orbit — beyond name + birthday. Habits and preferences relevant to Noah's dealings with them: *"Tomasso — notices who did the reading; email over Slack; slow on weekends."* Professors, family, friends. | Noah tells it directly; it proposes patterns it sees in his calendar/email; Noah confirms. |

- **People files — scope & privacy.** Store only what's relevant to Noah's interactions
  (professional habits, preferences, logistics, dates). Not surveillance, no sensitive
  inference. Private to Noah's store, never shared. Same propose-then-confirm consent as
  profile facts.
- **Neuro-aware nudging.** Noah has ADHD, OCD, and anxiety (`profile.md`). The trigger/
  interruption layer reflects it: reminders are load-bearing, each nudge carries **one clear
  next action** not a digest, "did I / is it" questions get answered once without feeding a
  re-check loop, and the tone stays calm and non-alarmist (persona.md § "Tone for reminders").
  **Quiet hours 1–7 AM** (urgent only). **Active check-ins over checkbox reminders** for things
  he won't tick off (medication is the known case — the passive Apple reminder fails for him).
- **Retrieval:** the brain gets a *relevant slice* (tag/scope filter now; embeddings later),
  not the whole store.
- **Storage:** one database (SQLite for single-host simplicity; Postgres if/when multi-host or
  multi-user — decision pending §11). Same DB holds the audit log and action queue.

---

## 8. Capability catalog

Ordered by when it makes sense to build, not by the order ideas arrived. Each maps to §4 patterns.

### Anchor — the reason it earns daily use

| Capability | Patterns | Phase | Notes |
|---|---|---|---|
| **Day/week schedule + coursework** — assignments due, exams approaching, what to study | C, B, D(nudge), H, M | **1–2** | Highest value-to-effort. Syllabus ingestion is the engine. This is idea 3 + Noah's original priority #1, merged. |

### Cheap early wins (make it feel alive)

| Capability | Patterns | Phase | Notes |
|---|---|---|---|
| Context-injected Q&A — "what animal was this?" (location + details) | B | 1 | Add photo/vision later. Web search optional. Low stakes. |
| Recipe help — search A Bent Fork + substitutions/instructions | E, F | 1 | Queries Noah's own app via a tool + general cooking knowledge. |
| Reading/watch/book capture + **neutral** blurb | K, M | 1 | Blurb = subject + scope, *never* findings. Prompt-enforced. |
| Italian — idioms, phrasing, **converse-in-Italian** practice mode | G | 1–2 | Mostly mode/prompt design. "Localize idioms, don't transliterate." Correction-on, level-aware. |
| Spaced-repetition quizzing over study material (Latin, Greek, Italian) | N, G | 2 | The "keep sharp" idea done well. Avoid model-generated factual trivia. |

### Judgment + light action

| Capability | Patterns | Phase | Notes |
|---|---|---|---|
| Latin/Greek morphology — "conjugate X", "decline Y" | F, E | 2 | **Must** be tool-backed: Whitaker's Words / Morpheus (Perseus) / CLTK. Models make paradigm errors. (`mercātor` is a noun — decline it; the deponent verb is `mercor, mercārī`.) |
| "Would I like this?" for shows/books/films | L, A | 2 | Needs taste log with signal. Candidate metadata: TMDB/OMDb (screen), Open Library/Google Books. No spoilers. |
| Flight search — preference-aware, shortlist, **book-it-yourself** | A, D, F | 2 | Real flight API: Amadeus Self-Service / Kiwi (Tequila) / SerpAPI Google Flights. **No scraping airline sites.** Never books. |
| Restaurant — pick place/time, hand over a deep link + details | J, D | 2 | Programmatic booking is blocked (Resy: no public API; OpenTable: partner-only). Decision + hand-off only. Fee → explicit-acceptance gate if execution ever added. |
| Confirmation-gated actions — draft email, calendar hold, add task | J | 2 | First real writes. All through the auth gate. |

### Delegated / heavier

| Capability | Patterns | Phase | Notes |
|---|---|---|---|
| Name that song | F | 3 | Live audio → fingerprint API (AudD / ACRCloud). Lyric fragment → search. Humming → weak, no good API. Uses the mic infra built for voice. |
| Implement a feature in a repo, with guardrails | delegated + D | 3+ | Invokes Claude Code on a branch — runs tests, returns a diff, **never auto-merges** (explicit merge approval = pattern J). Assistant is the front door + guardrail enforcer, not the coder. |
| MTG sim — "run 5,000 games of A vs B vs C, tell me who's winning and why" | E, F, H | 3+ | Sim already exists (from Cowork). Two asks: *run + interpret* (worker + narration), and *"buff Archelos cheaply"* (deckbuilding reasoning + Scryfall for price/legality). Keep separate. |

---

## 9. Phased roadmap

### Phase 0 — Foundations

**Detailed design: `specs/hub-skeleton.md` and `specs/system-prompt-assembly.md`** (drafted
pre-repo; reconcile against Calliad's code once it lands — see the checklist at the end of each).

- [ ] Own Anthropic API account + key; **hard monthly spend cap** (start ~$10).
- [ ] Decide host (home machine vs. VPS) — §11.
- [ ] Hub skeleton per `specs/hub-skeleton.md`: cron scheduler (idle bar a heartbeat), inbound
      endpoints (`/chat`, `/webhook/:source`, `/health`, `/admin/killswitch`), SQLite store,
      **append-only audit log**, spend-cap logic, secrets/config.
- [ ] Chat surface = the **Calliad PWA** Doug already built. Point it at the new hub (comes with the repo — no separate setup).
- [ ] Persona: `persona.md` v1.0 few-shot set + rules, assembled per `specs/system-prompt-assembly.md`.
- [ ] One path end-to-end: Noah messages it → T2 call → in-persona reply → logged with token counts + $.
- [ ] Kill switch (`pause_proactive` / `pause_all`).
- [ ] Pass the Phase 0 acceptance test (`specs/hub-skeleton.md` §10).

### Phase 1 — Read-only awareness + the anchor
- [ ] Gmail (read, one label to start) + Google Calendar (read + watch) modules — reuse Calliad's OAuth/refresh.
- [ ] Memory: profile facts + open loops, hand-seeded. Start the taste log.
- [ ] Source ingestion: syllabus/PDF → structured items (due dates, exams, topics, weights).
- [ ] Morning brief (cron): today/this week, assignments due, exams approaching, overnight items needing a decision.
- [ ] Triggered nudge v1: assignment due in 48h / exam in 72h → surface + offer a focus plan.
- [ ] Frictionless capture v1: send a link → reading list + neutral descriptor.
- [ ] Cheap-win Q&A: animal ID, quick facts, recipe lookup.
- [ ] All cloud (T2 + Haiku for classification). Watch the cost ledger.

### Phase 2 — Judgment, light action, more domains
- [ ] Router + tier logic formalized.
- [ ] **Graduated-authorization gate** — build once: risk tiers, scaling confirmation friction.
- [ ] Confirmation-gated writes: draft email, calendar hold, add task.
- [ ] Flight search (real API) → shortlist + booking link.
- [ ] Restaurant: pick place/time → deep link + details.
- [ ] "Would I like this?" once taste log has signal; metadata APIs wired.
- [ ] Classics morphology tool wired as a deterministic tool.
- [ ] Italian tutor + converse-in-Italian modes.
- [ ] Spaced-repetition quiz over study material.
- [ ] Tune interruption policy from real logs.

### Phase 3 — Voice + delegated agents

**Voice is added *onto the Calliad PWA*, not a new surface.** It's a pipeline in front of the
same router → brain → memory → tools core — the hub itself doesn't change, each stage is an
added input/output adapter. STT (Whisper) and TTS (Piper) both run locally for **no recurring
cost** once there's hardware for them; cheap cloud STT/TTS are the fallback for early testing.

- [ ] **Stage 1 — voice notes (async).** A hold-to-talk button in the PWA. Audio → **speech-to-text**
      (Whisper, local or API) → transcript runs through the normal brain → reply comes back as
      text, and optionally as an audio clip via **text-to-speech** (Piper, local; or a nicer
      cloud voice). No latency pressure — it's push-to-talk, not a live call. ~80% of the
      "talking to it" feel for ~20% of the work.
- [ ] **Stage 2 — live conversation (push-to-talk, low latency).** Same pipeline, streamed:
      audio streams to STT while Noah talks so the transcript is ready the instant he stops;
      the brain's reply streams token-by-token into TTS so speech starts mid-sentence. Target
      ≈1 s from "stops talking" to "starts talking." Needs streaming STT + streaming model call
      + streaming TTS wired together. Real step, well-trodden.
- [ ] **Stage 3 — hands-free / wake word.** The PWA (phone in a stand) listens *locally* for
      "Calliad" / "Cal". The wake-word detector (openWakeWord / Porcupine) runs entirely
      on-device — nothing streams anywhere until Noah has addressed it. After the wake word,
      it's the Stage 2 pipeline.
- [ ] *Stage 4 — dedicated always-on device* lives in **Phase 4/5** (a Pi or mini PC running
      Stage 3 permanently as a thin client; brain can stay in the cloud, the device is just
      ears + mouth).

**Also in Phase 3:**
- [ ] Name-that-song: live audio → fingerprint API; lyric fragment → search.
- [ ] Delegated coding: "add X to project Y" → Claude Code on a branch, tests, diff for review, explicit merge approval.
- [ ] MTG sim front-end: NL → worker invocation → run + interpret; follow-up deckbuilding w/ Scryfall.

### Phase 4 — Local brain (only if the ledger says so)
- [ ] Read real monthly spend + dominant call types from the audit log.
- [ ] If worth it: mini PC / Mac mini, local model via Ollama; point T1 + easy-T2 local; cloud for the hard tail behind the cap.
- [ ] Decide from testing whether the persona surface can move local or stays cloud.
- [ ] Optional: dedicated Pi / mini PC as always-on voice endpoint (**Phase 3 Stage 4** — wake word + STT + TTS), thin client to the hub.

### Phase 5 — Ambient / multi-user
- [ ] Always-on mic device(s), room presence.
- [ ] Multi-user: distinguish who's talking, per-person context/profile (Noah first).
- [ ] Home-automation hooks (optional, long tail).

---

## 10. External dependencies & cost ledger

*Cost category **separate** from the LLM bill. Most have free tiers that cover one person.*

| Need | Option(s) | Cost for personal volume |
|---|---|---|
| LLM | Anthropic API | Pay-per-token, **hard cap**. Est. $15–40/mo heavy use before local offload. |
| Email / Calendar / Tasks | Google APIs | Free |
| Flight data | Amadeus Self-Service (free tier) · Kiwi Tequila (free) · SerpAPI Google Flights (paid past free tier ~$50/mo — avoid unless needed) | Free if Amadeus/Kiwi suffice |
| Screen metadata | TMDB (free) · OMDb (free tier) | Free |
| Book metadata | Open Library (free) · Google Books (free) | Free |
| MTG cards / prices | Scryfall | Free |
| Latin/Greek morphology | Whitaker's Words (self-host) · Morpheus/Perseus · CLTK | Free |
| Song fingerprint | AudD (trial → paid) · ACRCloud (limited free tier) | ~$0–5/mo |
| Weather | Open-Meteo · US NWS | Free |
| Speech-to-text | Whisper local (free) · Whisper API (cheap) | ~Free |
| Text-to-speech | Piper local (free) · cloud TTS (cheap) | ~Free |
| Hosting (Phase 0–3) | home machine (electricity) · small VPS | $0–10/mo |
| Local model hardware (Phase 4, optional) | Pi ~$120–200 · mini PC / Mac mini ~$500–1200 · + used GPU ~$700–1500 | **one-time** |

---

## 11. Open decisions

| # | Decision | Options / lean |
|---|---|---|
| 1 | Host for Phase 0–3 | Home machine vs. ~$5–10/mo VPS. *Lean: whichever is less fuss to keep always-on.* |
| 2 | ~~Chat surface~~ | **Settled 2026-08-30: the Calliad PWA.** Doug already built one — reuse it, don't stand up a Telegram bot. It's also the surface that carries all the way to voice (Phase 3) and a dedicated device (Phase 5). |
| 3 | Tasks/notes integration | **Apple Reminders** — Noah's actual system (heavy use). Integration path is the open part: iCloud CalDAV, an on-device EventKit bridge, or a Shortcuts hook. Not a greenfield choice. |
| 4 | Database | SQLite (simple, single-host) vs. Postgres (multi-host / future multi-user). |
| 5 | Persona | Name, voice, how Jarvis-like exactly. Needs the few-shot set written. |
| 6 | Spend cap number | Start low ($10?) and raise from real data. |
| 7 | "No recurring cost" — how hard | Currently a preference. If it hardens to a rule, Phase 4 moves earlier and Phase 0 designs local-first. |
| 8 | Personal-data ring (C) | When and what — health, habits, relationships. Deferred until trust is established. |
| 9 | Calliad reuse | Fork repo vs. shared core vs. fully separate. **Decide after reading the Calliad code.** |

---

## 12. What's needed from Calliad

*Checklist for when Doug gives access. This is what turns §3 modules from "new" to "reuse."*

- [ ] Stack, framework, deploy target.
- [ ] **The PWA** — framework, how it talks to the backend, auth, push-notification setup, and
      how hard it is to point at a separate hub (or run a second instance).
- [ ] Gmail + Calendar OAuth: scopes requested, where/how tokens are stored, refresh handling.
- [ ] Data model for captures / reading list / watch list.
- [ ] Proactive nudge mechanism: cron? event triggers? how scheduled, where it runs.
- [ ] LLM call layer: which models, how prompts are assembled, any caching.
- [ ] The webhook receiver pattern (the A Bent Fork *sending* side already exists — see that repo's `/api/webhook/recipe`; not part of this project).
- [ ] Persona/prompt approach, if any.
- [ ] Per-module: reusable as-is vs. needs rework for a separate, single-user-now instance.

Once that's in hand: turn each §3 component and §8 capability into a concrete task list marked
reuse / adapt / new.

---

## 13. Parking lot

*Ideas raised, not yet slotted:*

- Photo/vision input for animal ID and other "what is this?" questions.
- Two-way A Bent Fork integration (assistant → suggest a recipe capture) — lives in that repo, not here.
- Embeddings-based memory retrieval (Phase 2+ if tag/scope filtering isn't enough).
- Batch API (50% off) for non-realtime jobs like overnight brief prep.

---

## 14. Pre-work (before the Calliad handoff)

Things Noah can do now that don't depend on seeing Doug's code.

### Only Noah can do these — they feed Phase 1 directly
- [x] **Seed `profile.md`** — done and rich (identity, academics + PhD apps, Trinity calendar,
      admissions job, languages, food, travel, geography, 26 people + birthdays, health, daily
      rhythm, Apple Reminders usage, music). Small gaps left: Class-of-2027 confirm, assigned
      work hours + which alternating Saturdays, Greek class time.
- [~] **`taste-log.md`** — ~52 entries seeded from favorites + playtime. Still needs a handful of
      **negatives** (things bailed on / disliked). Music covered separately in `profile.md`.
- [ ] **Collect this term's 4 syllabi (PDFs)** into `~/Desktop/Calliad/inputs/`. Class schedule
      and full academic calendar are already in. The syllabi are the test data for the anchor
      feature (syllabus ingestion) — still the top missing item.
- [x] **Persona** — done. `persona.md` v1.0: voice principles, anti-pattern list, nudge-tone
      rules, 18-example few-shot set. Name Calliad (Cal/Calli), they/them, addresses him as "Noah".

### Quick setup
- [ ] **Own Anthropic API account + key**, separate from Noah's personal Claude. Hard monthly
      spend cap (~$10) or prepaid credits with auto-recharge **off**.
- [x] **Chat surface** — settled: reuse Doug's existing Calliad PWA (arrives with the repo). No
      separate setup needed.
- [ ] **Settle open decisions** #1 (host: home machine vs. VPS), #3 (tasks/notes system),
      #4 (SQLite vs. Postgres).
- [ ] **Send Doug §12** so he can prep repo access + answers ahead of time.

### Leave until the Calliad code is in hand
- Google Cloud project / Gmail + Calendar OAuth — copy Calliad's approach rather than set it up twice.
- Hub skeleton, module layout, nudge scheduling.
- The fork-vs-shared-core decision (#9).

### File formats
`profile.md` and `taste-log.md` are **Markdown** — plain text, readable in any editor or the
terminal, trivial to parse into the DB later. Structure comes from consistent headings and
columns, **not** rich formatting. Avoid Word / Google Docs: they optimize for formatting over
structure and are a pain to parse. If Noah would rather keep the taste log in a spreadsheet,
rename it `taste-log.csv` with the same columns — also imports cleanly.
