'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type Step = 'email' | 'code';

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { error } = await supabase.auth.signInWithOtp({ email });
    if (error) {
      setError(error.message);
    } else {
      setStep('code');
    }
    setLoading(false);
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: 'email',
    });
    if (error) {
      setError('Invalid or expired code. Try again.');
    } else {
      router.push('/');
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-[#fafaf8] dark:bg-[#0a0a0a] flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Calliad
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            The clever assistant that remembers so you don't have to.
          </p>
        </div>

        {step === 'email' ? (
          <form onSubmit={handleSendCode} className="space-y-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              autoFocus
              className="w-full px-4 py-3 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 outline-none focus:border-zinc-400 dark:focus:border-zinc-600 transition-colors"
            />
            {error && <p className="text-xs text-red-500">{error}</p>}
            <button
              type="submit"
              disabled={loading || !email}
              className="w-full py-3 text-sm font-medium rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 disabled:opacity-50 transition-opacity"
            >
              {loading ? 'Sending…' : 'Send code'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerify} className="space-y-3">
            <div className="text-center space-y-1 pb-2">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Check your email</p>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Enter the 6-digit code sent to{' '}
                <span className="font-mono text-zinc-700 dark:text-zinc-300">{email}</span>
              </p>
            </div>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              autoFocus
              className="w-full px-4 py-3 text-center text-2xl font-mono tracking-widest rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-300 outline-none focus:border-zinc-400 dark:focus:border-zinc-600 transition-colors"
            />
            {error && <p className="text-xs text-red-500 text-center">{error}</p>}
            <button
              type="submit"
              disabled={loading || code.length < 6}
              className="w-full py-3 text-sm font-medium rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 disabled:opacity-50 transition-opacity"
            >
              {loading ? 'Verifying…' : 'Sign in'}
            </button>
            <button
              type="button"
              onClick={() => { setStep('email'); setCode(''); setError(''); }}
              className="w-full py-2 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            >
              Use a different email
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
