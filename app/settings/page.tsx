'use client';
import { useEffect, useState, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { requestPushPermission } from '@/components/PushSetup';
import { BottomNav } from '@/components/BottomNav';
import { useI18n, SUPPORTED_LOCALES, type Locale } from '@/lib/i18n';
import { VoicePicker } from '@/components/VoicePicker';

interface Profile {
  full_name?: string;
  home_city?: string;
  home_airport?: string;
  timezone?: string;
  preferred_airlines?: string[];
  preferred_hotel_chains?: string[];
  preferred_car_rental?: string[];
  dietary_preferences?: string[];
  frequent_cities?: string[];
  has_pet?: boolean;
  metadata?: Record<string, unknown>;
}

interface FamilyMember {
  id: string;
  name: string;
  relationship: string;
  email?: string;
  location_city?: string;
  birthday?: string;
  anniversary?: string;
  notes?: string;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const FAMILY_RELATIONSHIPS = ['spouse', 'child', 'parent', 'sibling', 'other'];

function TagInput({ label, value, onChange }: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [input, setInput] = useState('');
  function add() {
    const trimmed = input.trim();
    if (trimmed && !value.includes(trimmed)) onChange([...value, trimmed]);
    setInput('');
  }
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">{label}</label>
      <div className="flex flex-wrap gap-1.5 min-h-[36px] p-2 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
        {value.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-700 dark:text-zinc-300">
            {v}
            <button onClick={() => onChange(value.filter((x) => x !== v))} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 leading-none">×</button>
          </span>
        ))}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }}
          onBlur={add}
          placeholder="Type and press Enter…"
          className="flex-1 min-w-[120px] bg-transparent text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 outline-none"
        />
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 outline-none focus:border-zinc-400 dark:focus:border-zinc-600 transition-colors"
      />
    </div>
  );
}

export default function SettingsPage() {
  return <Suspense><SettingsInner /></Suspense>;
}

function SettingsInner() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [profile, setProfile] = useState<Profile>({});
  const [family, setFamily] = useState<FamilyMember[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newMember, setNewMember] = useState<Partial<FamilyMember>>({});
  const [addingMember, setAddingMember] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<FamilyMember>>({});
  const [alexaStatus, setAlexaStatus] = useState<{
    connected: boolean;
    autoRefreshEnabled: boolean;
    lastRefreshedAt: string | null;
  }>({ connected: false, autoRefreshEnabled: false, lastRefreshedAt: null });
  const [togglingAutoRefresh, setTogglingAutoRefresh] = useState(false);
  const [showSetupInstructions, setShowSetupInstructions] = useState(false);
  const [gmailStatus, setGmailStatus] = useState<{
    connected: boolean;
    email?: string;
    lastScannedAt?: string | null;
    authError?: boolean;
  }>({ connected: false });
  const [travelScanning, setTravelScanning] = useState(false);
  const [travelDays, setTravelDays] = useState(90);
  const [travelResult, setTravelResult] = useState<{ captured: number; total_fetched: number; timedOut?: boolean; authError?: boolean } | null>(null);
  const [sentScanning, setSentScanning] = useState(false);
  const [sentDays, setSentDays] = useState(180);
  const [sentResult, setSentResult] = useState<{ captured: number; total_fetched: number; timedOut?: boolean; authError?: boolean } | null>(null);
  const [icloudStatus, setIcloudStatus] = useState<{
    connected: boolean;
    calendarName?: string | null;
    lastSyncedAt?: string | null;
  }>({ connected: false });
  const [icloudStep, setIcloudStep] = useState<'idle' | 'form' | 'testing' | 'picking' | 'saving'>('idle');
  const [icloudForm, setIcloudForm] = useState({ appleId: '', appPassword: '' });
  const [icloudCalendars, setIcloudCalendars] = useState<{ url: string; displayName: string }[]>([]);
  const [icloudSelected, setIcloudSelected] = useState('');
  const [icloudSyncing, setIcloudSyncing] = useState(false);
  const [icloudRefreshing, setIcloudRefreshing] = useState(false);
  const [icloudError, setIcloudError] = useState('');
  const [icloudSyncResult, setIcloudSyncResult] = useState<{ synced: number; removed: number } | null>(null);
  const [ttsVoices, setTtsVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [ttsVoiceIndex, setTtsVoiceIndex] = useState(0);
  const [icloudRefreshOk, setIcloudRefreshOk] = useState(false);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [shareTokenCopied, setShareTokenCopied] = useState(false);
  const [regeneratingToken, setRegeneratingToken] = useState(false);
  const [alexaPulling, setAlexaPulling] = useState(false);
  const [alexaPullResult, setAlexaPullResult] = useState<{ pulled: number; skipped: number; total: number } | null>(null);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [notifEnabling, setNotifEnabling] = useState(false);
  const [intelRunning, setIntelRunning] = useState(false);
  const [intelResult, setIntelResult] = useState<{ trip_reconciliation: { processed: number; action_cards_created: number; verified: number }; shopping: { processed: number; filed: number }; projects: { filed: number }; unsubscribes: { detected: number; archived: number } } | null>(null);
  const [activeTab, setActiveTab] = useState<'about' | 'services'>('about');
  const [familyExpanded, setFamilyExpanded] = useState(false);
  const { locale, deviceLocale, override, setOverride } = useI18n();

  const alexaParam = searchParams.get('alexa');
  const gmailParam = searchParams.get('gmail');

  useEffect(() => {
    if (!loading && !session) router.push('/login');
  }, [loading, session, router]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('Notification' in window)) { setNotifPermission('unsupported'); return; }
    setNotifPermission(Notification.permission);
  }, []);

  // Load TTS voices and restore saved selection
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const load = () => {
      const all = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
      if (all.length === 0) return;
      setTtsVoices(all);
      const saved = localStorage.getItem('calliad_voice_name');
      if (saved) {
        const idx = all.findIndex((v) => v.name === saved);
        if (idx >= 0) setTtsVoiceIndex(idx);
      }
    };
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  const load = useCallback(async () => {
    const headers = await authHeaders();
    const [profileRes, alexaRes, gmailRes, icloudRes] = await Promise.all([
      fetch('/api/profile', { headers }),
      fetch('/api/alexa/status', { headers }),
      fetch('/api/gmail/status', { headers }),
      fetch('/api/icloud/status', { headers }),
    ]);
    if (profileRes.ok) {
      const data = await profileRes.json();
      if (data.profile) {
        const meta = (data.profile.metadata ?? {}) as Record<string, unknown>;
        setProfile({ ...data.profile, has_pet: (meta.has_pet as boolean | undefined) ?? false });
        setShareToken(data.profile.share_token ?? null);
      }
      setFamily(data.familyMembers ?? []);
    }
    if (alexaRes.ok) {
      const status = await alexaRes.json();
      setAlexaStatus({
        connected: status.connected ?? false,
        autoRefreshEnabled: status.autoRefreshEnabled ?? false,
        lastRefreshedAt: status.lastRefreshedAt ?? null,
      });
    }
    if (gmailRes.ok) {
      setGmailStatus(await gmailRes.json());
    }
    if (icloudRes.ok) {
      const s = await icloudRes.json();
      setIcloudStatus(s);
      if (s.connected) setIcloudStep('idle');
    }
  }, []);

  useEffect(() => { if (session) load(); }, [session, load]);

  async function toggleAutoRefresh(enabled: boolean) {
    setTogglingAutoRefresh(true);
    const headers = { ...(await authHeaders()), 'Content-Type': 'application/json' };
    const res = await fetch('/api/alexa/toggle', {
      method: 'POST',
      headers,
      body: JSON.stringify({ enabled }),
    });
    if (res.ok) setAlexaStatus((s) => ({ ...s, autoRefreshEnabled: enabled }));
    setTogglingAutoRefresh(false);
  }

  function formatRefreshedAt(iso: string | null): string {
    if (!iso) return 'never';
    const d = new Date(iso);
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    return `${days} days ago`;
  }

  async function saveProfile() {
    setSaving(true);
    const headers = { ...(await authHeaders()), 'Content-Type': 'application/json' };
    await fetch('/api/profile', { method: 'PATCH', headers, body: JSON.stringify(profile) });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function addFamilyMember() {
    if (!newMember.name || !newMember.relationship) return;
    const headers = { ...(await authHeaders()), 'Content-Type': 'application/json' };
    const res = await fetch('/api/family', { method: 'POST', headers, body: JSON.stringify(newMember) });
    if (res.ok) {
      setNewMember({});
      setAddingMember(false);
      load();
    }
  }

  async function removeFamilyMember(id: string) {
    const headers = await authHeaders();
    await fetch(`/api/family/${id}`, { method: 'DELETE', headers });
    setFamily((f) => f.filter((m) => m.id !== id));
  }

  async function updateMember() {
    if (!editingId) return;
    const headers = { ...(await authHeaders()), 'Content-Type': 'application/json' };
    const res = await fetch(`/api/family/${editingId}`, { method: 'PATCH', headers, body: JSON.stringify(editDraft) });
    if (res.ok) {
      setEditingId(null);
      setEditDraft({});
      load();
    }
  }

  function startEdit(m: FamilyMember) {
    setEditingId(m.id);
    setEditDraft({ name: m.name, relationship: m.relationship, email: m.email, location_city: m.location_city, birthday: m.birthday, anniversary: m.anniversary, notes: m.notes });
  }

  async function connectGmail() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) window.location.href = `/api/auth/gmail/authorize?token=${token}`;
  }

  async function scanTravelExtended() {
    setTravelScanning(true);
    setTravelResult(null);
    const headers = { ...(await authHeaders()), 'Content-Type': 'application/json' };
    const res = await fetch('/api/gmail/scan-extended', { method: 'POST', headers, body: JSON.stringify({ days: travelDays, type: 'travel' }) });
    if (res.ok) {
      const data = await res.json() as { captured?: number; total_fetched?: number; auth_error?: boolean; timedOut?: boolean };
      if (data.auth_error) {
        setTravelResult({ captured: 0, total_fetched: 0, authError: true });
      } else {
        setTravelResult({ captured: data.captured ?? 0, total_fetched: data.total_fetched ?? 0, timedOut: data.timedOut });
      }
    } else {
      setTravelResult({ captured: 0, total_fetched: 0, timedOut: true });
    }
    setTravelScanning(false);
    load();
  }

  async function scanSentExtended() {
    setSentScanning(true);
    setSentResult(null);
    const headers = { ...(await authHeaders()), 'Content-Type': 'application/json' };
    const res = await fetch('/api/gmail/scan-extended', { method: 'POST', headers, body: JSON.stringify({ days: sentDays, type: 'sent' }) });
    if (res.ok) {
      const data = await res.json() as { captured?: number; total_fetched?: number; auth_error?: boolean; timedOut?: boolean };
      if (data.auth_error) {
        setSentResult({ captured: 0, total_fetched: 0, authError: true });
      } else {
        setSentResult({ captured: data.captured ?? 0, total_fetched: data.total_fetched ?? 0, timedOut: data.timedOut });
      }
    } else {
      setSentResult({ captured: 0, total_fetched: 0, timedOut: true });
    }
    setSentScanning(false);
  }

  async function testICloudConnection() {
    setIcloudStep('testing');
    setIcloudError('');
    const headers = { ...(await authHeaders()), 'Content-Type': 'application/json' };
    const res = await fetch('/api/auth/icloud/connect', {
      method: 'POST',
      headers,
      body: JSON.stringify({ apple_id: icloudForm.appleId, app_password: icloudForm.appPassword }),
    });
    const data = await res.json();
    if (!res.ok) {
      setIcloudError(data.error ?? 'Connection failed');
      setIcloudStep('form');
      return;
    }
    setIcloudCalendars(data.calendars ?? []);
    setIcloudSelected(data.calendars?.[0]?.url ?? '');
    setIcloudStep('picking');
  }

  async function saveICloudCalendar() {
    setIcloudStep('saving');
    setIcloudError('');
    const cal = icloudCalendars.find((c) => c.url === icloudSelected);
    const headers = { ...(await authHeaders()), 'Content-Type': 'application/json' };
    const res = await fetch('/api/auth/icloud/connect', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        apple_id: icloudForm.appleId,
        app_password: icloudForm.appPassword,
        calendar_url: icloudSelected,
        calendar_name: cal?.displayName,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setIcloudError(data.error ?? 'Save failed');
      setIcloudStep('picking');
      return;
    }
    setIcloudStatus({ connected: true, calendarName: data.calendarName, lastSyncedAt: new Date().toISOString() });
    setIcloudForm({ appleId: '', appPassword: '' });
    setIcloudStep('idle');
  }

  async function copyShareToken() {
    if (!shareToken) return;
    await navigator.clipboard.writeText(shareToken);
    setShareTokenCopied(true);
    setTimeout(() => setShareTokenCopied(false), 2000);
  }

  async function regenerateShareToken() {
    setRegeneratingToken(true);
    const headers = { ...(await authHeaders()), 'Content-Type': 'application/json' };
    const res = await fetch('/api/share-token', { method: 'POST', headers });
    if (res.ok) {
      const data = await res.json();
      setShareToken(data.share_token);
    }
    setRegeneratingToken(false);
  }

  async function pullFromAlexa() {
    setAlexaPulling(true);
    setAlexaPullResult(null);
    const headers = await authHeaders();
    const res = await fetch('/api/alexa/pull', { method: 'POST', headers });
    if (res.ok) setAlexaPullResult(await res.json());
    setAlexaPulling(false);
  }

  async function enableNotifications() {
    if (!session) return;
    setNotifEnabling(true);
    const ok = await requestPushPermission(session.access_token);
    setNotifPermission(ok ? 'granted' : Notification.permission);
    setNotifEnabling(false);
  }

  async function runIntelligenceSync() {
    setIntelRunning(true);
    setIntelResult(null);
    try {
      const res = await fetch('/api/sync/intelligence', {
        method: 'POST',
        headers: await authHeaders(),
      });
      const data = await res.json();
      if (data.ok) setIntelResult(data.results);
    } catch {}
    setIntelRunning(false);
  }

  async function refreshICloudConnection() {
    setIcloudRefreshing(true);
    setIcloudError('');
    setIcloudRefreshOk(false);
    try {
      const res = await fetch('/api/auth/icloud/refresh', {
        method: 'POST',
        headers: await authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        setIcloudError(data.error ?? 'Refresh failed');
      } else {
        setIcloudRefreshOk(true);
        setTimeout(() => setIcloudRefreshOk(false), 3000);
        await load();
      }
    } catch {
      setIcloudError('Refresh failed');
    }
    setIcloudRefreshing(false);
  }

  async function syncICloudNow() {
    setIcloudSyncing(true);
    setIcloudSyncResult(null);
    const headers = await authHeaders();
    const res = await fetch('/api/calendar/sync', { method: 'POST', headers });
    if (res.ok) {
      const data = await res.json();
      setIcloudSyncResult({ synced: data.synced ?? 0, removed: data.removed ?? 0 });
    }
    setIcloudSyncing(false);
    load();
  }

  function formatScannedAt(iso: string | null | undefined): string {
    if (!iso) return 'never';
    const d = new Date(iso);
    const mins = Math.floor((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  function set(key: keyof Profile) {
    return (v: string | string[]) => setProfile((p) => ({ ...p, [key]: v }));
  }

  if (loading || !session) return null;

  const actionBtn = "text-xs font-medium px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50";
  const primaryBtn = "text-xs font-medium px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90 transition-opacity disabled:opacity-50";
  const connectedBadge = "shrink-0 text-xs font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 px-2 py-1 rounded-md";

  return (
    <div className="min-h-screen bg-[#fafaf8] dark:bg-[#0a0a0a]">
      <header className="sticky top-0 z-10 bg-[#fafaf8]/80 dark:bg-[#0a0a0a]/80 backdrop-blur-xl border-b border-zinc-200/60 dark:border-zinc-800/60 px-4 pt-3 pb-0">
        <div className="max-w-xl mx-auto">
          <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3">Settings</h1>
          <div className="flex gap-4">
            {(['about', 'services'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`pb-2.5 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === tab
                    ? 'border-zinc-900 dark:border-zinc-100 text-zinc-900 dark:text-zinc-100'
                    : 'border-transparent text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400'
                }`}
              >
                {tab === 'about' ? 'About You' : 'Services'}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-6 pb-32 space-y-8">

        {activeTab === 'about' && (
          <>
            {/* Personal */}
            <section className="space-y-4">
              <h2 className="text-xs font-semibold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">Personal</h2>
              <Field label="Your name" value={profile.full_name ?? ''} onChange={set('full_name')} placeholder="Doug Turner" />
              <Field label="Home city" value={profile.home_city ?? ''} onChange={set('home_city')} placeholder="Kirkland, WA" />
              <Field label="Home airport" value={profile.home_airport ?? ''} onChange={set('home_airport')} placeholder="SEA" />
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Timezone</label>
                <select
                  value={profile.timezone ?? 'America/Los_Angeles'}
                  onChange={(e) => set('timezone')(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-400 dark:focus:border-zinc-600 transition-colors"
                >
                  <option value="America/Los_Angeles">Pacific Time</option>
                  <option value="America/Denver">Mountain Time</option>
                  <option value="America/Chicago">Central Time</option>
                  <option value="America/New_York">Eastern Time</option>
                  <option value="America/Anchorage">Alaska Time</option>
                  <option value="Pacific/Honolulu">Hawaii Time</option>
                </select>
              </div>
            </section>

            {/* Travel preferences */}
            <section className="space-y-4">
              <h2 className="text-xs font-semibold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">Travel preferences</h2>
              <TagInput label="Preferred airlines" value={profile.preferred_airlines ?? []} onChange={set('preferred_airlines') as (v: string[]) => void} />
              <TagInput label="Preferred hotel chains" value={profile.preferred_hotel_chains ?? []} onChange={set('preferred_hotel_chains') as (v: string[]) => void} />
              <TagInput label="Preferred car rental" value={profile.preferred_car_rental ?? []} onChange={set('preferred_car_rental') as (v: string[]) => void} />
              <TagInput label="Frequently visited cities" value={profile.frequent_cities ?? []} onChange={set('frequent_cities') as (v: string[]) => void} />
            </section>

            {/* Food */}
            <section className="space-y-4">
              <h2 className="text-xs font-semibold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">Food & diet</h2>
              <TagInput label="Dietary preferences or restrictions" value={profile.dietary_preferences ?? []} onChange={set('dietary_preferences') as (v: string[]) => void} />
            </section>

            {/* Home & trip prep */}
            <section className="space-y-4">
              <h2 className="text-xs font-semibold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">Home & trip prep</h2>
              <div className="rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">I have a pet</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Calliad will remind you to arrange pet boarding before trips</p>
                  </div>
                  <button
                    onClick={() => setProfile((p) => ({ ...p, has_pet: !p.has_pet }))}
                    className={`relative w-10 h-6 rounded-full transition-colors ${profile.has_pet ? 'bg-zinc-900 dark:bg-zinc-100' : 'bg-zinc-200 dark:bg-zinc-700'}`}
                  >
                    <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white dark:bg-zinc-900 transition-transform ${profile.has_pet ? 'translate-x-4' : ''}`} />
                  </button>
                </div>
              </div>
            </section>

            {/* Assistant Voice */}
            <section className="space-y-3">
              <h2 className="text-xs font-semibold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">Assistant Voice</h2>
              <div className="rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                {ttsVoices.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-zinc-400 dark:text-zinc-600">Voices not available on this device.</p>
                ) : (
                  <div className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Calliad&rsquo;s voice</p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Heard when voice reply is on</p>
                    </div>
                    <VoicePicker
                      voices={ttsVoices}
                      voiceIndex={ttsVoiceIndex}
                      onSelect={(idx) => {
                        setTtsVoiceIndex(idx);
                        localStorage.setItem('calliad_voice_name', ttsVoices[idx]?.name ?? '');
                        const u = new SpeechSynthesisUtterance("Hi, I'm Calliad. How does this sound?");
                        u.voice = ttsVoices[idx];
                        window.speechSynthesis.cancel();
                        window.speechSynthesis.speak(u);
                      }}
                    />
                  </div>
                )}
              </div>
            </section>

            {/* Language */}
            <section className="space-y-3">
              <h2 className="text-xs font-semibold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">Language</h2>
              <div className="rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Override device language</p>
                    {!override && (
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                        Using device language: {SUPPORTED_LOCALES.find((l) => l.code === deviceLocale)?.nativeLabel ?? deviceLocale}
                      </p>
                    )}
                  </div>
                  <button
                    role="switch"
                    aria-checked={!!override}
                    onClick={() => {
                      if (override) {
                        setOverride(null);
                        fetch('/api/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` }, body: JSON.stringify({ language_override: null }) }).catch(() => {});
                      } else {
                        setOverride(locale as Locale);
                        fetch('/api/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` }, body: JSON.stringify({ language_override: locale }) }).catch(() => {});
                      }
                    }}
                    className={[
                      'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200',
                      override ? 'bg-zinc-900 dark:bg-zinc-100' : 'bg-zinc-200 dark:bg-zinc-700',
                    ].join(' ')}
                  >
                    <span className={[
                      'pointer-events-none inline-block h-5 w-5 rounded-full bg-white dark:bg-zinc-900 shadow transform transition-transform duration-200',
                      override ? 'translate-x-5' : 'translate-x-0',
                    ].join(' ')} />
                  </button>
                </div>
                {override && (
                  <div className="border-t border-zinc-100 dark:border-zinc-800 px-4 py-3">
                    <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide block mb-2">Language</label>
                    <select
                      value={override}
                      onChange={(e) => {
                        const val = e.target.value as Locale;
                        setOverride(val);
                        fetch('/api/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` }, body: JSON.stringify({ language_override: val }) }).catch(() => {});
                      }}
                      className="w-full px-3 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-900 dark:text-zinc-100 outline-none"
                    >
                      {SUPPORTED_LOCALES.map((l) => (
                        <option key={l.code} value={l.code}>{l.nativeLabel} — {l.label}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </section>

            <button onClick={saveProfile} disabled={saving}
              className="w-full py-2.5 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50">
              {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save profile'}
            </button>

            {/* Family — collapsible */}
            {(() => {
              const familyOnly = family.filter((m) => m.relationship !== 'friend');
              const editForm = () => (
                <div className="p-4 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-3">
                  <Field label="Name" value={editDraft.name ?? ''} onChange={(v) => setEditDraft((d) => ({ ...d, name: v }))} placeholder="Jane" />
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Relationship</label>
                    <select value={editDraft.relationship ?? ''} onChange={(e) => setEditDraft((d) => ({ ...d, relationship: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-sm text-zinc-900 dark:text-zinc-100 outline-none">
                      <option value="">Select…</option>
                      {FAMILY_RELATIONSHIPS.map((r) => <option key={r} value={r} className="capitalize">{r}</option>)}
                    </select>
                  </div>
                  <Field label="Email (optional)" value={editDraft.email ?? ''} onChange={(v) => setEditDraft((d) => ({ ...d, email: v }))} placeholder="jane@example.com" type="email" />
                  <Field label="City they live in" value={editDraft.location_city ?? ''} onChange={(v) => setEditDraft((d) => ({ ...d, location_city: v }))} placeholder="Austin, TX" />
                  <Field label="Notes (optional)" value={editDraft.notes ?? ''} onChange={(v) => setEditDraft((d) => ({ ...d, notes: v }))} placeholder="Vegetarian, allergic to shellfish…" />
                  <div className="flex gap-2 pt-1">
                    <button onClick={updateMember} className="flex-1 py-2 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium">Save</button>
                    <button onClick={() => { setEditingId(null); setEditDraft({}); }} className="flex-1 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-sm">Cancel</button>
                  </div>
                </div>
              );
              const memberRow = (m: FamilyMember) => (
                <div key={m.id}>
                  {editingId === m.id ? editForm() : (
                    <div className="flex items-start justify-between p-3 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{m.name}</p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 capitalize">{m.relationship}{m.location_city ? ` · ${m.location_city}` : ''}</p>
                        {m.notes && <p className="text-xs text-zinc-400 mt-0.5 truncate">{m.notes}</p>}
                      </div>
                      <div className="flex gap-3 ml-4 shrink-0">
                        <button onClick={() => startEdit(m)} className="text-xs text-zinc-400 hover:text-zinc-700 dark:text-zinc-600 dark:hover:text-zinc-300 transition-colors">Edit</button>
                        <button onClick={() => removeFamilyMember(m.id)} className="text-xs text-zinc-300 hover:text-red-400 dark:text-zinc-700 dark:hover:text-red-500 transition-colors">Remove</button>
                      </div>
                    </div>
                  )}
                </div>
              );
              return (
                <section className="space-y-3">
                  <button onClick={() => setFamilyExpanded((v) => !v)} className="flex items-center gap-2 w-full text-left">
                    <h2 className="text-xs font-semibold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest">Family members</h2>
                    {familyOnly.length > 0 && <span className="text-[10px] font-mono text-zinc-300 dark:text-zinc-700">{familyOnly.length}</span>}
                    <svg className={`w-3 h-3 text-zinc-300 dark:text-zinc-700 ml-auto transition-transform ${familyExpanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  {familyExpanded && (
                    <>
                      {familyOnly.map((m) => memberRow(m))}
                      {familyOnly.length === 0 && !addingMember && (
                        <p className="text-xs text-zinc-400 dark:text-zinc-600 text-center py-3">No family members added yet.</p>
                      )}
                      {addingMember ? (
                        <div className="p-4 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-3">
                          <Field label="Name" value={newMember.name ?? ''} onChange={(v) => setNewMember((m) => ({ ...m, name: v }))} placeholder="Jane" />
                          <div className="space-y-1.5">
                            <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Relationship</label>
                            <select value={newMember.relationship ?? ''} onChange={(e) => setNewMember((m) => ({ ...m, relationship: e.target.value }))}
                              className="w-full px-3 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-sm text-zinc-900 dark:text-zinc-100 outline-none">
                              <option value="">Select…</option>
                              {FAMILY_RELATIONSHIPS.map((r) => <option key={r} value={r} className="capitalize">{r}</option>)}
                            </select>
                          </div>
                          <Field label="Email (optional)" value={newMember.email ?? ''} onChange={(v) => setNewMember((m) => ({ ...m, email: v }))} placeholder="jane@example.com" type="email" />
                          <Field label="City they live in" value={newMember.location_city ?? ''} onChange={(v) => setNewMember((m) => ({ ...m, location_city: v }))} placeholder="Austin, TX" />
                          <Field label="Notes (optional)" value={newMember.notes ?? ''} onChange={(v) => setNewMember((m) => ({ ...m, notes: v }))} placeholder="Vegetarian, allergic to shellfish…" />
                          <div className="flex gap-2 pt-1">
                            <button onClick={addFamilyMember} className="flex-1 py-2 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium">Add</button>
                            <button onClick={() => { setAddingMember(false); setNewMember({}); }} className="flex-1 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-sm">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => setAddingMember(true)} className={actionBtn}>+ Add member</button>
                      )}
                    </>
                  )}
                </section>
              );
            })()}
          </>
        )}

        {activeTab === 'services' && (
          <>
            {gmailParam === 'connected' && (
              <div className="px-3 py-2 rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 text-xs text-green-700 dark:text-green-400">Gmail connected successfully.</div>
            )}
            {gmailParam === 'error' && (
              <div className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-400">Gmail connection failed. Check that your Google Cloud credentials are set up correctly.</div>
            )}
            {alexaParam === 'error' && (
              <div className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-400">Something went wrong. Try re-running the setup script.</div>
            )}

            {/* Gmail */}
            <div className="rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 overflow-hidden">
              <div className="flex items-start justify-between p-4">
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Gmail Capture</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Scan inbound travel and outbound sent email</p>
                </div>
                {gmailStatus.connected
                  ? (
                    <div className="flex items-center gap-2">
                      {gmailStatus.authError
                        ? <span className="shrink-0 text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 px-2 py-1 rounded-md">Auth expired</span>
                        : <span className={connectedBadge}>Connected</span>
                      }
                      <button onClick={connectGmail} className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">Reconnect</button>
                    </div>
                  )
                  : <button onClick={connectGmail} className={primaryBtn}>Connect</button>
                }
              </div>
              {gmailStatus.connected && (
                <div className="border-t border-zinc-100 dark:border-zinc-800 px-4 py-3 space-y-3">
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {gmailStatus.email && <span className="font-mono">{gmailStatus.email}</span>}{' · '}Last scanned: {formatScannedAt(gmailStatus.lastScannedAt)}
                  </p>
                  <p className="text-xs text-zinc-400 dark:text-zinc-600">Scans every 6 hours automatically.</p>
                  {/* Travel row */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400 w-16 shrink-0">Travel</span>
                    <select
                      value={travelDays}
                      onChange={(e) => setTravelDays(Number(e.target.value))}
                      disabled={travelScanning || sentScanning}
                      className="px-2 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-700 dark:text-zinc-300 outline-none"
                    >
                      <option value={90}>90 days</option>
                      <option value={180}>6 months</option>
                      <option value={365}>1 year</option>
                      <option value={730}>2 years</option>
                      <option value={1095}>3 years</option>
                    </select>
                    <button onClick={scanTravelExtended} disabled={travelScanning || sentScanning} className={actionBtn}>
                      {travelScanning ? 'Scanning…' : 'Scan'}
                    </button>
                  </div>
                  {travelResult && (
                    <p className={`text-xs pl-[4.5rem] ${travelResult.authError || travelResult.timedOut ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {travelResult.authError
                        ? 'Gmail auth expired — tap Reconnect above to re-authorize.'
                        : travelResult.timedOut
                          ? `Hit the time limit — ${travelResult.captured} captured. Run again to continue.`
                          : `Captured ${travelResult.captured} new email${travelResult.captured === 1 ? '' : 's'} from ${travelResult.total_fetched} fetched.`}
                    </p>
                  )}
                  {/* Outbound row */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400 w-16 shrink-0">Outbound</span>
                    <select
                      value={sentDays}
                      onChange={(e) => setSentDays(Number(e.target.value))}
                      disabled={travelScanning || sentScanning}
                      className="px-2 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-700 dark:text-zinc-300 outline-none"
                    >
                      <option value={90}>90 days</option>
                      <option value={180}>6 months</option>
                      <option value={365}>1 year</option>
                      <option value={730}>2 years</option>
                    </select>
                    <button onClick={scanSentExtended} disabled={travelScanning || sentScanning} className={actionBtn}>
                      {sentScanning ? 'Scanning…' : 'Scan'}
                    </button>
                  </div>
                  {sentResult && (
                    <p className={`text-xs pl-[4.5rem] ${sentResult.authError || sentResult.timedOut ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {sentResult.authError
                        ? 'Gmail auth expired — tap Reconnect above to re-authorize.'
                        : sentResult.timedOut
                          ? `Hit the time limit — ${sentResult.captured} captured. Run again to continue.`
                          : `Captured ${sentResult.captured} new email${sentResult.captured === 1 ? '' : 's'} from ${sentResult.total_fetched} fetched.`}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Alexa */}
            <div className="rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 overflow-hidden">
              <div className="flex items-start justify-between p-4">
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Alexa Shopping List</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Add grocery items by voice</p>
                </div>
                {alexaStatus.connected
                  ? <span className={connectedBadge}>Connected</span>
                  : <button onClick={() => setShowSetupInstructions((v) => !v)} className={primaryBtn}>Set up</button>
                }
              </div>
              {alexaStatus.connected && (
                <div className="border-t border-zinc-100 dark:border-zinc-800 px-4 py-3 space-y-3">
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Last refreshed: {formatRefreshedAt(alexaStatus.lastRefreshedAt)}</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={pullFromAlexa} disabled={alexaPulling} className={actionBtn}>
                      {alexaPulling ? 'Pulling…' : 'Pull from Alexa'}
                    </button>
                    <button onClick={() => setShowSetupInstructions((v) => !v)} className={actionBtn}>
                      Refresh cookies
                    </button>
                  </div>
                  {alexaPullResult && (
                    <p className="text-xs font-mono text-zinc-400 dark:text-zinc-500">
                      {alexaPullResult.pulled} new · {alexaPullResult.skipped} already in Calliad · {alexaPullResult.total} on Alexa
                    </p>
                  )}
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <div>
                      <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Auto-refresh cookies</p>
                      <p className="text-xs text-zinc-400 dark:text-zinc-600 mt-0.5 leading-tight">Headless refresh every 3 days. Carries some TOS risk.</p>
                    </div>
                    <button onClick={() => toggleAutoRefresh(!alexaStatus.autoRefreshEnabled)} disabled={togglingAutoRefresh}
                      className={`shrink-0 relative w-10 h-6 rounded-full transition-colors duration-200 ${alexaStatus.autoRefreshEnabled ? 'bg-zinc-900 dark:bg-zinc-100' : 'bg-zinc-200 dark:bg-zinc-700'} disabled:opacity-50`}
                      aria-label="Toggle auto-refresh">
                      <span className={`absolute top-1 w-4 h-4 rounded-full bg-white dark:bg-zinc-900 shadow transition-transform duration-200 ${alexaStatus.autoRefreshEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                    </button>
                  </div>
                </div>
              )}
              {showSetupInstructions && (
                <div className="border-t border-zinc-100 dark:border-zinc-800 px-4 py-3 space-y-2 bg-zinc-50 dark:bg-zinc-950">
                  <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{alexaStatus.connected ? 'Manual cookie refresh' : 'One-time setup'}</p>
                  <ol className="text-xs text-zinc-500 dark:text-zinc-400 space-y-1 list-decimal list-inside">
                    <li>Make sure Calliad is running locally (<code className="font-mono">npm run dev</code>)</li>
                    <li>Run: <code className="font-mono bg-zinc-100 dark:bg-zinc-900 px-1 rounded">node scripts/alexa-setup.js</code></li>
                    <li>Follow the terminal instructions to set your browser proxy</li>
                    <li>Visit alexa.amazon.com and log in — script captures cookies automatically</li>
                    <li>Restore your browser proxy settings when done</li>
                  </ol>
                  <button onClick={() => setShowSetupInstructions(false)} className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">Dismiss</button>
                </div>
              )}
            </div>

            {/* iCloud Calendar */}
            <div className="rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 overflow-hidden">
              <div className="flex items-start justify-between p-4">
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">iCloud Calendar</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Sync Apple Calendar events for context</p>
                </div>
                {icloudStatus.connected
                  ? <span className={connectedBadge}>Connected</span>
                  : icloudStep === 'idle'
                    ? <button onClick={() => setIcloudStep('form')} className={primaryBtn}>Connect</button>
                    : null
                }
              </div>
              {icloudStatus.connected && (
                <div className="border-t border-zinc-100 dark:border-zinc-800 px-4 py-3 space-y-3">
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {icloudStatus.calendarName && <span className="font-medium">{icloudStatus.calendarName}</span>}{' · '}Last synced: {formatScannedAt(icloudStatus.lastSyncedAt)}
                  </p>
                  <p className="text-xs text-zinc-400 dark:text-zinc-600">Syncs every 6 hours automatically.</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={syncICloudNow} disabled={icloudSyncing || icloudRefreshing} className={actionBtn}>
                      {icloudSyncing ? 'Syncing…' : 'Sync now'}
                    </button>
                    <button onClick={refreshICloudConnection} disabled={icloudSyncing || icloudRefreshing} className={actionBtn}>
                      {icloudRefreshing ? 'Refreshing…' : 'Refresh connection'}
                    </button>
                  </div>
                  {icloudSyncResult && (
                    <p className="text-xs font-mono text-zinc-400 dark:text-zinc-500">
                      {icloudSyncResult.synced} events synced{icloudSyncResult.removed > 0 ? ` · ${icloudSyncResult.removed} removed` : ''}
                    </p>
                  )}
                  {icloudRefreshOk && <p className="text-xs text-green-600 dark:text-green-400">Connection refreshed ✓</p>}
                  {icloudError && <p className="text-xs text-red-500 dark:text-red-400">{icloudError}</p>}
                </div>
              )}
              {icloudStep === 'form' && (
                <div className="border-t border-zinc-100 dark:border-zinc-800 px-4 py-3 space-y-3 bg-zinc-50 dark:bg-zinc-950">
                  <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Connect Apple Calendar</p>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Apple ID</label>
                    <input type="email" value={icloudForm.appleId} onChange={(e) => setIcloudForm((f) => ({ ...f, appleId: e.target.value }))} placeholder="you@icloud.com"
                      className="w-full px-3 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 outline-none focus:border-zinc-400 dark:focus:border-zinc-600 transition-colors" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">App-Specific Password</label>
                    <input type="password" value={icloudForm.appPassword} onChange={(e) => setIcloudForm((f) => ({ ...f, appPassword: e.target.value }))} placeholder="xxxx-xxxx-xxxx-xxxx"
                      className="w-full px-3 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 outline-none focus:border-zinc-400 dark:focus:border-zinc-600 transition-colors font-mono" />
                    <p className="text-xs text-zinc-400 dark:text-zinc-600">Generate at <span className="font-mono">appleid.apple.com</span> → Sign-In &amp; Security → App-Specific Passwords</p>
                  </div>
                  {icloudError && <p className="text-xs text-red-600 dark:text-red-400">{icloudError}</p>}
                  <div className="flex gap-2">
                    <button onClick={testICloudConnection} disabled={!icloudForm.appleId || !icloudForm.appPassword} className="flex-1 py-2 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium disabled:opacity-40">Connect</button>
                    <button onClick={() => { setIcloudStep('idle'); setIcloudError(''); }} className="flex-1 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-sm">Cancel</button>
                  </div>
                </div>
              )}
              {icloudStep === 'testing' && (
                <div className="border-t border-zinc-100 dark:border-zinc-800 px-4 py-4 bg-zinc-50 dark:bg-zinc-950">
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Testing connection…</p>
                </div>
              )}
              {icloudStep === 'picking' && (
                <div className="border-t border-zinc-100 dark:border-zinc-800 px-4 py-3 space-y-3 bg-zinc-50 dark:bg-zinc-950">
                  <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Choose a calendar to sync</p>
                  <div className="space-y-1.5">
                    {icloudCalendars.map((c) => (
                      <label key={c.url} className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="icloud_calendar" value={c.url} checked={icloudSelected === c.url} onChange={() => setIcloudSelected(c.url)} className="accent-zinc-900 dark:accent-zinc-100" />
                        <span className="text-sm text-zinc-800 dark:text-zinc-200">{c.displayName}</span>
                      </label>
                    ))}
                    {icloudCalendars.length === 0 && <p className="text-xs text-zinc-400">No calendars found.</p>}
                  </div>
                  {icloudError && <p className="text-xs text-red-600 dark:text-red-400">{icloudError}</p>}
                  <div className="flex gap-2">
                    <button onClick={saveICloudCalendar} disabled={!icloudSelected} className="flex-1 py-2 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium disabled:opacity-40">Save</button>
                    <button onClick={() => setIcloudStep('form')} className="flex-1 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-sm">Back</button>
                  </div>
                </div>
              )}
              {icloudStep === 'saving' && (
                <div className="border-t border-zinc-100 dark:border-zinc-800 px-4 py-4 bg-zinc-50 dark:bg-zinc-950">
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Saving and syncing…</p>
                </div>
              )}
            </div>

            {/* iOS Shortcuts */}
            <div className="rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 overflow-hidden">
              <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">iOS Shortcuts</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Share articles to Calliad from any app</p>
              </div>
              <div className="px-4 py-4 space-y-3">
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Your personal share token. Use it in a Shortcuts "Get Contents of URL" action to save articles silently to your inbox.</p>
                {shareToken ? (
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs font-mono bg-zinc-100 dark:bg-zinc-800 px-2 py-1.5 rounded-lg text-zinc-600 dark:text-zinc-400 truncate">{shareToken}</code>
                    <button onClick={copyShareToken} className={actionBtn}>{shareTokenCopied ? 'Copied ✓' : 'Copy'}</button>
                  </div>
                ) : (
                  <p className="text-xs text-zinc-400 dark:text-zinc-600 font-mono">Loading…</p>
                )}
                <div className="text-xs text-zinc-400 dark:text-zinc-600 space-y-1">
                  <p className="font-medium text-zinc-500 dark:text-zinc-400">Shortcut URL:</p>
                  <p className="font-mono break-all">https://calliad.vercel.app/api/share?token=YOUR_TOKEN&url=[URLs]&title=[Title]</p>
                </div>
                <button onClick={regenerateShareToken} disabled={regeneratingToken} className={actionBtn}>
                  {regeneratingToken ? 'Regenerating…' : 'Regenerate token'}
                </button>
              </div>
            </div>

            {/* Notifications */}
            <div className="rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 overflow-hidden">
              <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Notifications</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Get alerted when a to-do reminder comes due</p>
              </div>
              <div className="px-4 py-4 space-y-3">
                {notifPermission === 'unsupported' && <p className="text-xs text-zinc-500 dark:text-zinc-400">Push notifications aren&apos;t supported in this browser. Add Calliad to your Home Screen on iOS 16.4+ to enable them.</p>}
                {notifPermission === 'denied' && <p className="text-xs text-zinc-500 dark:text-zinc-400">Notifications are blocked. Open your browser settings and allow notifications for this site, then reload.</p>}
                {notifPermission === 'granted' && (
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><polyline points="20 6 9 17 4 12" /></svg>
                    <p className="text-xs text-zinc-700 dark:text-zinc-300">Notifications enabled on this device</p>
                  </div>
                )}
                {notifPermission === 'default' && (
                  <button onClick={enableNotifications} disabled={notifEnabling} className={primaryBtn}>
                    {notifEnabling ? 'Enabling…' : 'Enable notifications'}
                  </button>
                )}
              </div>
            </div>

            {/* Intelligence Sync */}
            <div className="rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 overflow-hidden">
              <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Intelligence Sync</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Re-run smart logic against existing inbox items</p>
              </div>
              <div className="px-4 py-4 space-y-3">
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Scans inbox items for trips, shopping, calendar events, unsubscribes, follow-ups, and anything that needs attention. Safe to run anytime.</p>
                <button onClick={runIntelligenceSync} disabled={intelRunning} className={primaryBtn}>
                  {intelRunning ? 'Running…' : 'Run now'}
                </button>
                {intelResult && (
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 space-y-0.5 font-mono">
                    <p>Trips: {intelResult.trip_reconciliation.processed} checked · {intelResult.trip_reconciliation.action_cards_created} action cards · {intelResult.trip_reconciliation.verified} verified</p>
                    <p>Shopping: {intelResult.shopping.processed} found · {intelResult.shopping.filed} filed</p>
                    <p>Projects: {intelResult.projects.filed} filed</p>
                    <p>Unsubscribes: {intelResult.unsubscribes.detected} detected · {intelResult.unsubscribes.archived} archived</p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

      </main>
      <BottomNav />
    </div>
  );
}
