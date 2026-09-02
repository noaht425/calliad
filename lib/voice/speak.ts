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

  private pickVoice(): SpeechSynthesisVoice | null {
    try {
      const name = localStorage.getItem('calliad_voice_name');
      if (!name) return null;
      return window.speechSynthesis.getVoices().find((v) => v.name === name) ?? null;
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
}
