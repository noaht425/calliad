// One-shot: turn a vague spoken reference ("the new Green Lantern show") into a
// real title ("Lanterns") with a single web search. Only called when TMDB can't
// resolve a fresh-sounding watch-list add — rare, so the extra call is fine.

import Anthropic from '@anthropic-ai/sdk';
import { audit } from '@/lib/hub/audit';

const anthropic = new Anthropic(); // ANTHROPIC_API_KEY

export async function resolveScreenTitleViaWeb(phrase: string): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const clean = phrase.trim().replace(/\s+/g, ' ');
  if (clean.length < 4) return null;

  try {
    const params = {
      model: 'claude-sonnet-5',
      max_tokens: 200,
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 2 }],
      messages: [
        {
          role: 'user' as const,
          content:
            `Someone referred to a TV show or movie as: "${clean}". ` +
            `Search the web and reply with ONLY its exact official title — the name you'd type into a streaming service. ` +
            `No year, no quotes, no explanation. If you cannot identify one specific title with confidence, reply exactly: UNKNOWN`,
        },
      ],
    } as unknown as Anthropic.Messages.MessageCreateParamsNonStreaming;

    const r = await anthropic.messages.create(params, { signal: AbortSignal.timeout(40_000) });
    const text = r.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join(' ')
      .trim()
      .replace(/^["'“”\s]+|["'“”.\s]+$/g, '')
      .trim();

    await audit.log('tool_call', 'calliad', null, { tool: 'resolve_title', phrase: clean, got: text.slice(0, 80) });

    if (!text || /^unknown$/i.test(text)) return null;
    if (text.length > 70 || text.split(/\s+/).length > 9) return null; // a sentence slipped through
    if (text.toLowerCase() === clean.toLowerCase()) return null;
    return text;
  } catch (err) {
    await audit.log('error', 'system', null, { where: 'resolveScreenTitleViaWeb', message: String(err) });
    return null;
  }
}
