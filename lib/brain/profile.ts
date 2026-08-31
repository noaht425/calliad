import fs from 'node:fs';
import path from 'node:path';
import { adminClient } from '@/lib/supabase.server';
import type { Mode } from '@/lib/router/route';

// profile.md split by "## " heading → sliced by intent. The full file went into
// every call before; now a small core is always in (cached) and only relevant
// sections ride along per turn (fresh). Design: system-prompt-assembly.md §4.

const RAW = (() => {
  try {
    return fs.readFileSync(path.join(process.cwd(), 'content/profile.md'), 'utf8');
  } catch {
    return '';
  }
})();

const SECTIONS: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  const parts = RAW.split(/^## /m);
  for (let i = 1; i < parts.length; i++) {
    const heading = parts[i].split('\n', 1)[0].trim();
    out[heading] = `## ${parts[i].trim()}`;
  }
  return out;
})();

const HEADINGS = Object.keys(SECTIONS);
const find = (needle: string) => HEADINGS.find((h) => h.toLowerCase().includes(needle));

// Always in the (cached) core.
const CORE = [
  find('identity'), find('health'), find('daily rhythm'), find('working style'),
].filter(Boolean) as string[];

// intent keyword → section headings to add for that turn. Leading \b only (word
// start), no trailing anchor — so "flights"/"conjugate"/"readings"/"traveling"
// all match their stem. Over-matching just rides an extra section along; missing
// one is the real failure.
const INTENT: { re: RegExp; sections: (string | undefined)[] }[] = [
  { re: /\b(flight|fly|airport|trip|travel|airline|hotel|layover|red-?eye|visit|driv)/i, sections: [find('travel'), find('geographic')] },
  { re: /\b(restaurant|dinner|lunch|brunch|recipe|reservation|takeout|eat|cook|dining|meal)/i, sections: [find('food'), find('geographic')] },
  { re: /\b(exam|midterm|final|assignment|deadline|\bdue\b|syllab|class|course|professor|seminar|paper|essay|\bstud|reading)/i, sections: [find('academics — current'), find('academics — focus'), find('recurring')] },
  { re: /\b(phd|grad school|application|oxford|cambridge|princeton|writing sample|statement of purpose)/i, sections: [find('phd')] },
  { re: /\b(timesheet|payday|admissions|trinity|\bwork\b|\bshift\b)/i, sections: [find('work')] },
  { re: /\b(italian|latin|greek|translat|conjugat|declin|idiom|vocab|grammar)/i, sections: [find('languages'), find('academics — current')] },
  { re: /\b(would i (like|enjoy)|should i (watch|read|play|start)|recommend|worth (watching|reading|playing)|what should i (watch|read|play)|any (recs|recommendations))/i, sections: [find('interests')] },
  { re: /\b(birthday|gift\b|present for|anniversary|meeting with)|\b(call|text|email|messag)\w* (my |him|her|them|mom|dad)/i, sections: [find('people'), find('recurring')] },
  { re: /\b(a ?bent ?fork|\bmtg\b|magic the gathering|\brepo\b|deploy|\bproject)/i, sections: [find('projects')] },
];

export function profileSections(text: string, mode: Mode): string[] {
  const picked = new Set<string>();
  for (const { re, sections } of INTENT) {
    if (re.test(text)) sections.forEach((s) => s && picked.add(s));
  }
  const modeMap: Partial<Record<Mode, string[]>> = {
    'italian-tutor': [find('languages')!].filter(Boolean),
    'study-coach': [find('academics — current')!, find('academics — focus')!].filter(Boolean),
    quiz: [find('languages')!].filter(Boolean),
  };
  (modeMap[mode] ?? []).forEach((s) => picked.add(s));
  return [...picked];
}

export function coreProfile(): string {
  return CORE.map((h) => SECTIONS[h]).filter(Boolean).join('\n\n');
}

export function renderSections(headings: string[]): string {
  const blocks = headings.map((h) => SECTIONS[h]).filter(Boolean);
  return blocks.length ? blocks.join('\n\n') : '';
}

/** Confirmed profile_facts, grouped by section, as a markdown block. */
export async function learnedFacts(userId: string): Promise<string> {
  const { data } = await adminClient
    .from('profile_facts')
    .select('section, key, value')
    .eq('user_id', userId)
    .eq('confirmed', true)
    .order('section');
  if (!data?.length) return '';
  const bySection: Record<string, string[]> = {};
  for (const f of data) (bySection[f.section] ??= []).push(`- ${f.key}: ${f.value}`);
  return (
    '## Learned about Noah (confirmed since profile.md)\n' +
    Object.entries(bySection).map(([s, lines]) => `**${s}**\n${lines.join('\n')}`).join('\n')
  );
}
