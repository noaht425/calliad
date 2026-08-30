export interface AbentforkPayload {
  capture_id: string;
  url: string;
  title: string;
  notes?: string;
  submitted_at: string;
}

export async function pushToAbentfork(payload: AbentforkPayload): Promise<{ ok: boolean; error?: string }> {
  const webhookUrl = process.env.ABENTFORK_WEBHOOK_URL;
  const secret = process.env.ABENTFORK_WEBHOOK_SECRET;

  if (!webhookUrl) return { ok: false, error: 'ABENTFORK_WEBHOOK_URL not configured' };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { 'X-Webhook-Secret': secret } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `Webhook returned ${res.status}: ${body}` };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}
