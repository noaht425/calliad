import { adminClient } from './supabase.server';

export const runtime = 'nodejs';

interface AlexaConfig {
  cookie: string;
  csrf: string;
  userAgent: string;
  formerRegistrationData: unknown;
  macDms: unknown;
  autoRefreshEnabled: boolean;
  lastRefreshedAt: string | null;
}

const BASE = 'https://www.amazon.com/alexashoppinglists/api/v2';

const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export async function getAlexaConfig(userId: string): Promise<AlexaConfig | null> {
  const { data } = await adminClient
    .from('connected_services')
    .select('access_token, metadata')
    .eq('user_id', userId)
    .eq('service', 'alexa')
    .single();

  if (!data?.access_token) return null;
  const m = (data.metadata ?? {}) as Record<string, unknown>;

  return {
    cookie: data.access_token,
    csrf: (m.csrf as string) ?? '',
    userAgent: (m.user_agent as string) ?? DEFAULT_UA,
    formerRegistrationData: m.former_registration_data,
    macDms: m.mac_dms,
    autoRefreshEnabled: ((m.auto_refresh_enabled as boolean) ?? false),
    lastRefreshedAt: (m.last_refreshed_at as string) ?? null,
  };
}

function alexaHeaders(config: AlexaConfig): Record<string, string> {
  return {
    Cookie: config.cookie,
    csrf: config.csrf,
    'User-Agent': config.userAgent,
    'Content-Type': 'application/json; charset=utf-8',
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    Origin: 'https://www.amazon.com',
    Referer: 'https://www.amazon.com/alexashoppinglists/',
  };
}

async function getShoppingListId(config: AlexaConfig): Promise<string | null> {
  const res = await fetch(`${BASE}/lists/fetch`, {
    method: 'POST',
    headers: alexaHeaders(config),
    body: JSON.stringify({}),
  });
  const rawText = await res.text();
  console.log('[alexa] lists/fetch status:', res.status, 'body:', rawText.slice(0, 300));
  if (!res.ok) return null;
  let data: { listInfoList?: Array<{ listId: string; listType: string }> };
  try {
    data = JSON.parse(rawText);
  } catch {
    // Amazon returns HTML (login page) when session cookie is expired
    console.error('[alexa] lists/fetch returned non-JSON — cookie likely expired');
    return null;
  }
  const lists = data.listInfoList ?? [];
  console.log('[alexa] list types found:', lists.map((l) => l.listType).join(', ') || 'none');
  const shopping = lists.find((l) => l.listType === 'SHOP');
  return shopping?.listId ?? null;
}

export async function addToAlexaList(
  userId: string,
  items: string[]
): Promise<{ added: string[]; failed: string[]; notConnected: boolean }> {
  let config = await getAlexaConfig(userId);
  if (!config) return { added: [], failed: items, notConnected: true };

  let listId = await getShoppingListId(config);

  // If no list found, cookies may be expired — attempt a refresh and retry once
  if (!listId) {
    if (!config.formerRegistrationData) {
      console.error('[alexa] list lookup failed and no formerRegistrationData — manual re-login required');
    } else {
      console.log('[alexa] list lookup failed, attempting cookie refresh...');
      const refreshed = await refreshAlexaCookies(userId);
      if (refreshed) {
        const refreshedConfig = await getAlexaConfig(userId);
        if (refreshedConfig) { config = refreshedConfig; listId = await getShoppingListId(config); }
        if (!listId) console.error('[alexa] list still not found after cookie refresh');
      } else {
        console.error('[alexa] cookie refresh failed — manual re-login required');
      }
    }
  }

  if (!listId) return { added: [], failed: items, notConnected: false };

  const added: string[] = [];
  const failed: string[] = [];

  for (const item of items) {
    const url = `${BASE}/lists/${encodeURIComponent(listId)}/items`;
    const res = await fetch(url, {
      method: 'POST',
      headers: alexaHeaders(config),
      body: JSON.stringify({ items: [{ itemType: 'KEYWORD', itemName: item }] }),
    });
    const responseText = await res.text();
    let succeeded = res.ok;
    if (succeeded) {
      try {
        const json = JSON.parse(responseText) as { failures?: unknown[] };
        if (json.failures?.length) { succeeded = false; console.error('[alexa] item add failures:', JSON.stringify(json.failures)); }
      } catch { /* non-JSON 200, treat as success */ }
    } else {
      console.error('[alexa] item add failed:', res.status, responseText.slice(0, 200));
    }
    if (succeeded) added.push(item);
    else failed.push(item);
  }

  return { added, failed, notConnected: false };
}

export async function getAlexaListItems(
  userId: string
): Promise<{ items: string[]; notConnected: boolean; error?: string }> {
  let config = await getAlexaConfig(userId);
  if (!config) return { items: [], notConnected: true };

  let listId = await getShoppingListId(config);

  if (!listId && config.formerRegistrationData) {
    const refreshed = await refreshAlexaCookies(userId);
    if (refreshed) {
      const fresh = await getAlexaConfig(userId);
      if (fresh) { config = fresh; listId = await getShoppingListId(config); }
    }
  }

  if (!listId) return { items: [], notConnected: false, error: 'Shopping list not found — cookies may be expired' };

  const res = await fetch(`${BASE}/lists/${encodeURIComponent(listId)}/items?size=100`, {
    headers: alexaHeaders(config),
  });
  const rawText = await res.text();
  console.log('[alexa] get items status:', res.status, 'body:', rawText.slice(0, 400));

  if (!res.ok) return { items: [], notConnected: false, error: `Alexa API ${res.status}` };

  let data: { listItems?: Array<{ itemName: string; completed?: boolean; itemType?: string }> };
  try { data = JSON.parse(rawText); }
  catch { return { items: [], notConnected: false, error: 'Unexpected response (not JSON)' }; }

  const items = (data.listItems ?? [])
    .filter((i) => !i.completed && (i.itemType === 'KEYWORD' || !i.itemType))
    .map((i) => i.itemName)
    .filter(Boolean);

  return { items, notConnected: false };
}

export async function refreshAlexaCookies(userId: string): Promise<boolean> {
  const config = await getAlexaConfig(userId);
  if (!config?.formerRegistrationData) return false;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { refreshAlexaCookie } = require('alexa-cookie2') as typeof import('alexa-cookie2');

    const result = await new Promise<{ cookie: string; cookieData: Record<string, unknown> }>(
      (resolve, reject) => {
        refreshAlexaCookie(config.formerRegistrationData, (err, res) => {
          if (err) reject(err);
          else resolve(res as { cookie: string; cookieData: Record<string, unknown> });
        });
      }
    );

    if (!result?.cookie) return false;

    const csrf = result.cookie.match(/csrf=([^;]+)/)?.[1] ?? config.csrf;

    await adminClient
      .from('connected_services')
      .update({
        access_token: result.cookie,
        token_expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        metadata: {
          csrf,
          user_agent: config.userAgent,
          former_registration_data:
            (result.cookieData?.formerRegistrationData as unknown) ?? config.formerRegistrationData,
          mac_dms: (result.cookieData?.macDms as unknown) ?? config.macDms,
          auto_refresh_enabled: config.autoRefreshEnabled,
          last_refreshed_at: new Date().toISOString(),
        },
      })
      .eq('user_id', userId)
      .eq('service', 'alexa');

    return true;
  } catch (err) {
    console.error('[alexa] cookie refresh failed:', err);
    return false;
  }
}
