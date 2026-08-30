import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminClient } from '@/lib/supabase.server';
import { fetchOgMeta } from '@/lib/og-fetch';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const runtime = 'nodejs';
export const maxDuration = 60;

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_KEY!);

// Single Gemini call that returns both a clean title and a proper multi-sentence summary.
// Works even when scraping fails — Gemini uses its training knowledge of the article/topic.
async function enrichArticle(
  url: string,
  storedTitle: string,
  domain: string,
  ogTitle: string | null,
  ogDescription: string | null,
  bodyText: string,
): Promise<{ cleanTitle: string; summary: string } | null> {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

    const prompt = `You are enriching a saved article for a personal reading list. Perform two tasks and return the result as JSON.

URL: ${url}
Source: ${domain}
Raw title from share sheet (may be garbled — URL slug format, missing apostrophes, numeric IDs, wrong case): ${storedTitle}
${ogTitle ? `Page og:title: ${ogTitle}` : '(og:title unavailable)'}
${ogDescription ? `og:description: ${ogDescription}` : '(og:description unavailable)'}
${bodyText ? `Article body excerpt:\n${bodyText.slice(0, 4000)}` : '(page body unavailable — use your knowledge of the article from its URL and title)'}

Task 1 — CLEAN_TITLE:
Write the correct, properly formatted article title. Rules:
- Fix missing apostrophes (Seattles → Seattle's, Weve → We've, dont → don't)
- Remove numeric article IDs appended to the title (e.g. "014101772", "12356918")
- Remove file extensions (.Html, .html)
- Remove publication name suffixes after | or — or - (e.g. " | Yahoo Finance", " - GeekWire")
- Capitalize correctly (title case, proper nouns)
- The result should be ONLY the article title — not the source name

Task 2 — SUMMARY:
Write exactly 3–5 sentences — no more. Enough for the reader to get the gist without reading the full article. Rules:
- Be specific: mention companies, people, numbers, findings, or decisions by name
- Do NOT start with "This article" or "The article" — state the substance directly
- Use proper English punctuation and apostrophes (it's, don't, can't, U.S., etc.)
- Do not reproduce HTML entities (&quot;, &amp;, etc.) — write actual punctuation
- If the article content is unavailable, use your knowledge of this article based on its URL, title, and source

Return JSON only, no markdown fences:
{"clean_title": "...", "summary": "..."}`;

    const result = await model.generateContent(prompt);
    const raw = result.response.text().replace(/```json\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(raw) as { clean_title: string; summary: string };
    if (!parsed.clean_title || !parsed.summary) return null;
    return { cleanTitle: parsed.clean_title.trim(), summary: parsed.summary.trim() };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: project } = await adminClient
    .from('folders').select('id').eq('user_id', user.id).ilike('name', '%reading%').limit(1).maybeSingle();
  if (!project) return NextResponse.json({ refreshed: 0 });

  const { data: captures } = await adminClient
    .from('captures')
    .select('id, summary, metadata')
    .eq('user_id', user.id)
    .eq('folder_id', project.id)
    .eq('status', 'folder');

  if (!captures?.length) return NextResponse.json({ refreshed: 0 });

  // Refresh if: no og_title stored yet, OR summary is still short/generic (< 300 chars).
  // 300 chars is approximately 2 sentences — a real 3-5 sentence summary will exceed this.
  const needsRefresh = captures.filter((c) => {
    const meta = (c.metadata ?? {}) as Record<string, unknown>;
    if (!(meta.url as string | undefined)) return false;
    const hasOgTitle = !!(meta.og_title as string | undefined);
    const s = c.summary ?? '';
    return !hasOgTitle || s.startsWith('http') || s === 'Shared item' || s.length < 300;
  });

  if (!needsRefresh.length) return NextResponse.json({ refreshed: 0 });

  const batch = needsRefresh.slice(0, 8);
  let refreshed = 0;

  await Promise.allSettled(batch.map(async (c) => {
    const meta = (c.metadata ?? {}) as Record<string, unknown>;
    const url = meta.url as string;
    const storedTitle = (meta.title as string | undefined) ?? '';

    let domain = '';
    try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch {}

    // Best-effort scrape — enrichArticle works even when this returns empty
    const { title: ogTitle, description: ogDescription, bodyText } = await fetchOgMeta(url);

    const result = await enrichArticle(url, storedTitle, domain, ogTitle, ogDescription, bodyText);
    if (!result) return;

    await adminClient.from('captures').update({
      summary: result.summary,
      metadata: { ...meta, og_title: result.cleanTitle },
    }).eq('id', c.id);

    refreshed++;
  }));

  return NextResponse.json({ refreshed });
}
