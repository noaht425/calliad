'use client';

// Streaming TTS: speak a reply sentence-by-sentence as it arrives, so speech
// starts mid-response instead of after it. Browser speechSynthesis — free,
// on-device, queues utterances in order. Stage 2 (PLAN §9 Phase 3).

export class SentenceSpeaker {
  private spokenLen = 0;
  private active = false;

  get speaking() {
    return this.active;
  }

  private say(chunk: string) {
    const t = chunk.trim();
    if (!t || typeof window === 'undefined' || !window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(t);
    u.rate = 1.05;
    u.onend = () => { this.active = window.speechSynthesis.speaking; };
    this.active = true;
    window.speechSynthesis.speak(u);
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
    if (rest.trim()) this.say(rest);
    this.spokenLen = fullText.length;
  }

  cancel() {
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
    this.spokenLen = 0;
    this.active = false;
  }
}
