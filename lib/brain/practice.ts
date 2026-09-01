// Lightweight "reply to me in language X for practice" state. Lives in
// conversations.mode_state.practiceLang; composes with modes and presets.

export interface PracticeLang {
  name: string;       // "French"
  code: string;       // "fr" — used to pin STT
  level: 'beginner' | 'intermediate' | 'advanced';
  classical?: boolean;
}

const LANGS: Record<string, { name: string; code: string; classical?: boolean }> = {
  french: { name: 'French', code: 'fr' },
  german: { name: 'German', code: 'de' },
  italian: { name: 'Italian', code: 'it' },
  latin: { name: 'Latin', code: 'la', classical: true },
  greek: { name: 'Ancient Greek', code: 'el', classical: true },
  'ancient greek': { name: 'Ancient Greek', code: 'el', classical: true },
};

const LANG_ALT: Record<string, string> = {
  français: 'french', francais: 'french', deutsch: 'german',
  italiano: 'italian', latina: 'latin', ελληνικά: 'greek',
};

const VERB = '(?:practi[cs]e|converse|talk|speak|reply|respond|write|chat|quiz me)';
const LEVELS = /\b(beginner|elementary|a1|a2|basic|intermediate|b1|b2|advanced|c1|c2|fluent)\b/i;

function levelFrom(text: string): PracticeLang['level'] {
  const m = text.match(LEVELS);
  if (!m) return 'intermediate';
  const l = m[1].toLowerCase();
  if (/beginner|elementary|a1|a2|basic/.test(l)) return 'beginner';
  if (/advanced|c1|c2|fluent/.test(l)) return 'advanced';
  return 'intermediate';
}

const INTENT = new RegExp(`\\b(?:${VERB}|let'?s (?:do|try)|switch to)\\b|\\b(?:mode|tutor|lesson)\\b`, 'i');
// longest keys first so "ancient greek" wins over "greek"
const LANG_KEYS = Object.keys(LANGS).sort((a, b) => b.length - a.length);

export function detectPracticeLang(text: string): PracticeLang | null {
  const t = text.toLowerCase();
  if (!INTENT.test(t)) return null;
  if (/\bhow (do you|to) say\b|\btranslat/i.test(t)) return null; // a lookup, not a mode

  let key: string | undefined;
  for (const alt of Object.keys(LANG_ALT)) if (t.includes(alt)) { key = LANG_ALT[alt]; break; }
  if (!key) {
    for (const k of LANG_KEYS) {
      if (new RegExp(`\\b${k.replace(/\s+/g, '\\s+')}\\b`).test(t)) { key = k; break; }
    }
  }
  if (!key || !LANGS[key]) return null;
  const L = LANGS[key];
  return { name: L.name, code: L.code, level: levelFrom(t), classical: L.classical };
}

export function detectPracticeExit(text: string): boolean {
  return /\b(back to english|in inglese|en anglais|auf englisch|stop( the)? (practic\w*|language|tutor)|english( please)?$|normal mode|nevermind the (practice|language))\b/i.test(text);
}

export function practiceOverlay(p: PracticeLang): string {
  if (p.classical) {
    return `## Practice: ${p.name}\nNoah wants to practise ${p.name}. Write your replies in ${p.name} (${p.level} level), then give a short English gloss in parentheses so he can check himself. Keep it to a few sentences. If he writes in ${p.name}, correct mistakes briefly inline. Your persona still applies.`;
  }
  return `## Practice: ${p.name}\nConverse with Noah entirely in ${p.name} at ${p.level} level. Keep replies natural and not too long. Correct his ${p.name} mistakes briefly inline — a quick "(si dice X, non Y)" style note — don't lecture. Localise idioms, never transliterate. Drop to English only if he's clearly stuck or asks. Your persona and dry humour still apply, just in ${p.name}. He can say "back to English" to stop.`;
}
