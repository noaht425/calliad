import { adminClient } from '@/lib/supabase.server';
import { t1Json, t1Available } from '@/lib/llm/gemini';
import { fetchHtml } from '@/lib/net/fetch-html';

export interface CapturedItem {
  id: string;
  kind: 'reading' | 'watch' | 'link';
  title: string | null;
  url: string;
  descriptor: string | null;
  site: string | null;
  status: string;
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));
}

/** All <meta> tags → { property-or-name (lowercased) : content }, first occurrence wins. */
function parseMeta(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    const content = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1];
    if (key && content != null && !(key in out)) out[key] = decode(content.trim());
  }
  return out;
}

/** oEmbed title for hosts that hide OG tags from bots (YouTube, Vimeo). */
async function oembedTitle(url: URL): Promise<string | null> {
  let endpoint: string | null = null;
  if (/youtube\.com|youtu\.be/.test(url.hostname)) endpoint = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url.toString())}`;
  else if (/vimeo\.com/.test(url.hostname)) endpoint = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url.toString())}`;
  if (!endpoint) return null;
  try {
    const r = await fetch(endpoint, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { title?: string };
    return j.title ?? null;
  } catch {
    return null;
  }
}

const WATCH_HOSTS = /youtube\.com|youtu\.be|vimeo\.com|netflix\.com|hulu\.com|primevideo|imdb\.com|letterboxd/i;

export async function captureLink(
  userId: string,
  rawUrl: string,
  opts: { source?: 'chat' | 'share' } = {},
): Promise<{ ok: true; item: CapturedItem; deduped: boolean } | { ok: false; error: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
    if (!/^https?:$/.test(url.protocol)) throw new Error('scheme');
  } catch {
    return { ok: false, error: 'not a valid http(s) URL' };
  }
  const clean = url.toString();

  const { data: existing } = await adminClient
    .from('list_items')
    .select('id, kind, title, url, descriptor, site, status')
    .eq('user_id', userId)
    .eq('url', clean)
    .maybeSingle();
  if (existing) return { ok: true, item: existing as CapturedItem, deduped: true };

  // ── fetch page metadata (best-effort) ──────────────────────────────────
  let title: string | null = null;
  let ogDesc: string | null = null;
  let site: string | null = null;
  let ogType: string | null = null;
  try {
    const r = await fetchHtml(clean, { timeoutMs: 8000, maxBytes: 300_000 });
    if (r.ok && r.html) {
      const html = r.html;
      const m = parseMeta(html);
      const bareTitle = decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? '');
      title = m['og:title'] ?? m['twitter:title'] ?? (bareTitle || null);
      ogDesc = m['og:description'] ?? m['twitter:description'] ?? m['description'] ?? null;
      site = m['og:site_name'] ?? null;
      ogType = m['og:type'] ?? null;
    }
  } catch { /* offline / blocked / slow — file it with just the URL */ }

  if (!title) title = await oembedTitle(url);

  const kind: CapturedItem['kind'] =
    WATCH_HOSTS.test(url.hostname) || /video|movie|tv_show/i.test(ogType ?? '') ? 'watch' : title ? 'reading' : 'link';
  site = site ?? url.hostname.replace(/^www\./, '');

  // ── neutral descriptor (pattern M: subject + scope, never the thesis) ──
  let descriptor: string | null = null;
  if (t1Available() && (title || ogDesc)) {
    const out = await t1Json<{ descriptor: string }>(
      'capture_descriptor',
      `Write ONE neutral sentence describing what this ${kind === 'watch' ? 'video/show/film' : 'article/page'} is ABOUT — its subject and scope only.
Never state its argument, thesis, findings, conclusion, or verdict. Never recommend it. No hype adjectives.

Title: ${title ?? '(none)'}
Site: ${site}
Its own blurb: ${ogDesc ?? '(none)'}

Return JSON: {"descriptor":"..."}`,
      { maxOutputTokens: 120 },
    );
    descriptor = out?.descriptor ?? null;
  }
  if (!descriptor && ogDesc) descriptor = ogDesc.slice(0, 240);

  const { data: inserted, error } = await adminClient
    .from('list_items')
    .insert({ user_id: userId, kind, title, url: clean, descriptor, site, source: opts.source ?? 'chat' })
    .select('id, kind, title, url, descriptor, site, status')
    .single();
  if (error || !inserted) return { ok: false, error: error?.message ?? 'insert failed' };

  return { ok: true, item: inserted as CapturedItem, deduped: false };
}

export async function listItems(userId: string, kind?: string): Promise<CapturedItem[]> {
  let q = adminClient
    .from('list_items')
    .select('id, kind, title, url, descriptor, site, status')
    .eq('user_id', userId)
    .neq('status', 'archived')
    .order('created_at', { ascending: false });
  if (kind) q = q.eq('kind', kind);
  const { data } = await q;
  return (data ?? []) as CapturedItem[];
}
