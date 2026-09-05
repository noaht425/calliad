#!/usr/bin/env node
// One-off: turn a Spotify "Account Data" GDPR export into a compact music-taste
// summary for content/profile.md. Re-run when Noah re-exports.
//   node scripts/spotify-profile.mjs "~/Downloads/Spotify Account Data"
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dir = (process.argv[2] || '~/Downloads/Spotify Account Data').replace(/^~/, os.homedir());
const rd = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const rdMaybe = (f) => { try { return rd(f); } catch { return null; } };

// ── streaming history (music) ────────────────────────────────────────────
const music = [];
for (let i = 0; i < 20; i++) {
  const j = rdMaybe(`StreamingHistory_music_${i}.json`);
  if (!j) break;
  music.push(...j);
}
const STREAM_MS = 30000; // Spotify's own "counts as a play" threshold
const real = music.filter((p) => p.msPlayed >= STREAM_MS);
const times = music.map((p) => p.endTime).sort();

const byCount = new Map();
const byMs = new Map();
const firstSeen = new Map();
const lastSeen = new Map();
for (const p of real) {
  byCount.set(p.artistName, (byCount.get(p.artistName) || 0) + 1);
  byMs.set(p.artistName, (byMs.get(p.artistName) || 0) + p.msPlayed);
  if (!firstSeen.has(p.artistName)) firstSeen.set(p.artistName, p.endTime);
  lastSeen.set(p.artistName, p.endTime);
}
const trackCount = new Map();
for (const p of real) {
  const k = `${p.trackName} — ${p.artistName}`;
  trackCount.set(k, (trackCount.get(k) || 0) + 1);
}

const hrs = (ms) => Math.round(ms / 3600000);
const topN = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

// monthly volume + new-artist trajectory
const monthly = new Map();
for (const p of real) {
  const mo = p.endTime.slice(0, 7);
  monthly.set(mo, (monthly.get(mo) || 0) + p.msPlayed);
}
// time of day
const hourBucket = { morning: 0, afternoon: 0, evening: 0, night: 0 };
for (const p of real) {
  const h = parseInt(p.endTime.slice(11, 13), 10);
  if (h >= 5 && h < 12) hourBucket.morning += p.msPlayed;
  else if (h >= 12 && h < 17) hourBucket.afternoon += p.msPlayed;
  else if (h >= 17 && h < 22) hourBucket.evening += p.msPlayed;
  else hourBucket.night += p.msPlayed;
}
// artists whose listening is concentrated in the last 4 months (taste shift)
const cutoff = times[Math.floor(times.length * 0.75)]?.slice(0, 10);
const recentShare = new Map();
for (const p of real) {
  const rec = p.endTime.slice(0, 10) >= cutoff ? p.msPlayed : 0;
  recentShare.set(p.artistName, (recentShare.get(p.artistName) || [0, 0]));
  const cur = recentShare.get(p.artistName);
  cur[0] += rec; cur[1] += p.msPlayed;
}
const rising = [...recentShare.entries()]
  .filter(([, [, total]]) => total > 20 * 60000)      // >20 min total
  .filter(([, [rec, total]]) => rec / total > 0.7)     // >70% of it recent
  .sort((a, b) => b[1][0] - a[1][0])
  .slice(0, 12);

// ── library (explicit keeps) ────────────────────────────────────────────
const lib = rdMaybe('YourLibrary.json') || {};
const libArtists = (lib.artists || []).map((a) => a.name);
const libAlbums = (lib.albums || []).map((a) => `${a.album} — ${a.artist}`);
const libTracks = (lib.tracks || []).map((t) => `${t.track} — ${t.artist}`);

// ── podcasts ────────────────────────────────────────────────────────────
const pod = rdMaybe('StreamingHistory_podcast_0.json') || [];
const podMs = new Map();
for (const p of pod) podMs.set(p.podcastName || p.showName, (podMs.get(p.podcastName || p.showName) || 0) + p.msPlayed);

// ── taste profile prose ─────────────────────────────────────────────────
const taste = (rdMaybe('TasteProfile.json') || {}).tasteProfile || {};

// ── output ──────────────────────────────────────────────────────────────
const out = [];
out.push(`# Spotify export summary`);
out.push(`Window: ${times[0]} → ${times.at(-1)}  |  ${real.length} plays (>30s), ${hrs(real.reduce((s, p) => s + p.msPlayed, 0))} h`);
out.push('');
out.push(`## Top artists by listening time`);
for (const [a, ms] of topN(byMs, 25)) out.push(`- ${a} — ${hrs(ms)} h, ${byCount.get(a)} plays  (${firstSeen.get(a).slice(0,7)}–${lastSeen.get(a).slice(0,7)})`);
out.push('');
out.push(`## Top tracks by play count`);
for (const [t, c] of topN(trackCount, 25)) out.push(`- ${t} — ${c}×`);
out.push('');
out.push(`## Monthly listening (hours)`);
for (const [mo, ms] of [...monthly.entries()].sort()) out.push(`- ${mo}: ${hrs(ms)}`);
out.push('');
out.push(`## Time of day (hours)`);
for (const [k, ms] of Object.entries(hourBucket)) out.push(`- ${k}: ${hrs(ms)}`);
out.push('');
out.push(`## Rising / recent-heavy artists (>70% of listening in the last quarter)`);
for (const [a, [rec]] of rising) out.push(`- ${a} — ${Math.round(rec / 60000)} min recent`);
out.push('');
out.push(`## Saved library`);
out.push(`Artists (${libArtists.length}): ${libArtists.join(', ')}`);
out.push('');
out.push(`Albums (${libAlbums.length}):`); libAlbums.forEach((x) => out.push(`  - ${x}`));
out.push('');
out.push(`Tracks (${libTracks.length}):`); libTracks.forEach((x) => out.push(`  - ${x}`));
out.push('');
out.push(`## Podcasts by listening time`);
for (const [s, ms] of topN(podMs, 10)) out.push(`- ${s} — ${hrs(ms)} h`);
out.push('');
out.push(`## Spotify's own taste read`);
out.push(`musicalIdentity: ${taste.musicalIdentity || ''}`);
out.push('');
out.push(`podcastTaste: ${taste.podcastTaste || ''}`);
out.push('');
out.push(`contentRhythms: ${taste.contentRhythms || ''}`);

console.log(out.join('\n'));
