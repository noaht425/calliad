import { adminClient } from '@/lib/supabase.server';
import { audit } from '@/lib/hub/audit';
import { RIDDLES } from '@/lib/games/riddles';
import { ROOTS } from '@/lib/games/roots';

const TZ = process.env.TZ_DEFAULT ?? 'America/New_York';
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// ── scores ───────────────────────────────────────────────────────────────
export async function recordScore(userId: string, game: string, score: number, detail: Record<string, unknown> = {}): Promise<void> {
  await adminClient.from('game_scores').insert({ user_id: userId, game, score, detail }).then(() => {}, () => {});
  await audit.log('outbound_message', 'calliad', null, { game, score, ...detail });
}
export async function bestScore(userId: string, game: string): Promise<{ score: number; detail: Record<string, unknown> } | null> {
  const { data } = await adminClient
    .from('game_scores').select('score, detail').eq('user_id', userId).eq('game', game)
    .order('score', { ascending: false }).order('at', { ascending: true }).limit(1).maybeSingle();
  return data ? { score: data.score as number, detail: (data.detail ?? {}) as Record<string, unknown> } : null;
}

// ── riddle of the day ────────────────────────────────────────────────────
export interface RiddleState { id: number; revealed: boolean; at: number }

function dayHash(d = new Date()): number {
  const s = d.toLocaleDateString('en-CA', { timeZone: TZ });
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
export function riddleOfTheDay(d = new Date()): { id: number; q: string; a: string; hint?: string } {
  const id = dayHash(d) % RIDDLES.length;
  return { id, ...RIDDLES[id] };
}
export const isRiddleRequest = (t: string) =>
  /\b(riddle( me)?( this| of the day)?|brain ?teaser|give me a (riddle|puzzle)|puzzle of the day|today'?s riddle)\b/i.test(t);
export const isRiddleReveal = (t: string) =>
  /\b(give up|i give up|reveal|the answer|what'?s the answer|tell me( the answer)?|show( me)? the answer|i don'?t know|no idea|stumped)\b/i.test(t);

/** Pull a guessed answer out of "is it a candle" / "the answer is footsteps" / bare guess. */
export function extractRiddleGuess(t: string): string | null {
  const m = t.match(/\b(?:the answer is|is it|i think it'?s|it'?s|my guess is|answer:?|guess:?)\s+(.+)$/i);
  if (m) return m[1];
  if (t.trim().split(/\s+/).length <= 4 && /[a-z]/i.test(t)) return t; // short bare guess
  return null;
}
export function checkRiddle(id: number, guess: string): boolean {
  const r = RIDDLES[id];
  if (!r) return false;
  const g = ` ${norm(guess)} `;
  return r.keys.some((group) => group.every((w) => g.includes(` ${norm(w)} `) || g.includes(norm(w))));
}

// ── math sprint ──────────────────────────────────────────────────────────
export interface SprintState { problems: { q: string; a: number }[]; idx: number; correct: number; startedAt: number }
const SPRINT_N = 12;

const ri = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));
export function newSprint(): SprintState {
  const problems: { q: string; a: number }[] = [];
  for (let i = 0; i < SPRINT_N; i++) {
    const kind = ['add', 'add', 'sub', 'sub', 'mul', 'mul', 'div'][ri(0, 6)];
    let q = '', a = 0;
    if (kind === 'add') { const x = ri(11, 89), y = ri(11, 89); q = `${x} + ${y}`; a = x + y; }
    else if (kind === 'sub') { const x = ri(30, 99), y = ri(10, x); q = `${x} − ${y}`; a = x - y; }
    else if (kind === 'mul') { const x = ri(3, 19), y = ri(3, 12); q = `${x} × ${y}`; a = x * y; }
    else { const y = ri(3, 12), a2 = ri(3, 12); q = `${y * a2} ÷ ${y}`; a = a2; }
    problems.push({ q, a });
  }
  return { problems, idx: 0, correct: 0, startedAt: Date.now() };
}
export const isMathSprintStart = (t: string) =>
  /\b(math sprint|arithmetic (drill|sprint)|mental math|quick math|number drill|maths drill)\b/i.test(t);

export function sprintResult(s: SprintState): { line: string; score: number; ms: number } {
  const ms = Date.now() - s.startedAt;
  const secs = Math.round(ms / 1000);
  const mmss = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  return { line: `${s.correct}/${s.problems.length} in ${mmss}`, score: s.correct, ms };
}

// ── roots quiz ───────────────────────────────────────────────────────────
export type RootForm = 'word' | 'gloss' | 'reverse';
export interface RootsState { order: number[]; i: number; correct: number; form: RootForm }
const ROOTS_N = 8;

export const isRootsQuizStart = (t: string) =>
  /\b(roots quiz|etymology (quiz|drill)|quiz me on (roots|etymology)|word roots|latin\/?greek roots)\b/i.test(t);

function shuffled(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = a.length - 1; i > 0; i--) { const j = ri(0, i); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export function newRootsQuiz(): RootsState {
  return { order: shuffled(ROOTS.length).slice(0, ROOTS_N * 2), i: 0, correct: 0, form: 'word' };
}
export function rootsPrompt(s: RootsState): { text: string; form: RootForm } {
  const r = ROOTS[s.order[s.i]];
  const form: RootForm = (['word', 'gloss', 'reverse'] as RootForm[])[s.i % 3];
  if (form === 'gloss') return { text: `What does the ${r.lang} root **${r.root}** mean?`, form };
  if (form === 'reverse') {
    const ex = r.english.slice(0, 3).join(', ');
    return { text: `Which ${r.lang} root do **${ex}** share?`, form };
  }
  return { text: `**${r.root}** (${r.lang}) — "${r.gloss}". Name an English word from it.`, form };
}
export function checkRoots(s: RootsState, guess: string): { ok: boolean; want: string } {
  const r = ROOTS[s.order[s.i]];
  const g = norm(guess);
  const form = (['word', 'gloss', 'reverse'] as RootForm[])[s.i % 3];
  if (form === 'gloss') {
    const glossWords = norm(r.gloss).split(' ').filter((w) => w.length > 2);
    return { ok: glossWords.some((w) => g.includes(w)), want: r.gloss };
  }
  if (form === 'reverse') {
    const target = norm(r.root.split('/')[0]);
    return { ok: g.includes(target) || target.includes(g.replace(/\s/g, '')), want: r.root };
  }
  const ok = r.english.some((w) => g.includes(norm(w))) ||
    (g.length >= r.root.replace(/[^a-z]/gi, '').length + 2 && g.replace(/\s/g, '').includes(norm(r.root.split(/[ /]/)[0].replace(/[^a-z]/gi, ''))));
  return { ok, want: r.english.slice(0, 3).join(', ') };
}
