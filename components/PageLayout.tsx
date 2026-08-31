'use client';
import React from 'react';

/* ─── PageShell ──────────────────────────────────────────────────────────── */
/* 100dvh container, overflow:hidden — body element owns all scrolling */
export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex flex-col bg-paper"
      style={{ height: '100dvh', overflow: 'hidden', position: 'relative' }}
    >
      {children}
    </div>
  );
}

/* ─── PageHeader ─────────────────────────────────────────────────────────── */
/* Tab-level header: no back button. Padding 60/22/14 per design spec. */
export function PageHeader({
  title,
  count,
  actions,
}: {
  title: string;
  count?: string | number;
  actions?: React.ReactNode;
}) {
  return (
    <header style={{ padding: 'calc(env(safe-area-inset-top, 44px) + 16px) 22px 14px', background: 'var(--header-bg)', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <h1
          style={{
            fontFamily: 'var(--display-font)',
            fontSize: 20,
            fontWeight: 600,
            lineHeight: 1.1,
            color: 'var(--header-text)',
            letterSpacing: '-0.01em',
          }}
        >
          {title}
        </h1>
        {(count !== undefined || actions) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, paddingBottom: 2 }}>
            {count !== undefined && (
              <span style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 11, color: 'var(--value-quiet)' }}>
                {count}
              </span>
            )}
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}

/* ─── SubPageHeader ──────────────────────────────────────────────────────── */
/* Sub-page header: includes a 36×36 back button, optional right actions. */
export function SubPageHeader({
  title,
  onBack,
  actions,
}: {
  title: string;
  onBack?: () => void;
  actions?: React.ReactNode;
}) {
  return (
    <header
      style={{
        padding: 'calc(env(safe-area-inset-top, 44px) + 16px) 22px 14px',
        background: 'var(--header-bg)',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'flex-end',
        gap: 12,
      }}
    >
      {onBack && (
        <IconButton onClick={onBack} label="Back">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </IconButton>
      )}
      <h1
        style={{
          flex: 1,
          fontFamily: 'var(--display-font)',
          fontSize: 20,
          fontWeight: 600,
          lineHeight: 1.1,
          color: 'var(--header-text)',
          letterSpacing: '-0.01em',
        }}
      >
        {title}
      </h1>
      {actions && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, paddingBottom: 2 }}>
          {actions}
        </div>
      )}
    </header>
  );
}

/* ─── PageBody ───────────────────────────────────────────────────────────── */
/* Scrollable body area. flex:1 min-h:0 so it fills space between header and nav. */
export function PageBody({
  children,
  className,
  padBottom = 'calc(86px + env(safe-area-inset-bottom, 0px))',
}: {
  children: React.ReactNode;
  className?: string;
  padBottom?: string;
}) {
  return (
    <main
      className={className}
      style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: padBottom }}
    >
      {children}
    </main>
  );
}

/* ─── PageSearch ─────────────────────────────────────────────────────────── */
/* Pinned search strip between the header and the body. */
export function PageSearch({
  value,
  onChange,
  onSubmit,
  placeholder = 'Search…',
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div
      style={{
        padding: '0 22px 12px',
        background: 'var(--header-bg)',
        flexShrink: 0,
      }}
    >
      <div style={{ position: 'relative' }}>
        <svg
          style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
          width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
        >
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
        <input
          type="search"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && onSubmit) onSubmit(value.trim()); }}
          onFocus={() => { if (value.trim() && onSubmit) onSubmit(value.trim()); }}
          style={{
            width: '100%',
            paddingLeft: 36,
            paddingRight: 12,
            paddingTop: 9,
            paddingBottom: 9,
            borderRadius: 12,
            background: 'var(--surface-quiet)',
            border: '1px solid transparent',
            fontSize: 14,
            color: 'var(--text)',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>
    </div>
  );
}

/* ─── IconButton ─────────────────────────────────────────────────────────── */
/* 36×36 round action button used in page headers. */
export function IconButton({
  children,
  onClick,
  label,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      style={{
        width: 36,
        height: 36,
        borderRadius: 18,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--neutral-icon)',
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

/* ─── SectionLabel ───────────────────────────────────────────────────────── */
/* Mono 10px uppercase section divider label per design spec. */
export function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={className}
      style={{
        fontFamily: 'var(--font-geist-mono)',
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: '0.16em',
        color: 'var(--text-quiet)',
      }}
    >
      {children}
    </p>
  );
}
