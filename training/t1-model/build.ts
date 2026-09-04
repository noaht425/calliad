// Orchestrator: runs every generator across many different "now" instants
// (so the model sees varied days-of-week / months / DST sides, not just
// today's date) and writes train/eval JSONL.
//
//   npx tsx build.ts

import { writeFileSync, mkdirSync } from 'node:fs';
import { generateExtractEvent } from './generators/extractEvent.ts';
import { generateExtractTask } from './generators/extractTask.ts';
import { generateExtractCalendarChange } from './generators/extractCalendarChange.ts';
import { generateQuizGrade } from './generators/quizGrade.ts';
import type { Example } from './generators/types.ts';

const OUT_DIR = new URL('./data/', import.meta.url).pathname;
mkdirSync(OUT_DIR, { recursive: true });

// Spread "now" across the year, different weekdays/times, so the model learns
// the resolution RULE rather than memorising today's calendar.
function sampleNows(count: number): Date[] {
  const base = Date.UTC(2026, 0, 1, 0, 0);
  const yearMs = 365 * 86_400_000;
  const out: Date[] = [];
  for (let i = 0; i < count; i++) {
    const t = base + Math.random() * yearMs + Math.random() * 86_400_000;
    out.push(new Date(t));
  }
  return out;
}

const PER_NOW = { extract_event: 6, extract_task: 6, extract_calendar_change: 4 };
const NOW_COUNT = 90; // -> ~540 event, ~540 task, ~360 cal-change examples

function* dateVaryingTasks() {
  const nows = sampleNows(NOW_COUNT);
  for (const now of nows) {
    yield* generateExtractEvent(now, PER_NOW.extract_event);
    yield* generateExtractTask(now, PER_NOW.extract_task);
    yield* generateExtractCalendarChange(now, PER_NOW.extract_calendar_change);
  }
}

function main() {
  const all: Example[] = [...dateVaryingTasks(), ...generateQuizGrade()];

  const byTask = new Map<string, Example[]>();
  for (const e of all) {
    if (!byTask.has(e.task)) byTask.set(e.task, []);
    byTask.get(e.task)!.push(e);
  }

  console.log('=== t1-model synthetic dataset build ===\n');
  let grandTrain = 0, grandEval = 0;
  const combinedTrain: Example[] = [];
  const combinedEval: Example[] = [];
  const toJsonl = (rows: Example[]) => rows.map((r) => JSON.stringify({ messages: r.messages })).join('\n') + '\n';

  for (const [task, examples] of byTask) {
    // dedupe once per task, split, write per-task files, and reuse the exact
    // same split for the combined file below (no re-shuffling per file).
    const seen = new Set<string>();
    const deduped = examples.filter((e) => {
      const key = e.messages.find((m) => m.role === 'user')?.content ?? '';
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    for (let i = deduped.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deduped[i], deduped[j]] = [deduped[j], deduped[i]];
    }
    const evalCount = Math.max(1, Math.round(deduped.length * 0.1));
    const evalSet = deduped.slice(0, evalCount);
    const trainSet = deduped.slice(evalCount);

    writeFileSync(`${OUT_DIR}${task}-train.jsonl`, toJsonl(trainSet));
    writeFileSync(`${OUT_DIR}${task}-eval.jsonl`, toJsonl(evalSet));
    console.log(`${task.padEnd(26)} raw=${examples.length}  deduped=${deduped.length}  train=${trainSet.length}  eval=${evalSet.length}`);

    grandTrain += trainSet.length; grandEval += evalSet.length;
    combinedTrain.push(...trainSet);
    combinedEval.push(...evalSet);
  }

  writeFileSync(`${OUT_DIR}t1-all-train.jsonl`, toJsonl(combinedTrain));
  writeFileSync(`${OUT_DIR}t1-all-eval.jsonl`, toJsonl(combinedEval));

  console.log(`\nTOTAL  train=${grandTrain}  eval=${grandEval}`);
  console.log(`\nWrote per-task + combined JSONL to ${OUT_DIR}`);
}

main();
