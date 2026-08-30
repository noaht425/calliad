'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { Session } from '@supabase/supabase-js';

const AuthContext = createContext<{ session: Session | null; loading: boolean }>({
  session: null,
  loading: true,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let done = false;
    // Guard: if getSession hangs (Supabase connectivity issue), stop loading after 8s
    const timeout = setTimeout(() => {
      if (!done) { done = true; setLoading(false); }
    }, 8000);

    supabase.auth.getSession().then(({ data }) => {
      if (!done) { done = true; clearTimeout(timeout); }
      setSession(data.session);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => {
      setSession(s);
    });
    return () => { clearTimeout(timeout); subscription.unsubscribe(); };
  }, []);

  return (
    <AuthContext.Provider value={{ session, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
