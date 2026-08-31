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

**Not done in Stage 1:** streaming STT/TTS (Stage 2), wake word (Stage 3), photo capture,
a nicer cloud TTS voice, `speechSynthesis` voice selection.

## ⏭ Next in Phase 3
- [ ] Stage 2 — live push-to-talk, streamed both directions (~1 s turnaround).
- [ ] Name-that-song (fingerprint API), delegated coding, MTG sim front-end.
