// One HTML fetch with a browser-fingerprint fallback. A plain server `fetch`
// (any UA) gets a Cloudflare / bot-wall 403 on a lot of sites; got-scraping
// presents a real Chrome TLS + header profile and clears most of them. Pure JS,
// lazy-loaded so it never enters a hot path unless a page actually blocks us.
// Shared by webfetch (→ watchers) and link capture.

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const BLOCK_STATUS = new Set([401, 403, 406, 409, 429, 451, 503]);
const CHALLENGE_RE =
  /just a moment\.\.\.|cf-browser-verification|_cf_chl_|cf_chl_opt|attention required|enable javascript and cookies|checking if the site connection is secure|<title>\s*access denied/i;

export interface HtmlResult {
  ok: boolean;
  status: number;
  html: string;
  finalUrl: string;
  via: 'fetch' | 'browser' | 'none';
  reason?: string;
}

function looksBlocked(status: number, body: string): boolean {
  if (BLOCK_STATUS.has(status)) return true;
  if (status === 200 && body.length < 600 && CHALLENGE_RE.test(body)) return true;
  return false;
}

async function viaGotScraping(url: string, timeoutMs: number): Promise<HtmlResult | null> {
  try {
    const { gotScraping } = await import('got-scraping');
    const r = await gotScraping({
      url,
      timeout: { request: timeoutMs },
      throwHttpErrors: false,
      followRedirect: true,
      headers: { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
    });
    const html = typeof r.body === 'string' ? r.body : '';
    const blocked = looksBlocked(r.statusCode, html);
    return {
      ok: r.statusCode >= 200 && r.statusCode < 400 && !blocked && html.length > 0,
      status: r.statusCode,
      html,
      finalUrl: r.url || url,
      via: 'browser',
      reason: blocked ? 'still blocked after browser retry' : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch a page's HTML. Plain `fetch` first; on a bot-wall status or a
 * challenge-page body, retry once with a browser fingerprint.
 */
export async function fetchHtml(
  rawUrl: string,
  opts: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<HtmlResult> {
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const maxBytes = opts.maxBytes ?? 1_500_000;

  let status = 0;
  let html = '';
  let finalUrl = rawUrl;
  try {
    const r = await fetch(rawUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'user-agent': CHROME_UA,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
      },
    });
    status = r.status;
    finalUrl = r.url || rawUrl;
    const ct = r.headers.get('content-type') ?? '';
    // only read a body we can use; still let a blocked non-HTML 403 fall to the retry
    if (/text\/html|application\/xhtml|text\/plain|application\/xml/i.test(ct) || !r.ok) {
      html = (await r.text()).slice(0, maxBytes);
    }
    if (r.ok && !looksBlocked(status, html)) {
      return { ok: html.length > 0, status, html, finalUrl, via: 'fetch' };
    }
  } catch {
    /* network error → try the browser path before giving up */
  }

  const retry = await viaGotScraping(rawUrl, timeoutMs);
  if (retry) return { ...retry, html: retry.html.slice(0, maxBytes) };

  return {
    ok: false,
    status,
    html,
    finalUrl,
    via: 'none',
    reason: status ? `blocked (${status})` : 'could not reach the page',
  };
}
