'use client';

// Streaming TTS: speak a reply sentence-by-sentence as it arrives, so speech
// starts mid-response instead of after it. Browser speechSynthesis — free,
// on-device, queues utterances in order. Stage 2 (PLAN §9 Phase 3).
//
// iOS Safari / standalone PWA quirks handled here:
//  - speechSynthesis.speak() is ignored unless the FIRST call in a session comes
//    from a user gesture → call primeSpeech() from the tap that enables TTS
//    (and from Send, which is also a gesture).
//  - the engine silently pauses itself when the queue briefly empties → we
//    resume() around every speak and on an interval while active.

let primed = false;

/** Call from a user-gesture handler (toggle tap / Send) to unlock TTS on iOS. */
export function primeSpeech(): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.getVoices(); // warm the voice list
    if (!primed) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      window.speechSynthesis.speak(u);
      primed = true;
    }
    window.speechSynthesis.resume();
  } catch { /* not supported */ }
}

export class SentenceSpeaker {
  private spokenLen = 0;
  private active = false;
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  private doneCb: (() => void) | null = null;
  private flushed = false;

  get speaking() {
    return this.active;
  }

  /** Fires once when the queue fully drains after flush() — for conversation mode. */
  whenDone(cb: () => void) {
    this.doneCb = cb;
  }

  private checkDone() {
    if (typeof window === 'undefined') return;
    const s = window.speechSynthesis;
    if (this.flushed && s && !s.speaking && !s.pending) {
      this.flushed = false;
      const cb = this.doneCb;
      this.doneCb = null;
      cb?.();
    }
  }

  private startKeepAlive() {
    if (this.keepAlive || typeof window === 'undefined') return;
    this.keepAlive = setInterval(() => {
      const s = window.speechSynthesis;
      if (!s) return;
      if (s.speaking || s.pending) s.resume(); // iOS auto-pauses ~every 15s
      else this.stopKeepAlive();
    }, 5000);
  }

  private stopKeepAlive() {
    if (this.keepAlive) { clearInterval(this.keepAlive); this.keepAlive = null; }
  }

  private lang: string | null = null; // BCP-47 subtag of the current reply, e.g. "it", "fr"

  /** Tell the speaker what language the reply is in so it can pick a matching
   *  system voice. null / "en" → back to the user's chosen English voice. */
  setLang(code: string | null) {
    this.lang = code && !/^en\b/i.test(code) ? code.toLowerCase().split(/[-_]/)[0] : null;
  }

  private byName(name: string | null): SpeechSynthesisVoice | null {
    if (!name) return null;
    return window.speechSynthesis.getVoices().find((v) => v.name === name) ?? null;
  }

  /** English (or unset) → the localStorage pick. A foreign reply → an explicit
   *  per-language pick if set, else the best-matching installed voice. */
  private pickVoice(): SpeechSynthesisVoice | null {
    try {
      if (this.lang) {
        const chosen = this.byName(localStorage.getItem(`calliad_voice_${this.lang}`));
        if (chosen) return chosen;
        const matches = window.speechSynthesis
          .getVoices()
          .filter((v) => v.lang.toLowerCase().startsWith(this.lang!));
        if (matches.length) return matches.find((v) => v.localService) ?? matches[0];
        return null; // no voice for this language installed — fall back to default
      }
      return this.byName(localStorage.getItem('calliad_voice_name'));
    } catch {
      return null;
    }
  }

  private say(chunk: string) {
    const t = chunk.trim();
    if (!t || typeof window === 'undefined' || !window.speechSynthesis) return;
    const s = window.speechSynthesis;
    const u = new SpeechSynthesisUtterance(t);
    u.rate = 1.05;
    const v = this.pickVoice();
    if (v) { u.voice = v; u.lang = v.lang; }
    else if (this.lang) u.lang = this.lang; // hint the engine even with no explicit voice
    u.onend = () => {
      this.active = s.speaking;
      if (!this.active) this.stopKeepAlive();
      this.checkDone();
    };
    u.onerror = () => { this.active = s.speaking; if (!this.active) this.stopKeepAlive(); this.checkDone(); };
    this.active = true;
    s.resume();      // in case it self-paused
    s.speak(u);
    s.resume();
    this.startKeepAlive();
  }

  /** Feed the full accumulated reply so far; speaks any newly-complete sentences. */
  feed(fullText: string) {
    const pending = fullText.slice(this.spokenLen);
    // last sentence-ending punctuation followed by space/newline/end
    const m = pending.match(/^[\s\S]*[.!?…](?=\s|$)/);
    if (!m) return;
    this.say(m[0]);
    this.spokenLen += m[0].length;
  }

  /** Speak whatever's left after the stream ends. */
  flush(fullText: string) {
    const rest = fullText.slice(this.spokenLen);
    this.spokenLen = fullText.length;
    this.flushed = true;
    if (rest.trim()) this.say(rest);
    else this.checkDone(); // nothing left — fire whenDone immediately if idle
  }

  /** Speak one whole string now, interrupting anything in progress (tap-to-read). */
  speakNow(text: string) {
    this.cancel();
    this.say(text);
  }

  cancel() {
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
    this.stopKeepAlive();
    this.spokenLen = 0;
    this.active = false;
    this.flushed = false;
    this.doneCb = null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setAuth(_token: string | null) { /* device engine needs no token */ }
  prime() { primeSpeech(); }
}

// ── Gemini TTS engine (opt-in) ─────────────────────────────────────────────
// Same surface as SentenceSpeaker, but each sentence is synthesised by
// /api/tts (Gemini natural voice) and played through one reused <audio>.
// Sentences fetch in parallel as they're queued, so playback stays close behind
// the stream. Any failure on a sentence is skipped silently.

const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

interface Chunk { text: string; blob?: Blob; err?: boolean; done?: boolean }

export class GeminiSpeaker {
  private q: Chunk[] = [];
  private audio: HTMLAudioElement | null = null;
  private playing = false;
  private spokenLen = 0;
  private flushed = false;
  private doneCb: (() => void) | null = null;
  private token: string | null = null;
  private stopped = false;

  get speaking() { return this.playing; }
  whenDone(cb: () => void) { this.doneCb = cb; }
  setAuth(token: string | null) { this.token = token; }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setLang(_code: string | null) { /* Gemini TTS auto-detects the language */ }

  private el(): HTMLAudioElement {
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.preload = 'auto';
    }
    return this.audio;
  }

  /** From a user gesture — unlock <audio> playback on iOS. */
  prime() {
    try {
      const a = this.el();
      a.src = SILENT_WAV;
      a.play().then(() => { a.pause(); a.currentTime = 0; }).catch(() => {});
    } catch { /* ignore */ }
  }

  private voice(): string | undefined {
    try { return localStorage.getItem('calliad_gemini_voice') || undefined; } catch { return undefined; }
  }

  private async fetchChunk(c: Chunk) {
    try {
      const r = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
        body: JSON.stringify({ text: c.text, voice: this.voice() }),
      });
      if (!r.ok) { c.err = true; return; }
      c.blob = await r.blob();
    } catch {
      c.err = true;
    }
  }

  private enqueue(text: string) {
    const t = text.trim();
    if (!t) return;
    this.stopped = false;
    const c: Chunk = { text: t };
    this.q.push(c);
    void this.fetchChunk(c); // prefetch
    void this.pump();
  }

  private async pump() {
    if (this.playing || this.stopped) return;
    const c = this.q[0];
    if (!c) { this.maybeDone(); return; }

    // wait for this chunk's audio (its fetch was kicked off at enqueue time)
    for (let i = 0; i < 200 && !c.blob && !c.err; i++) await new Promise((r) => setTimeout(r, 50));
    this.q.shift();
    if (this.stopped) return;
    if (c.err || !c.blob) { void this.pump(); return; } // skip a failed sentence

    this.playing = true;
    const url = URL.createObjectURL(c.blob);
    const a = this.el();
    a.src = url;
    const finish = () => {
      URL.revokeObjectURL(url);
      a.onended = a.onerror = null;
      this.playing = false;
      void this.pump();
    };
    a.onended = finish;
    a.onerror = finish;
    try { await a.play(); } catch { finish(); }
  }

  private maybeDone() {
    if (this.flushed && !this.playing && this.q.length === 0) {
      this.flushed = false;
      const cb = this.doneCb;
      this.doneCb = null;
      cb?.();
    }
  }

  feed(fullText: string) {
    const pending = fullText.slice(this.spokenLen);
    const m = pending.match(/^[\s\S]*[.!?…](?=\s|$)/);
    if (!m) return;
    this.enqueue(m[0]);
    this.spokenLen += m[0].length;
  }

  flush(fullText: string) {
    const rest = fullText.slice(this.spokenLen);
    this.spokenLen = fullText.length;
    this.flushed = true;
    if (rest.trim()) this.enqueue(rest);
    else this.maybeDone();
  }

  speakNow(text: string) {
    this.cancel();
    this.flushed = true;
    this.enqueue(text);
  }

  cancel() {
    this.stopped = true;
    this.q = [];
    this.playing = false;
    this.flushed = false;
    this.doneCb = null;
    this.spokenLen = 0;
    if (this.audio) { try { this.audio.pause(); this.audio.removeAttribute('src'); } catch { /* ignore */ } }
  }
}

export type Speaker = SentenceSpeaker | GeminiSpeaker;

/** Pick the TTS engine from the saved preference. Defaults to on-device. */
export function makeSpeaker(): Speaker {
  let engine = 'device';
  try { engine = localStorage.getItem('calliad_tts_engine') || 'device'; } catch { /* no storage */ }
  return engine === 'gemini' ? new GeminiSpeaker() : new SentenceSpeaker();
}
