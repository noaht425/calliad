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
- **Name-that-song** — AudD or ACRCloud fingerprint API (trial then ~$3–5/mo). Small feature,
  reuses the mic infra. Needs a key.
- **Delegated coding** — "add X to project Y" → Claude Code on a branch → tests → diff for
  review → explicit merge approval. A sandboxed runner + GitHub integration + guardrails; its
  own project, not a session.
- **MTG sim front-end** — NL → sim invocation → run + interpret. Blocked on bringing the sim
  (from Cowork) into the repo.
