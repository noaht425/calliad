'use client';
import { useState } from 'react';
import type { Capture, Folder, Trip } from '@/lib/types';
import { colorBg } from '@/lib/projectColors';

interface CalendarConfirmData {
  title: string;
  start_at: string;
  end_at?: string | null;
  all_day?: boolean;
  location?: string | null;
  description?: string | null;
  calendar_url?: string;
}

interface ResolvedState {
  replyText: string;
  ackText: string;
}

interface Props {
  capture: Capture;
  pairedResponse?: Capture;
  resolvedState?: ResolvedState;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  onRetry?: (id: string) => void;
  onFile?: (id: string, projectId: string) => void;
  onReply?: (id: string, label: string) => void;
  onResolvedArchive?: (id: string) => void;
  onCurationAnswer?: (id: string, answer: string) => void;
  onCurationDismiss?: (id: string, mode: 'skip' | 'remind') => void;
  onCalendarConfirm?: (id: string, data: CalendarConfirmData) => void;
  onSendToAbentfork?: (id: string) => void;
  onProjectSuggestionConfirm?: (id: string) => void;
  onFileToTrip?: (id: string, tripId: string) => void;
  folders?: Folder[];
  trips?: Trip[];
}

const sourceLabel: Record<string, string> = {
  pwa_button: 'app',
  back_tap: 'back tap',
  widget: 'widget',
  share: 'share',
  alexa: 'alexa',
  manual: 'typed',
  email: 'email',
  sent_email: 'sent',
  chat: 'you',
  assistant: 'calliad',
};

function formatTripLabel(raw: string): string {
  const [dest, date] = raw.split(' · ');
  const shortDest = dest ? dest.split(',').slice(0, 2).join(',').trim() : dest;
  let shortDate = date;
  if (date) {
    const d = new Date(date + 'T12:00:00');
    if (!isNaN(d.getTime())) {
      shortDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  }
  return shortDest && shortDate ? `${shortDest} · ${shortDate}` : shortDest ?? raw;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function InboxCard({ capture, pairedResponse, resolvedState, onArchive, onDelete, onRetry, onFile, onReply, onResolvedArchive, onCurationAnswer, onCurationDismiss, onCalendarConfirm, onSendToAbentfork, onProjectSuggestionConfirm, onFileToTrip, folders, trips }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [showAllTrips, setShowAllTrips] = useState(false);
  const isPending = capture.transcription_status === 'pending' || capture.transcription_status === 'processing';
  const isError = capture.transcription_status === 'error';

  // Voice question with an answer: white top (question) + blue bottom (answer)
  const voiceAnswerMeta = (capture.metadata ?? {}) as Record<string, unknown>;
  const voiceAnswer = voiceAnswerMeta.answer as string | undefined;
  if (voiceAnswer && capture.source !== 'action' && capture.source !== 'assistant') {
    return (
      <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
        {/* User's question */}
        <div className="bg-white dark:bg-zinc-900 px-4 pt-4 pb-3 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              {capture.summary ? (
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 leading-snug">{capture.summary}</p>
              ) : null}
              {capture.transcript && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed mt-1">{capture.transcript}</p>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0 -mr-1 -mt-1">
              {!confirmDelete ? (
                <>
                  <button onClick={() => onArchive(capture.id)} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors p-1" aria-label="Archive">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="20 6 9 17 4 12" /></svg>
                  </button>
                  <button onClick={() => setConfirmDelete(true)} className="text-zinc-400 hover:text-red-400 dark:hover:text-red-500 transition-colors p-1" aria-label="Delete">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" /></svg>
                  </button>
                </>
              ) : (
                <div className="flex gap-2 items-center pr-1">
                  <button onClick={() => setConfirmDelete(false)} className="text-xs text-zinc-400 hover:text-zinc-600 transition-colors px-1">Cancel</button>
                  <button onClick={() => onDelete(capture.id)} className="text-xs font-medium text-red-500 hover:text-red-600 transition-colors px-1">Delete</button>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {capture.tags.slice(0, 4).map((tag) => (
              <span key={tag} className="text-[11px] font-mono bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 px-2 py-0.5 rounded-full">{tag}</span>
            ))}
            <span className="ml-auto text-[11px] font-mono text-zinc-400 dark:text-zinc-500">{timeAgo(capture.created_at)}</span>
          </div>
        </div>
        {/* Calliad's answer */}
        <div className="bg-blue-50 dark:bg-blue-950/40 border-t border-blue-100 dark:border-blue-900/60 px-4 pt-3 pb-4 space-y-2">
          <p className="text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed">{voiceAnswer}</p>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono text-blue-400 dark:text-blue-500">calliad</span>
            {onReply && (
              <button
                onClick={() => onReply(capture.id, capture.summary ?? capture.transcript ?? 'question')}
                className="text-[11px] font-mono text-blue-500 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
              >
                Continue →
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Merged chat+response card: user question on top, Calliad response below
  if (capture.source === 'chat' && pairedResponse) {
    const archiveBoth = () => { onArchive(capture.id); onArchive(pairedResponse.id); };
    const deleteBoth = () => { onDelete(capture.id); onDelete(pairedResponse.id); };
    return (
      <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
        {/* User question */}
        <div className="bg-white dark:bg-zinc-900 px-4 pt-4 pb-3 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              {capture.summary ? (
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 leading-snug">{capture.summary}</p>
              ) : (
                <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">{capture.transcript}</p>
              )}
              {capture.summary && capture.transcript && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed mt-1">{capture.transcript}</p>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0 -mr-1 -mt-1">
              {!confirmDelete ? (
                <>
                  <button
                    onClick={archiveBoth}
                    className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors p-1"
                    aria-label="Archive"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="text-zinc-400 hover:text-red-400 dark:hover:text-red-500 transition-colors p-1"
                    aria-label="Delete"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                    </svg>
                  </button>
                </>
              ) : (
                <div className="flex gap-2 items-center pr-1">
                  <button onClick={() => setConfirmDelete(false)} className="text-xs text-zinc-400 hover:text-zinc-600 transition-colors px-1">Cancel</button>
                  <button onClick={deleteBoth} className="text-xs font-medium text-red-500 hover:text-red-600 transition-colors px-1">Delete</button>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {capture.tags.map((tag) => (
              <span key={tag} className="text-[11px] font-mono bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 px-2 py-0.5 rounded-full">{tag}</span>
            ))}
            <span className="ml-auto text-[11px] font-mono text-zinc-400 dark:text-zinc-500">you · {timeAgo(capture.created_at)}</span>
          </div>
        </div>
        {/* Calliad response */}
        <div className="bg-blue-50 dark:bg-blue-950/40 border-t border-blue-100 dark:border-blue-900/60 px-4 pt-3 pb-4 space-y-2">
          <p className="text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed">{pairedResponse.transcript}</p>
          {(() => {
            const resMeta = (pairedResponse.metadata ?? {}) as Record<string, unknown>;
            const flightUrl = resMeta.flight_search_url as string | undefined;
            if (!flightUrl) return null;
            const isAlaska = flightUrl.includes('alaskaair.com');
            return (
              <a
                href={flightUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 dark:bg-blue-700 text-white hover:opacity-90 transition-opacity"
              >
                {isAlaska ? '✈ Search Alaska Airlines' : '✈ Search Google Flights'}
                <svg className="w-3 h-3 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                  <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            );
          })()}
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono text-blue-400 dark:text-blue-500">calliad</span>
            <span className="text-[11px] font-mono text-zinc-400 dark:text-zinc-500">{timeAgo(pairedResponse.created_at)}</span>
          </div>
        </div>
      </div>
    );
  }

  if (capture.source === 'action' && (capture.metadata as Record<string, unknown> | null)?.action_type === 'project_suggestion') {
    const pMeta = (capture.metadata ?? {}) as Record<string, unknown>;
    const emailCount = (pMeta.email_count as number | undefined) ?? 0;

    return (
      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-xl p-4 space-y-3">
        <div className="flex items-start gap-2">
          <span className="shrink-0 mt-0.5 text-base">🏗️</span>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-mono text-amber-600 dark:text-amber-400 uppercase tracking-wide mb-1">
              project detected · {emailCount} emails
            </p>
            <p className="text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed">{capture.transcript}</p>
          </div>
        </div>
        <div className="flex gap-2 pl-6">
          <button
            onClick={() => onProjectSuggestionConfirm?.(capture.id)}
            className="px-3 py-1.5 text-xs font-medium rounded-full bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-700 dark:hover:bg-amber-600 transition-colors"
          >
            Create Folder
          </button>
          <button
            onClick={() => onArchive(capture.id)}
            className="px-3 py-1.5 text-xs font-medium rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
          >
            Not a project
          </button>
        </div>
        <div className="flex justify-end">
          <span className="text-[11px] font-mono text-zinc-400 dark:text-zinc-500">{timeAgo(capture.created_at)}</span>
        </div>
      </div>
    );
  }

  if (capture.source === 'action' && (capture.metadata as Record<string, unknown> | null)?.action_type === 'curation') {
    const meta = (capture.metadata ?? {}) as Record<string, unknown>;
    const tripLabel = meta.trip_label as string | undefined;
    const interactionType = meta.interaction_type as string | undefined;
    const choices = meta.choices as string[] | undefined;
    const turnCount = (meta.turn_count as number | undefined) ?? 0;
    const maxTurns = (meta.max_turns as number | undefined) ?? 3;

    return (
      <div className="bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800/50 rounded-xl p-4 space-y-3">
        <div className="flex items-start gap-2">
          <span className="text-violet-500 mt-0.5 shrink-0">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M9.663 17h4.673M12 3v1m6.364 1.636-.707.707M21 12h-1M4 12H3m3.343-5.657-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </span>
          <div className="flex-1 min-w-0">
            {tripLabel && (
              <p className="text-[11px] font-mono text-violet-500 dark:text-violet-400 uppercase tracking-wide mb-1">{tripLabel}</p>
            )}
            <p className="text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed whitespace-pre-wrap">{capture.transcript}</p>
          </div>
        </div>

        {interactionType === 'yes_no' && onCurationAnswer && (
          <div className="flex gap-2 pl-6">
            <button
              onClick={() => onCurationAnswer(capture.id, 'yes')}
              className="px-3 py-1.5 text-xs font-medium rounded-full bg-violet-600 text-white hover:bg-violet-700 dark:bg-violet-700 dark:hover:bg-violet-600 transition-colors"
            >
              Yes
            </button>
            <button
              onClick={() => onCurationAnswer(capture.id, 'no')}
              className="px-3 py-1.5 text-xs font-medium rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            >
              No
            </button>
          </div>
        )}

        {interactionType === 'choice' && choices && onCurationAnswer && (
          <div className="flex flex-wrap gap-2 pl-6">
            {choices.map((choice) => (
              <button
                key={choice}
                onClick={() => onCurationAnswer(capture.id, choice)}
                className="px-3 py-1.5 text-xs font-medium rounded-full bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300 hover:bg-violet-200 dark:hover:bg-violet-800/60 transition-colors"
              >
                {choice}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-mono text-violet-400 dark:text-violet-500">
              calliad · curation {turnCount > 0 ? `· ${turnCount}/${maxTurns}` : ''}
            </span>
            {onReply && interactionType === 'open' && (
              <button
                onClick={() => onReply(capture.id, tripLabel ?? 'curation')}
                className="px-2.5 py-1 text-xs font-medium rounded-full bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-400 hover:bg-violet-200 dark:hover:bg-violet-800/60 transition-colors"
              >
                Reply
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            {onCurationDismiss && (
              <>
                <button
                  onClick={() => onCurationDismiss(capture.id, 'skip')}
                  className="text-[11px] font-mono text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                >
                  Skip
                </button>
                <button
                  onClick={() => onCurationDismiss(capture.id, 'remind')}
                  className="text-[11px] font-mono text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                >
                  Later
                </button>
              </>
            )}
            <span className="text-[11px] font-mono text-zinc-400 dark:text-zinc-500">{timeAgo(capture.created_at)}</span>
          </div>
        </div>
      </div>
    );
  }

  if (capture.source === 'action' && (capture.metadata as Record<string, unknown> | null)?.action_type === 'add_to_calendar') {
    const meta = (capture.metadata ?? {}) as Record<string, unknown>;
    const calTitle = meta.title as string;
    const calStart = meta.start_at as string;
    const calEnd = meta.end_at as string | null;
    const calAllDay = meta.all_day as boolean | undefined;
    const calLocation = meta.location as string | null;
    const calCalendars = (meta.calendars as { url: string; displayName: string }[] | undefined) ?? [];
    const defaultUrl = meta.selected_calendar_url as string | null;

    return (
      <CalendarActionCard
        capture={capture}
        title={calTitle}
        startAt={calStart}
        endAt={calEnd}
        allDay={calAllDay}
        location={calLocation}
        calendars={calCalendars}
        defaultCalendarUrl={defaultUrl}
        onConfirm={onCalendarConfirm}
        onDismiss={onArchive}
      />
    );
  }

  if (capture.source === 'action' && resolvedState) {
    const meta = (capture.metadata ?? {}) as Record<string, unknown>;
    const tripLabel = meta.trip_label as string | undefined;
    const cardLabel = tripLabel ? formatTripLabel(tripLabel) : (capture.summary ?? capture.transcript ?? 'action');
    return (
      <div className="bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-800/30 rounded-xl overflow-hidden">
        <div className="px-4 pt-3 pb-2 flex items-start gap-2">
          <span className="text-green-500 mt-0.5 shrink-0">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
          <div className="flex-1 min-w-0 space-y-2">
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 leading-relaxed line-clamp-2">{cardLabel}</p>
            <div className="flex justify-end">
              <div className="max-w-[80%] bg-zinc-100 dark:bg-zinc-800/80 rounded-xl px-3 py-1.5">
                <p className="text-xs text-zinc-700 dark:text-zinc-300">{resolvedState.replyText}</p>
              </div>
            </div>
            <div className="flex justify-start">
              <div className="max-w-[80%] bg-amber-100 dark:bg-amber-900/40 rounded-xl px-3 py-1.5">
                <p className="text-xs text-zinc-700 dark:text-zinc-300">{resolvedState.ackText}</p>
              </div>
            </div>
          </div>
        </div>
        <div className="px-4 py-2.5 border-t border-amber-100 dark:border-amber-900/30 flex items-center justify-between">
          <span className="text-[11px] font-mono text-green-500 dark:text-green-600">resolved</span>
          <button
            onClick={() => onResolvedArchive?.(capture.id)}
            className="px-3 py-1 text-xs font-medium rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-800/60 transition-colors"
          >
            Archive
          </button>
        </div>
      </div>
    );
  }

  if (capture.source === 'action') {
    const meta = (capture.metadata ?? {}) as Record<string, unknown>;
    const tripLabel = meta.trip_label as string | undefined;
    const isTripProposal = meta.action_type === 'trip_proposal';
    const destination = meta.destination as string | undefined;
    const tripStart = meta.trip_start as string | undefined;
    const tripEnd = meta.trip_end as string | undefined;
    const missingElements = (meta.missing_elements as string[] | undefined) ?? [];
    const questions = (meta.questions as string[] | undefined) ?? [];
    const travelers = (meta.travelers as string[] | undefined) ?? [];

    const formatDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    return (
      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-xl overflow-hidden">
        {/* Header */}
        <div className="px-4 pt-3 pb-2 flex items-start gap-2">
          <span className="text-amber-500 mt-0.5 shrink-0">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </span>
          <div className="flex-1 min-w-0">
            {isTripProposal && destination ? (
              <>
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{destination}</p>
                {tripStart && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    {formatDate(tripStart)}{tripEnd && tripEnd !== tripStart ? ` – ${formatDate(tripEnd)}` : ''}
                    {travelers.length > 0 && ` · ${travelers.join(', ')}`}
                  </p>
                )}
              </>
            ) : (
              <>
                {tripLabel && <p className="text-[11px] font-mono text-amber-600 dark:text-amber-500 uppercase tracking-wide mb-1">{tripLabel}</p>}
                <p className="text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed">{capture.summary ?? capture.transcript}</p>
              </>
            )}
          </div>
        </div>

        {/* Trip proposal structured body */}
        {isTripProposal && (
          <div className="px-4 pb-3 space-y-2.5">
            {missingElements.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {missingElements.map((el) => (
                  <span key={el} className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300">
                    {el.replace('_', ' ')} not booked
                  </span>
                ))}
              </div>
            )}
            {questions.length > 0 && (
              <ul className="space-y-1">
                {questions.map((q, i) => (
                  <li key={i} className="text-sm text-zinc-700 dark:text-zinc-300 leading-snug flex gap-2">
                    <span className="text-amber-400 shrink-0 font-medium">{i + 1}.</span>
                    <span>{q}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-amber-100 dark:border-amber-900/40 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-mono text-amber-500 dark:text-amber-600">calliad action</span>
            {onReply && (
              <button
                onClick={() => onReply(capture.id, tripLabel ? formatTripLabel(tripLabel) : (capture.summary ?? 'action'))}
                className="px-2.5 py-1 text-xs font-medium rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-800/60 transition-colors cursor-pointer"
              >
                Reply
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-zinc-400 dark:text-zinc-500">{timeAgo(capture.created_at)}</span>
            <button
              onClick={() => onArchive(capture.id)}
              className="text-zinc-300 hover:text-zinc-500 dark:text-zinc-700 dark:hover:text-zinc-400 transition-colors"
              aria-label="Dismiss"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </button>
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-zinc-300 hover:text-red-400 dark:text-zinc-700 dark:hover:text-red-500 transition-colors"
                aria-label="Delete"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                </svg>
              </button>
            ) : (
              <div className="flex gap-2">
                <button onClick={() => setConfirmDelete(false)} className="text-[11px] text-zinc-400">Cancel</button>
                <button onClick={() => onDelete(capture.id)} className="text-[11px] font-medium text-red-500">Delete</button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (capture.source === 'assistant') {
    return (
      <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/60 rounded-xl p-4 space-y-2">
        <p className="text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed">{capture.transcript}</p>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono text-blue-400 dark:text-blue-500">calliad</span>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-zinc-400 dark:text-zinc-500">{timeAgo(capture.created_at)}</span>
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-zinc-300 hover:text-red-400 dark:text-zinc-700 dark:hover:text-red-500 transition-colors"
                aria-label="Delete"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                </svg>
              </button>
            ) : (
              <div className="flex gap-2">
                <button onClick={() => setConfirmDelete(false)} className="text-[11px] text-zinc-400">Cancel</button>
                <button onClick={() => onDelete(capture.id)} className="text-[11px] font-medium text-red-500">Delete</button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const isVerified = capture.source === 'email' && (capture.metadata as Record<string, unknown> | null | undefined)?.verified === true;

  return (
    <div className={`bg-white dark:bg-zinc-900 border rounded-xl p-4 space-y-2 ${isError ? 'border-red-200 dark:border-red-900/60' : isVerified ? 'border-emerald-200 dark:border-emerald-800/60' : 'border-zinc-200 dark:border-zinc-800'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {isPending ? (
            <div className="space-y-2">
              <div className="h-3.5 bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse w-3/4" />
              <div className="h-3 bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse w-1/2" />
            </div>
          ) : isError ? (
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-red-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <p className="text-sm text-red-600 dark:text-red-400">Transcription failed</p>
            </div>
          ) : capture.summary ? (
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 leading-snug">
              {capture.summary}
            </p>
          ) : (
            <p className="text-sm text-zinc-700 dark:text-zinc-300 line-clamp-3 leading-relaxed">
              {capture.transcript || '(no transcript)'}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0 -mr-1 -mt-1">
          {isError && onRetry && (
            <button
              onClick={() => onRetry(capture.id)}
              className="text-zinc-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors p-1"
              aria-label="Retry transcription"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 .49-4.5" />
              </svg>
            </button>
          )}
          {!isError && onFile && folders && folders.length > 0 && (
            <button
              onClick={() => { setShowProjectPicker((v) => !v); setConfirmDelete(false); }}
              className="text-zinc-400 hover:text-blue-400 dark:hover:text-blue-400 transition-colors p-1"
              aria-label="File to project"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              </svg>
            </button>
          )}
          {!isError && capture.source === 'share' && onSendToAbentfork && (
            <button
              onClick={() => onSendToAbentfork(capture.id)}
              className="text-zinc-400 hover:text-orange-400 dark:hover:text-orange-400 transition-colors p-1"
              aria-label="Send to abentfork"
              title="Send to abentfork.com"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M18 8h1a4 4 0 010 8h-1" /><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z" /><line x1="6" y1="1" x2="6" y2="4" /><line x1="10" y1="1" x2="10" y2="4" /><line x1="14" y1="1" x2="14" y2="4" />
              </svg>
            </button>
          )}
          <button
            onClick={() => { onArchive(capture.id); }}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors p-1"
            aria-label="Archive"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button>
          <button
            onClick={() => { setConfirmDelete(true); setShowProjectPicker(false); }}
            className="text-zinc-400 hover:text-red-400 dark:hover:text-red-500 transition-colors p-1"
            aria-label="Delete"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
            </svg>
          </button>
        </div>
      </div>

      {capture.summary && capture.transcript && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2 leading-relaxed">
          {capture.transcript}
        </p>
      )}

      {showProjectPicker && (folders || trips) && (
        <div className="pt-1 space-y-2">
          {folders && folders.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-mono text-zinc-400 uppercase tracking-wide">Folders</p>
              <div className="flex flex-wrap gap-2">
                {folders.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => { onFile!(capture.id, p.id); setShowProjectPicker(false); }}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-zinc-200 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-500 transition-colors text-xs text-zinc-700 dark:text-zinc-300"
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${colorBg(p.color)}`} />
                    {p.icon} {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {trips && trips.length > 0 && (() => {
            const openTrips = trips.filter((t) => t.status === 'planned' || t.status === 'active');
            const olderTrips = trips.filter((t) => t.status !== 'planned' && t.status !== 'active');
            const visibleTrips = showAllTrips ? trips : openTrips;
            return (
              <div className="space-y-1">
                <p className="text-[10px] font-mono text-zinc-400 uppercase tracking-wide">Trips</p>
                <div className="flex flex-wrap gap-2">
                  {visibleTrips.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => { onFileToTrip?.(capture.id, t.id); setShowProjectPicker(false); }}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-zinc-200 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-500 transition-colors text-xs text-zinc-700 dark:text-zinc-300"
                    >
                      ✈️ {t.title || t.destination || 'Trip'}
                    </button>
                  ))}
                  {!showAllTrips && olderTrips.length > 0 && (
                    <button
                      onClick={() => setShowAllTrips(true)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-full border border-dashed border-zinc-200 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-500 transition-colors text-xs text-zinc-400 dark:text-zinc-500"
                    >
                      +{olderTrips.length} older
                    </button>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {confirmDelete ? (
        <div className="flex items-center justify-between pt-0.5">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">Delete this capture?</span>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors px-2 py-1"
            >
              Cancel
            </button>
            <button
              onClick={() => onDelete(capture.id)}
              className="text-xs font-medium text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 transition-colors px-2 py-1"
            >
              Delete
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap pt-0.5">
          {capture.tags.map((tag) => (
            <span
              key={tag}
              className="text-[11px] font-mono bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 px-2 py-0.5 rounded-full"
            >
              {tag}
            </span>
          ))}
          <div className="ml-auto flex items-center gap-2 text-[11px] text-zinc-400 dark:text-zinc-500 font-mono">
            {capture.location_label && (
              <span className="truncate max-w-[120px]">{capture.location_label}</span>
            )}
            {isVerified && (
              <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-500">
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                verified
              </span>
            )}
            <span>{sourceLabel[capture.source] ?? capture.source}</span>
            <span>{timeAgo(capture.created_at)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function CalendarActionCard({
  capture,
  title,
  startAt,
  endAt,
  allDay,
  location,
  calendars,
  defaultCalendarUrl,
  onConfirm,
  onDismiss,
}: {
  capture: Capture;
  title: string;
  startAt: string;
  endAt: string | null;
  allDay: boolean | undefined;
  location: string | null;
  calendars: { url: string; displayName: string }[];
  defaultCalendarUrl: string | null;
  onConfirm?: (id: string, data: CalendarConfirmData) => void;
  onDismiss: (id: string) => void;
}) {
  const [selectedUrl, setSelectedUrl] = useState(defaultCalendarUrl ?? calendars[0]?.url ?? '');
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);

  const formatDateTime = (iso: string, isAllDay?: boolean) => {
    const d = new Date(iso);
    if (isAllDay) {
      return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }
    return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  const handleConfirm = async () => {
    if (!onConfirm || adding) return;
    setAdding(true);
    await onConfirm(capture.id, {
      title,
      start_at: startAt,
      end_at: endAt,
      all_day: allDay,
      location,
      calendar_url: selectedUrl,
    });
    setAdded(true);
    setAdding(false);
  };

  return (
    <div className="bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800/50 rounded-xl overflow-hidden">
      <div className="px-4 pt-3 pb-2 flex items-start gap-2">
        <span className="text-sky-500 mt-0.5 shrink-0">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            {formatDateTime(startAt, allDay)}
            {endAt && endAt !== startAt && ` – ${formatDateTime(endAt, allDay)}`}
          </p>
          {location && <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">{location}</p>}
        </div>
      </div>

      {/* Calendar picker */}
      {calendars.length > 1 && (
        <div className="px-4 pb-3">
          <select
            value={selectedUrl}
            onChange={(e) => setSelectedUrl(e.target.value)}
            className="w-full text-xs bg-white dark:bg-zinc-900 border border-sky-200 dark:border-sky-800/50 rounded-lg px-2 py-1.5 text-zinc-700 dark:text-zinc-300 outline-none"
          >
            {calendars.map((c) => (
              <option key={c.url} value={c.url}>{c.displayName}</option>
            ))}
          </select>
        </div>
      )}

      <div className="px-4 py-2.5 border-t border-sky-100 dark:border-sky-900/40 flex items-center justify-between">
        <span className="text-[11px] font-mono text-sky-500 dark:text-sky-600">calliad action</span>
        <div className="flex items-center gap-2">
          {added ? (
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Added ✓</span>
          ) : (
            <button
              onClick={handleConfirm}
              disabled={adding || !onConfirm}
              className="px-3 py-1 text-xs font-medium rounded-full bg-sky-500 text-white hover:bg-sky-600 disabled:opacity-50 transition-colors"
            >
              {adding ? 'Adding…' : 'Add to Calendar'}
            </button>
          )}
          <button
            onClick={() => onDismiss(capture.id)}
            className="text-zinc-300 hover:text-zinc-500 dark:text-zinc-700 dark:hover:text-zinc-400 transition-colors"
            aria-label="Dismiss"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
