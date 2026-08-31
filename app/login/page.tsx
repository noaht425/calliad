'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type Mode = 'password' | 'code-email' | 'code-enter';

const inputCls =
  'w-full px-4 py-3 text-sm rounded-xl outline-none transition-colors bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-quiet)] focus:border-[var(--accent-border)]';
const btnCls =
  'w-full py-3 text-sm font-medium rounded-xl bg-[var(--accent)] text-[var(--on-accent)] disabled:opacity-50 transition-opacity';
const linkCls = 'w-full py-2 text-xs text-[var(--text-quiet)] hover:text-[var(--text-muted)] transition-colors';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function withPassword(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError(error.message);
    else router.push('/');
  }

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    const { error } = await supabase.auth.signInWithOtp({ email });
    setLoading(false);
    if (error) setError(error.message);
    else setMode('code-enter');
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    const { error } = await supabase.auth.verifyOtp({ email, token: code.trim(), type: 'email' });
    setLoading(false);
    if (error) setError('Invalid or expired code.');
    else router.push('/');
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ background: 'var(--paper)' }}>
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight" style={{ fontFamily: 'var(--font-display)', color: 'var(--text)' }}>Calliad</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>The clever assistant that remembers so you don&apos;t have to.</p>
        </div>

        {mode === 'password' && (
          <form onSubmit={withPassword} className="space-y-3">
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your@email.com" required autoFocus className={inputCls} />
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" required className={inputCls} />
            {error && <p className="text-xs text-red-500">{error}</p>}
            <button type="submit" disabled={loading || !email || !password} className={btnCls}>{loading ? 'Signing in…' : 'Sign in'}</button>
            <button type="button" onClick={() => { setMode('code-email'); setError(''); }} className={linkCls}>
              Email me a code instead
            </button>
          </form>
        )}

        {mode === 'code-email' && (
          <form onSubmit={sendCode} className="space-y-3">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your@email.com" required autoFocus className={inputCls} />
            {error && <p className="text-xs text-red-500">{error}</p>}
            <button type="submit" disabled={loading || !email} className={btnCls}>{loading ? 'Sending…' : 'Send code'}</button>
            <button type="button" onClick={() => { setMode('password'); setError(''); }} className={linkCls}>
              Use a password
            </button>
          </form>
        )}

        {mode === 'code-enter' && (
          <form onSubmit={verifyCode} className="space-y-3">
            <p className="text-center text-sm pb-1" style={{ color: "var(--text-muted)" }}>
              Check your email — the code or the link both work.
            </p>
            <input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="000000" autoFocus className={`${inputCls} text-center text-2xl font-mono tracking-widest`} />
            {error && <p className="text-xs text-red-500 text-center">{error}</p>}
            <button type="submit" disabled={loading || code.length < 6} className={btnCls}>{loading ? 'Verifying…' : 'Sign in'}</button>
            <button type="button" onClick={() => { setMode('password'); setCode(''); setError(''); }} className={linkCls}>
              Back
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
