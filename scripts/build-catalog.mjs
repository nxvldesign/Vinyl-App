#!/usr/bin/env node
/**
 * Builds src/data/catalog.json — a curated crate of Creative Commons albums.
 *
 * Source: Openverse (https://openverse.org) indexes Jamendo's CC music.
 *   - No API key needed (anonymous limit is roughly 20 requests/min, 200/day),
 *     so every response is cached in scripts/.cache and re-runs are free.
 *   - "No derivatives" (ND) licenses are excluded.
 *
 * Each track's 20-second highlight is found from the Openverse waveform
 * (about 1,000 peak samples per track), so no audio has to be downloaded.
 *
 * Usage:  npm run catalog            (edit CRATE below to change the picks)
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findHighlight } from '../src/audio/highlight.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(root, 'scripts', '.cache');
const OUT = join(root, 'src', 'data', 'catalog.json');
const API = 'https://api.openverse.org/v1/audio/';
const LICENSES = 'by,by-sa,by-nc,by-nc-sa,cc0';

/** One album per entry: search phrases (tried in order) plus the record's colour. */
const CRATE = [
  { q: 'nu jazz', genre: 'Nu Jazz', vinyl: '#d9a441' },
  { q: 'deep house', genre: 'Deep House', vinyl: '#3b82f6' },
  { q: ['ambient electronic', 'chillout', 'ambient'], genre: 'Ambient', vinyl: '#a5f3fc' },
  { q: ['lofi hip hop', 'chillhop', 'lofi', 'jazzhop'], genre: 'Lo-fi', vinyl: '#f472b6' },
  { q: ['neo soul', 'soul', 'rnb'], genre: 'Soul', vinyl: '#ef4444' },
  { q: 'synthwave', genre: 'Synthwave', vinyl: '#a855f7' },
  { q: 'downtempo', genre: 'Downtempo', vinyl: '#34d399' },
  { q: 'piano', genre: 'Modern Classical', vinyl: '#111111' },
];

// Albums left out by hand (weak audio or unsuitable artwork).
const EXCLUDE = new Set(['19719']);

const MIN_TRACKS = 3;
const MAX_TRACKS = 6;
const MIN_LEN = 120_000; // ms
const MAX_LEN = 540_000;

let lastCall = 0;
async function get(url) {
  const key = createHash('sha1').update(url).digest('hex');
  const file = join(CACHE, key + '.json');
  if (existsSync(file)) return JSON.parse(await readFile(file, 'utf8'));
  // Pace live calls to stay under the anonymous burst limit.
  const wait = lastCall + 3200 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'vinyl-showcase-catalog/1.0' } });
    if (res.status === 429) {
      const s = Number(res.headers.get('retry-after')) || 30;
      console.warn(`  rate limited, waiting ${s}s`);
      await new Promise((r) => setTimeout(r, s * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const json = await res.json();
    await writeFile(file, JSON.stringify(json));
    return json;
  }
  throw new Error('Gave up after repeated rate limits: ' + url);
}

const albumIdOf = (t) => t.audio_set?.foreign_landing_url?.match(/album\/(\d+)/)?.[1];
const trackIdOf = (t) => new URL(t.url).searchParams.get('trackid');
const usable = (t) =>
  t.source === 'jamendo' && !t.mature && albumIdOf(t) && trackIdOf(t) &&
  t.duration >= MIN_LEN && t.duration <= MAX_LEN;

// Anonymous requests are capped at 20 results per page.
async function search(params, pages = 1) {
  const out = [];
  for (let page = 1; page <= pages; page++) {
    const d = await get(`${API}?${new URLSearchParams({ source: 'jamendo', category: 'music', license: LICENSES, page_size: '20', page: String(page), ...params })}`);
    out.push(...d.results.filter(usable));
    if (page >= (d.page_count ?? 1)) break;
  }
  return out;
}

async function main() {
  await mkdir(CACHE, { recursive: true });
  await mkdir(dirname(OUT), { recursive: true });
  const usedAlbums = new Set();
  const albums = [];

  for (const pick of CRATE) {
    console.log(`\n▸ ${pick.genre}`);
    let chosen = null;
    for (const q of [pick.q].flat()) {
    if (chosen) break;
    const hits = await search({ q }, 2);
    // Group hits by album and try the best-represented albums first.
    const groups = new Map();
    for (const t of hits) {
      const id = albumIdOf(t);
      if (usedAlbums.has(id) || EXCLUDE.has(id)) continue;
      groups.set(id, [...(groups.get(id) ?? []), t]);
    }
    const ranked = [...groups.values()].sort((a, b) => b.length - a.length);

    for (const group of ranked.slice(0, 3)) {
      const albumId = albumIdOf(group[0]);
      // Fill out the album with the artist's other tracks from the same record.
      const byArtist = await search({ creator: group[0].creator }, 2);
      const tracks = new Map();
      for (const t of [...group, ...byArtist]) if (albumIdOf(t) === albumId) tracks.set(trackIdOf(t), t);
      if (tracks.size >= MIN_TRACKS) { chosen = [...tracks.values()]; break; }
      console.log(`  skip "${group[0].audio_set.title}" (${tracks.size} tracks)`);
    }
    }
    if (!chosen) { console.log('  no album with enough tracks — skipped'); continue; }

    // Album order: use track numbers in the titles when every track has one.
    const num = (t) => Number(t.title.match(/^\s*(\d{1,2})\b/)?.[1] ?? t.title.match(/\btrack\s*(\d{1,2})\b/i)?.[1] ?? NaN);
    const numbered = chosen.every((t) => !Number.isNaN(num(t)));
    chosen.sort((a, b) => (numbered ? num(a) - num(b) : 0) || Number(trackIdOf(a)) - Number(trackIdOf(b)));
    chosen = chosen.slice(0, MAX_TRACKS);
    const first = chosen[0];
    const albumId = albumIdOf(first);
    usedAlbums.add(albumId);

    const tracks = [];
    for (const t of chosen) {
      const wf = await get(`${API}${t.id}/waveform/`);
      const seconds = t.duration / 1000;
      const start = findHighlight(wf.points, seconds);
      tracks.push({
        id: `jm-${trackIdOf(t)}`,
        title: cleanTitle(t.title),
        duration: Math.round(seconds),
        highlight: Math.round(start * 10) / 10,
        src: `/stream/jamendo/?trackid=${trackIdOf(t)}&format=mp32`,
        page: t.foreign_landing_url,
        license: { code: t.license, version: t.license_version, url: t.license_url },
        waveform: downsample(wf.points, 96),
      });
      console.log(`  ♪ ${t.title} — highlight @ ${fmt(start)}`);
    }

    albums.push({
      id: `jm-album-${albumId}`,
      title: first.audio_set.title,
      artist: first.creator,
      artistUrl: first.creator_url,
      page: first.audio_set.foreign_landing_url,
      genre: pick.genre,
      tags: [...new Set(chosen.flatMap((t) => t.tags.map((x) => x.name)))].slice(0, 6),
      cover: `https://usercontent.jamendo.com?type=album&id=${albumId}&width=600`,
      vinyl: pick.vinyl,
      source: 'Jamendo',
      tracks,
    });
    console.log(`  ✓ "${first.audio_set.title}" by ${first.creator} (${tracks.length} tracks)`);
  }

  await writeFile(OUT, JSON.stringify({ generated: new Date().toISOString(), albums }, null, 2) + '\n');
  console.log(`\nWrote ${albums.length} albums to ${OUT}`);
}

function downsample(points, n) {
  const out = [];
  const step = points.length / n;
  for (let i = 0; i < n; i++) {
    let max = 0;
    for (let j = Math.floor(i * step); j < Math.floor((i + 1) * step); j++) max = Math.max(max, points[j]);
    out.push(Math.round(max * 100) / 100);
  }
  return out;
}
const cleanTitle = (t) => t.replace(/^\s*\d{1,2}\s*[-.)]?\s+/, '').trim();
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

main().catch((e) => { console.error(e); process.exit(1); });
