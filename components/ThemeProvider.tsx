'use client';
import { createContext, useContext, useEffect, useState } from 'react';

export type Theme = 'standard' | 'italy' | 'workshop' | 'loyalty';

const STORAGE_KEY = 'calliad-theme';

export const THEMES: { id: Theme; label: string; paper: string; accent: string }[] = [
  { id: 'standard', label: 'Standard', paper: '#F7F5EF', accent: '#3F6B4F' },
  { id: 'italy',    label: 'Italy',    paper: '#F8F4EA', accent: '#A24A25' },
  { id: 'workshop', label: 'Workshop', paper: '#17181A', accent: '#D9552F' },
  { id: 'loyalty',  label: 'Loyalty',  paper: '#FAF5E8', accent: '#8A5A12' },
];

const ThemeCtx = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({
  theme: 'standard',
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('standard');

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
      if (stored) {
        setThemeState(stored);
        document.documentElement.dataset.theme = stored;
      }
    } catch {}
  }, []);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem(STORAGE_KEY, t); } catch {}
  };

  return <ThemeCtx.Provider value={{ theme, setTheme }}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);
