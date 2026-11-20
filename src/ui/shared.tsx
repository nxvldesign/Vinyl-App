import { useEffect, useRef } from 'react';
import { engine } from '../audio/engine';
import { SNIPPET_SECONDS } from '../audio/highlight.js';
import type { Track } from '../types';

export const time = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Catalog titles can be long ("BACH Trio Sonata No.2 BWV 526 / Piano - …"). */
export const shortTitle = (t: string, max = 26) => {
  const s = t.replace(/^MWep\d+\s+/i, '').split(/\s[/–-]\s/)[0].trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
};

/** Writes the snippet progress (0..1) into a CSS variable every frame, without re-rendering. */
export function useProgressVar(ref: React.RefObject<HTMLElement | null>, trackId: string | undefined) {
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      ref.current?.style.setProperty('--p', trackId && engine.current?.id === trackId ? engine.progress.toFixed(4) : '0');
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [ref, trackId]);
}

export function TrackRow({ track, index, active, playing, tag, onPlay }: { track: Track; index: number; active: boolean; playing: boolean; tag?: string; onPlay: () => void }) {
  const ref = useRef<HTMLLIElement>(null);
  useProgressVar(ref, active ? track.id : undefined);
  const from = track.highlight;
  const to = Math.min(track.duration, from + SNIPPET_SECONDS);
  const w = track.waveform ?? [];

  return (
    <li ref={ref} className={`track ${active ? 'active' : ''}`}>
      <button onClick={onPlay} aria-current={active ? 'true' : undefined}>
        <span className="track-no mono">{playing ? <span className="bars" aria-label="Playing"><i /><i /><i /></span> : String(index + 1).padStart(2, '0')}</span>
        <span className="track-title">{track.title}</span>
        <span className="track-time mono">{tag ?? `${time(from)}–${time(to)}`}</span>
        <span className="wave" aria-hidden>
          {w.map((v, j) => <i key={j} style={{ height: `${14 + v * 86}%` }} />)}
          <b style={{ left: `${(from / track.duration) * 100}%`, width: `${((to - from) / track.duration) * 100}%` }}><u /></b>
        </span>
      </button>
    </li>
  );
}
