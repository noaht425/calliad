// Task: quiz_grade (lib/quiz/items.ts). Small, simple, hand-authored — this is
// the last-resort path after a normalization + substring fast-path already
// catches the easy cases, so the training signal that matters is the harder
// judgment calls (accepted synonym vs. wrong word; exact-form vs. close-but-no).

import type { Example } from './types.ts';

const VOCAB_RULE = 'This is a vocabulary card. Accept close synonyms and word-order differences. Ignore capitalisation, macrons/accents, and leading "to/the/a".';
const FORM_RULE = 'This is a grammatical-form card. Require the exact form (ignoring only capitalisation and macrons/accents). Do NOT accept romanised Greek, paraphrases, or partial answers.';

interface Case { rule: string; expected: string; given: string; ok: boolean }

const CASES: Case[] = [
  // vocab — accept
  { rule: VOCAB_RULE, expected: 'to love', given: 'love', ok: true },
  { rule: VOCAB_RULE, expected: 'the king', given: 'king', ok: true },
  { rule: VOCAB_RULE, expected: 'happy|glad', given: 'glad', ok: true },
  { rule: VOCAB_RULE, expected: 'to see, to look at', given: 'to look at', ok: true },
  { rule: VOCAB_RULE, expected: 'big|large|great', given: 'large', ok: true },
  { rule: VOCAB_RULE, expected: 'friend', given: 'Friend', ok: true },
  { rule: VOCAB_RULE, expected: 'mother', given: 'MOTHER', ok: true },
  { rule: VOCAB_RULE, expected: 'to walk, to go', given: 'to go, to walk', ok: true },
  { rule: VOCAB_RULE, expected: 'quickly', given: 'fast', ok: true },
  { rule: VOCAB_RULE, expected: 'sword', given: 'a sword', ok: true },
  { rule: VOCAB_RULE, expected: 'agora', given: 'agorā', ok: true },
  { rule: VOCAB_RULE, expected: 'small|little', given: 'little', ok: true },
  { rule: VOCAB_RULE, expected: 'to write', given: 'write', ok: true },
  { rule: VOCAB_RULE, expected: 'water', given: 'the water', ok: true },
  { rule: VOCAB_RULE, expected: 'brave|courageous', given: 'courageous', ok: true },
  // vocab — reject
  { rule: VOCAB_RULE, expected: 'to love', given: 'to hate', ok: false },
  { rule: VOCAB_RULE, expected: 'the king', given: 'the queen', ok: false },
  { rule: VOCAB_RULE, expected: 'happy', given: 'sad', ok: false },
  { rule: VOCAB_RULE, expected: 'big|large|great', given: 'small', ok: false },
  { rule: VOCAB_RULE, expected: 'friend', given: 'enemy', ok: false },
  { rule: VOCAB_RULE, expected: 'to walk', given: 'to run', ok: false },
  { rule: VOCAB_RULE, expected: 'sword', given: 'shield', ok: false },
  { rule: VOCAB_RULE, expected: 'water', given: 'wine', ok: false },
  { rule: VOCAB_RULE, expected: 'to see', given: '', ok: false },
  { rule: VOCAB_RULE, expected: 'brave', given: 'brove', ok: false },
  // grammatical form — accept
  { rule: FORM_RULE, expected: 'amāvit', given: 'amavit', ok: true },
  { rule: FORM_RULE, expected: 'ēmī', given: 'emi', ok: true },
  { rule: FORM_RULE, expected: 'rēgēs', given: 'REGES', ok: true },
  { rule: FORM_RULE, expected: 'λύουσι(ν)', given: 'λύουσιν', ok: true },
  { rule: FORM_RULE, expected: 'puellārum', given: 'puellarum', ok: true },
  { rule: FORM_RULE, expected: 'ferimus', given: 'Ferimus', ok: true },
  { rule: FORM_RULE, expected: 'ἔλυσα', given: 'ἔλυσα', ok: true },
  { rule: FORM_RULE, expected: 'audiendum', given: 'audiendum', ok: true },
  // grammatical form — reject
  { rule: FORM_RULE, expected: 'amāvit', given: 'amābit', ok: false },
  { rule: FORM_RULE, expected: 'ēmī', given: 'ēmit', ok: false },
  { rule: FORM_RULE, expected: 'rēgēs', given: 'rēx', ok: false },
  { rule: FORM_RULE, expected: 'λύουσι(ν)', given: 'lyousi', ok: false }, // romanised -> reject
  { rule: FORM_RULE, expected: 'puellārum', given: 'puellīs', ok: false },
  { rule: FORM_RULE, expected: 'ferimus', given: 'the plural of "I carry"', ok: false }, // paraphrase -> reject
  { rule: FORM_RULE, expected: 'ἔλυσα', given: 'elysa', ok: false },
  { rule: FORM_RULE, expected: 'audiendum', given: 'audiend', ok: false }, // partial -> reject
  { rule: FORM_RULE, expected: 'amāvērunt', given: 'amaverunt', ok: true },
  { rule: FORM_RULE, expected: 'cīvitātis', given: 'civitatis', ok: true },
  { rule: FORM_RULE, expected: 'cīvitātis', given: 'civitas', ok: false },
];

export function* generateQuizGrade(): Generator<Example> {
  for (const c of CASES) {
    yield {
      task: 'quiz_grade',
      messages: [
        { role: 'system', content: 'Grade a quiz answer against the expected answer. Reply with a boolean only.' },
        { role: 'user', content: `${c.rule}\nExpected: ${c.expected}\nStudent: ${c.given}` },
        { role: 'assistant', content: JSON.stringify({ ok: c.ok }) },
      ],
    };
  }
}
