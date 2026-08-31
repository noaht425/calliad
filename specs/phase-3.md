# Phase 3 — Voice + delegated agents

Voice is an I/O adapter in front of the same router → brain → memory → tools core;
the hub itself doesn't change. PLAN.md §9 Phase 3.

## ✅ Stage 1 — voice notes (async)

Hold/tap-to-talk in the PWA → STT → the normal brain → streamed text reply, optionally spoken.

- **`lib/llm/groq.ts`** — `transcribe(blob, filename)` → Groq `whisper-large-v3-turbo`
  (`response_format=verbose_json` for `.duration`), records a `model_calls` row
  (tier T1, `purpose:'transcribe'`, cost = duration/3600 × $0.04). `sttAvailable()` gates on
  `GROQ_API_KEY`.
- **`app/api/chat/transcribe/route.ts`** — Supabase-bearer auth, multipart `audio` (+ optional
  `conversationId`), 12 MB / ~2 min cap, 503 if the key is unset, 502 on Groq failure.
  Returns `{ transcript }`.
- **`lib/voice/useVoiceInput.ts`** — shared client hook. `MediaRecorder` with iOS-safe mime
  (`audio/mp4` preferred, **no timeslice** — iOS drops the MP4 init segment with one),
  `getUserMedia` with echo-cancel/noise-suppress, `navigator.vibrate` on start. On stop:
  POST to `/api/chat/transcribe`, hand the transcript to the caller (which drops it straight
  into a turn — no manual send). Surfaces `{ state, error }`; a clip under 2 KB is treated as
  silence and dropped.
- **`components/Chat.tsx` + `components/GlobalChatPanel.tsx`** — `send()` refactored to
  `runTurn(text)` so voice and text share the path. Mic button replaces send when the
  composer is empty; recording = red pulsing stop button; status line shows Recording… /
  Transcribing… / errors. **TTS** (`GlobalChatPanel` only for now): a header toggle; when on,
  `onDone` speaks the full reply via the browser's `speechSynthesis` — free, on-device, no API.

**Needs:** `GROQ_API_KEY` in `.env.local` + Vercel. Free tier covers personal use
(turbo ≈ $0.04/hr of audio, and the free tier's minute allowance is generous).

## ✅ Stage 2 — hold-to-talk + streaming TTS (2026-08-31)

- **`lib/voice/speak.ts`** — `SentenceSpeaker`: `feed(accSoFar)` on each stream delta speaks
  any newly-complete sentence; `flush(full)` on done speaks the rest. Speech starts
  mid-response instead of after it. Browser `speechSynthesis` queues utterances in order.
- **Chat + GlobalChatPanel** — mic is press-and-hold: `onPointerDown` records, pointer
  up/leave/cancel stops and sends. Pointer capture so the gesture survives the finger sliding
  off the button. `Chat.tsx` also gained the TTS toggle (parity with the panel).

**Still open in Stage 2:** true streaming STT for a ~1 s turnaround. Groq's transcription API
is batch-only; real streaming needs Deepgram / AssemblyAI (paid, free credits) or a
self-hosted Whisper WebSocket. Batch STT + streamed reply + streamed TTS is the current shape.

## ⏭ Rest of Phase 3 — each needs a decision or an external piece

- **Streaming STT + Stage 3 hands-free** — **deferred 2026-08-31** (Noah: wants it eventually,
  other work first). When picked back up: AssemblyAI Universal-Streaming is the pick (~$3/mo at
  personal scale, voice-agent-shaped, temp-token browser flow works on Vercel — no new infra);
  ~1 day for a working version (token endpoint + `lib/voice/streamingSTT.ts` WS client +
  rewire the mic button), +½ day for an AudioWorklet if opus framing latency isn't crisp
  enough. Deepgram is the fallback. Batch Groq (~1 s to reply, ~$0.80/mo) stays until then.
- **Stage 3 — wake word** ("Calliad" / "Cal", on-device) — Picovoice Porcupine (free tier,
  browser SDK, access key) or openWakeWord. Comes after streaming STT.
### ✅ Name-that-song (2026-08-31) — needs `AUDD_API_TOKEN`
- `lib/tools/song.ts` — `identifySong(blob)` → AudD `/` recognise (`return=spotify,apple_music`)
  → title/artist/album + streaming links block; `findByLyrics(q)` → AudD `/findLyrics`;
  `isLyricQuery()` regex; `songIdAvailable()` gates on the token. Dark when unset (like TMDB).
- `app/api/song/identify` — Supabase-auth multipart audio → `{ block }` (formatted markdown).
- `useVoiceInput` generalised: `(onResult, { endpoint, pick, conversationId })`. A second
  instance in Chat + GlobalChatPanel drives a **♪ hold-to-capture button** next to the mic →
  `/api/song/identify` → the block is appended as an assistant message inline (no brain call).
- `/api/chat` — a typed lyric fragment ("what's the song that goes '…'") → `findByLyrics` as a
  `toolResult`; a bare "name that song" with no audio → a hint to use the ♪ button.
- **Needs:** `AUDD_API_TOKEN` (audd.io). Free tier for testing, ~$5/mo for regular use.
- **Delegated coding** — **deferred 2026-08-31.** "add X to project Y" → Claude Code on a
  branch → tests → diff → explicit merge. Vercel can't run it; needs an external runner. When
  revived: **GitHub Actions dispatch** is the pick — Calliad fires `workflow_dispatch` on the
  target repo, the workflow runs Claude Code and opens a PR (the PR is the diff, merging is the
  approval). Setup cost: a GitHub token in Calliad's env + a reusable workflow +
  `ANTHROPIC_API_KEY` secret in each target repo. Fallbacks: Anthropic Managed Agents (billed
  beta), or a standalone Agent-SDK worker (Phase 4 infra).
- **MTG sim front-end** — NL → sim invocation → run + interpret.
  - Sim lives at `~/Desktop/mtg_sim_standalone_3` — pure-Python EDH engine, 7 hand-coded decks
    (`archelos lightpaws lathril rocco persephone ares hamza`), no arbitrary decklists.
  - **HTTP wrapper written** (`server.py` + Dockerfile in that folder, `WRAPPER.md` has deploy
    steps): `POST /transcript` (one verbose game, sync), `POST /simulate` (async job, process
    pool — ~300 games/2 s, ~5000/40 s) → `GET /jobs/{id}` with win-rates / win-reason
    histogram / avg turn / crashes. Bearer `SIM_TOKEN`. Imports `engine` directly so engine
    updates need only a redeploy, no wrapper change.
  - **Waiting on:** Noah deploys it (Fly/Railway/Render) → gives the URL + token.
  - **✅ Live (2026-08-31).** Deployed to Fly (`mtg-sim-standalone-3.fly.dev`, `fly scale count 1`
    — the in-memory job store needs a single instance; 2 machines made `/jobs` flap).
    `lib/tools/mtgsim.ts`: `parseSimRequest` (deck ids + trial count from free text, "the pod" →
    rocco/hamza/persephone/ares), `runSimulation` (POST `/simulate` → poll `/jobs/{id}`, ~50 s
    budget, tolerates transient misses; games clamped 100–1500), `runTranscript` (one game,
    last 60 log lines). Wired into `/api/chat`; `maxDuration = 60`. `MTG_SIM_URL` /
    `MTG_SIM_TOKEN` in env. End-to-end verified: 500-game pod run in ~14 s → win-rate table +
    win-reason histogram → brain narrates. No gate (a ≤1500-game run is seconds of free-tier
    compute). Known cosmetic: some `win_reason` strings are just the losing commander's name —
    bumped the wrapper truncation 60→120 chars (needs a `fly deploy` to land).

### ✅ MTG deck analysis — Scryfall, analysis-first (2026-08-31)
Decision: the symbolic sim doesn't generalise to arbitrary decklists (304 bespoke per-card
fields for ~400 cards); a full effect-system rebuild is months. So deck-improvement advice is
**LLM reasoning over accurate card data**, sim reserved for quantitative questions on its
modelled decks. No new keys — Scryfall is free.
- `lib/tools/mtg.ts` — `getCard`/`getCards` (Scryfall `named` fuzzy + `collection` batch, 75/req),
  `parseDecklist` (counts, set codes, DFC `//`, section headers, Moxfield/Arena/Archidekt
  exports), `fetchDeckFromUrl` (Archidekt + Moxfield JSON APIs), `analyzeDeck` → curve, land
  count, avg MV, heuristic role counts (ramp/draw/removal/wipe/counter/tutor/recursion/tokens/
  counters), off-colour + not-legal flags, price. `deckBlock`/`cardBlock` toolResults carry
  every card's verbatim oracle text + "reason from this, not memory".
- `/api/chat` — a pasted decklist (≥15 list-shaped lines) or "analyse my deck" + a
  Moxfield/Archidekt URL → `analyzeDeck` → T2 strategic analysis; a card-interaction question
  → `getCards(extractCardNames())` → oracle-text block.
- Verified against prod: fuzzy lookup, batch resolve, decklist parse, Archidekt fetch, role
  heuristics.

### ✅ EDHREC-backed suggestions (2026-08-31)
- `lib/tools/edhrec.ts` — unofficial `json.edhrec.com/pages/commanders/{slug}.json` (no key).
  `commanderSlug`, `getCommanderRecs` (merges all card lists → `{name, pct, synergy, category}`),
  `recDiff(deck, recs)` → staples-you're-missing (≥35% inclusion), highest-synergy-misses
  (synergy ≥0.25), and nonland list cards EDHREC doesn't surface for the commander.
- Folded into the deck-analysis toolResult whenever a commander resolves; also standalone
  ("what am I missing for Atraxa", "edhrec …" → `isEdhrecQuery` → `extractCardNames`[0] → recs).
  The block tells the model inclusion % is popularity not mandate, synergy is the stronger add
  signal.
- Verified: Juri aristocrats list → correctly flagged missing Mayhem Devil (75%) / Pitiless
  Plunderer / Ashnod's Altar and the bolted-on haste-beatdown cards as not-EDHREC-Juri.

### Fix — empty reply on tool-heavy turns
`/api/chat` scales `max_tokens` to the toolResult size (`1500 + len/8`, cap 4096; 1200
otherwise) — a flat 1024 let adaptive-effort reasoning eat the whole budget and return no
text. `call()` now says so honestly instead of the generic error.

### ✅ Reach into the world — web search + multi-day weather (2026-08-31)
Calliad had no way to search — only fetch a URL Noah gave it, and news/weather only in the
morning brief.
- **Web search:** `call()` gains `webSearch?: boolean` → adds Anthropic's server-side
  `web_search_20260209` tool (`max_uses: 5`, runs inline, no client loop). `/api/chat` sets it
  when the turn has no other tool result, is default mode, and matches search phrasing
  ("look this up", "latest on X", "news about X", "what's happening with X", "as of today").
  `anthropicCostUsd` now adds `$0.01 × web_search_requests` (≈$0.06 for a search turn).
  Verified: "latest on the US Open" → real current results.
- **Weather window:** `lib/tools/weather.ts` `runForecast(text)` — Open-Meteo daily up to 16
  days (the forecast horizon; "next month" gets 16 + a note), `parseWindow` pulls the day count
  and an optional place (`weather in Rome…` → geocoded). `isWeatherQuery` needs a weather word
  **and** a window word, so "what's the weather" alone still falls to the brief. Wired as a
  `toolResult` branch. Verified: this week / next 10 days / Seattle weekend / Rome.

### ✅ Photo / vision input (2026-08-31)
- `lib/image.ts` — `fileToResizedDataUrl`: canvas downscale to ≤1400px long edge, JPEG 0.82
  (Claude caps vision at 1568px; a raw phone photo is pure token waste). Falls back to the raw
  file as a data URL if `createImageBitmap` isn't available.
- `lib/api.ts` `streamChat(text, handlers, conversationId, image?)` — image rides in the JSON body.
- `/api/chat` parses `data:image/(jpeg|png|webp|gif);base64,…`, 413 over ~5 MB, forces T2 if the
  router picked T1 (vision quality). `call()` → `assemble()` builds the user turn as
  `[{image}, {text || "What is this?"}]`.
- Both chat surfaces: a photo button + resized preview with an ✕, thumbnail shown in the
  transcript. Send works with an image and no text.
- Verified against prod: an 800px bird photo → "common kingfisher…" in-voice, $0.003.
