function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function extractMeta(html: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return decodeHtmlEntities(m[1].trim().replace(/\s+/g, ' '));
  }
  return null;
}

export interface OgMeta {
  title: string | null;
  description: string | null;
  bodyText: string;
}

export async function fetchOgMeta(url: string): Promise<OgMeta> {
  const empty: OgMeta = { title: null, description: null, bodyText: '' };
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Calliad/1.0; +https://calliad.app)' },
    });
    if (!res.ok) return empty;

    // Read up to 128KB to get head + enough body for a summary
    const reader = res.body?.getReader();
    if (!reader) return empty;
    let html = '';
    while (html.length < 131072) {
      const { done, value } = await reader.read();
      if (done) break;
      html += new TextDecoder().decode(value);
    }
    reader.cancel().catch(() => {});

    // Use separate patterns for double-quoted and single-quoted attribute values.
    // [^"'] would reject apostrophes inside double-quoted content (e.g. "Tesla (TSLA)'s...").
    // [^"] allows apostrophes when the attribute uses double quotes, and vice versa.
    const title = extractMeta(html, [
      /<meta[^>]+property="og:title"[^>]+content="([^"]{3,300})"/i,
      /<meta[^>]+content="([^"]{3,300})"[^>]+property="og:title"/i,
      /<meta[^>]+property='og:title'[^>]+content='([^']{3,300})'/i,
      /<meta[^>]+content='([^']{3,300})'[^>]+property='og:title'/i,
      /<title[^>]*>([^<]{3,300})<\/title>/i,
    ]);

    const description = extractMeta(html, [
      /<meta[^>]+property="og:description"[^>]+content="([^"]{10,1000})"/i,
      /<meta[^>]+content="([^"]{10,1000})"[^>]+property="og:description"/i,
      /<meta[^>]+property='og:description'[^>]+content='([^']{10,1000})'/i,
      /<meta[^>]+content='([^']{10,1000})'[^>]+property='og:description'/i,
      /<meta[^>]+name="description"[^>]+content="([^"]{10,1000})"/i,
      /<meta[^>]+content="([^"]{10,1000})"[^>]+name="description"/i,
    ]);

    // Extract plain body text for Gemini summarization — strip scripts/styles/nav first,
    // then decode HTML entities so &quot; doesn't end up in Gemini's output
    const bodyStart = html.indexOf('<body');
    const bodyHtml = bodyStart >= 0 ? html.slice(bodyStart) : html;
    const bodyText = decodeHtmlEntities(
      bodyHtml
        .replace(/<(script|style|nav|header|footer|aside)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .slice(0, 6000)
    );

    return { title, description, bodyText };
  } catch {
    return empty;
  }
}

// Legacy shim for callers that only need og:description
export async function fetchOgDescription(url: string): Promise<string | null> {
  const { description } = await fetchOgMeta(url);
  return description;
}
