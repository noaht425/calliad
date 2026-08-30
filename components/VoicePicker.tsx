'use client';
import { useState } from 'react';

interface Props {
  voices: SpeechSynthesisVoice[];
  voiceIndex: number;
  onSelect: (index: number) => void;
}

function voiceQuality(v: SpeechSynthesisVoice): { label: string; dim: boolean } {
  const n = v.name;
  if (n.includes('Premium')) return { label: 'Premium', dim: false };
  if (n.includes('Enhanced')) return { label: 'Enhanced', dim: false };
  if (v.localService) return { label: 'Standard', dim: true };
  return { label: 'Network', dim: true };
}

function displayName(v: SpeechSynthesisVoice): string {
  return v.name
    .replace(' (Enhanced)', '')
    .replace(' (Premium)', '')
    .trim();
}

export function VoicePicker({ voices, voiceIndex, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const current = voices[voiceIndex];

  if (!current) return null;

  return (
    <>
      {/* Trigger */}
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
        title="Change voice"
      >
        <span className="max-w-[72px] truncate">{displayName(current)}</span>
        <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* Sheet */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="fixed bottom-0 inset-x-0 z-50 bg-[#fafaf8] dark:bg-[#111111] rounded-t-2xl border-t border-zinc-200/60 dark:border-zinc-800/60 shadow-2xl max-h-[60vh] flex flex-col">
            <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
              <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Choose a voice</span>
              <button
                onClick={() => setOpen(false)}
                className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto flex-1">
              {voices.map((v, i) => {
                const { label, dim } = voiceQuality(v);
                const selected = i === voiceIndex;
                return (
                  <button
                    key={i}
                    onClick={() => {
                      onSelect(i);
                      setOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors border-b border-zinc-100 dark:border-zinc-800/60 last:border-0 ${
                      selected
                        ? 'bg-zinc-100 dark:bg-zinc-800'
                        : 'hover:bg-zinc-50 dark:hover:bg-zinc-900'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {selected ? (
                        <svg className="w-4 h-4 text-zinc-900 dark:text-zinc-100 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      ) : (
                        <span className="w-4 h-4 shrink-0" />
                      )}
                      <span className={`text-sm ${selected ? 'font-semibold text-zinc-900 dark:text-zinc-100' : 'text-zinc-700 dark:text-zinc-300'}`}>
                        {displayName(v)}
                      </span>
                    </div>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                      dim
                        ? 'text-zinc-400 bg-zinc-100 dark:bg-zinc-800 dark:text-zinc-600'
                        : 'text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-900/30'
                    }`}>
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}
