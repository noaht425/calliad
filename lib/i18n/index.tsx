'use client';
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { en } from './en';
import { it } from './it';
import type { Translations } from './en';

export type Locale = 'en' | 'it';

export const SUPPORTED_LOCALES: { code: Locale; label: string; nativeLabel: string }[] = [
  { code: 'en', label: 'English', nativeLabel: 'English' },
  { code: 'it', label: 'Italian', nativeLabel: 'Italiano' },
];

const STRINGS: Record<Locale, Translations> = { en, it };
const STORAGE_KEY = 'calliad_locale_override';

// Flatten nested object to dot-path map for t() lookups
function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  return Object.entries(obj).reduce((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null) {
      Object.assign(acc, flatten(v as Record<string, unknown>, key));
    } else {
      acc[key] = v as string;
    }
    return acc;
  }, {} as Record<string, string>);
}

const FLAT_STRINGS: Record<Locale, Record<string, string>> = {
  en: flatten(en as unknown as Record<string, unknown>),
  it: flatten(it as unknown as Record<string, unknown>),
};

function detectDeviceLocale(): Locale {
  if (typeof navigator === 'undefined') return 'en';
  const lang = (navigator.language ?? '').toLowerCase();
  if (lang.startsWith('it')) return 'it';
  return 'en';
}

type I18nCtx = {
  locale: Locale;
  deviceLocale: Locale;
  override: Locale | null;
  setOverride: (l: Locale | null) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  timeAgo: (iso: string) => string;
};

const I18nContext = createContext<I18nCtx | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [override, setOverrideState] = useState<Locale | null>(null);
  const [deviceLocale, setDeviceLocale] = useState<Locale>('en');

  useEffect(() => {
    const detected = detectDeviceLocale();
    setDeviceLocale(detected);
    const stored = localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (stored && STRINGS[stored]) setOverrideState(stored);
  }, []);

  const locale: Locale = override ?? deviceLocale;
  const flat = FLAT_STRINGS[locale];

  const setOverride = useCallback((l: Locale | null) => {
    setOverrideState(l);
    if (l) localStorage.setItem(STORAGE_KEY, l);
    else localStorage.removeItem(STORAGE_KEY);
  }, []);

  const t = useCallback((key: string, vars?: Record<string, string | number>): string => {
    let result = flat[key] ?? FLAT_STRINGS.en[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        result = result.replace(`{${k}}`, String(v));
      }
    }
    return result;
  }, [flat]);

  const timeAgo = useCallback((iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t('time.justNow');
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    if (mins < 60) return rtf.format(-mins, 'minute');
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return rtf.format(-hrs, 'hour');
    return rtf.format(-Math.floor(hrs / 24), 'day');
  }, [locale, t]);

  return (
    <I18nContext.Provider value={{ locale, deviceLocale, override, setOverride, t, timeAgo }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Fallback for SSR or when used outside provider — return English no-op
    return {
      locale: 'en' as Locale,
      deviceLocale: 'en' as Locale,
      override: null,
      setOverride: () => {},
      t: (key: string, vars?: Record<string, string | number>) => {
        let result = FLAT_STRINGS.en[key] ?? key;
        if (vars) for (const [k, v] of Object.entries(vars)) result = result.replace(`{${k}}`, String(v));
        return result;
      },
      timeAgo: (iso: string) => {
        const diff = Date.now() - new Date(iso).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        return `${Math.floor(hrs / 24)}d ago`;
      },
    };
  }
  return ctx;
}

export function useT() {
  return useI18n().t;
}

export function useTimeAgo() {
  return useI18n().timeAgo;
}
