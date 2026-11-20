import { useEffect, useRef, useState } from 'react';
import { SNIPPET_SECONDS } from '../audio/highlight.js';
import { selectedAlbum, useStore } from '../state/store';
import type { SpatialMode } from '../types';
import { AutoNext, Eject, Next, Pause, Play, Prev, Sliders } from './icons';
import { time, useProgressVar } from './shared';

const MODES: { id: SpatialMode; label: string; hint: string }[] = [
  { id: 'room', label: 'Spatial', hint: 'Sound comes from two speakers either side of the deck. Turn the view and it moves with you.' },
  { id: 'stereo', label: 'Stereo', hint: 'Plain stereo, no 3D processing.' },
];

export function Dock() {
  const s = useStore();
  const album = selectedAlbum(s);
  const track = album?.tracks[s.trackIndex];
  const [soundOpen, setSoundOpen] = useState(false);
  const caption = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useProgressVar(caption, track?.id);

  useEffect(() => {
    if (!soundOpen) return;
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setSoundOpen(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setSoundOpen(false); } };
    addEventListener('pointerdown', onDown);
    addEventListener('keydown', onKey, true);
    return () => { removeEventListener('pointerdown', onDown); removeEventListener('keydown', onKey, true); };
  }, [soundOpen]);

  const status = !album ? '' : !s.ready ? 'Cueing' : s.buffering ? 'Buffering' : s.playing ? 'Now playing' : 'Paused';

  return (
    <div className="dock-wrap" ref={root}>
      <div className="caption" ref={caption}>
        {track ? (
          <>
            <span className={`caption-tag mono ${s.playing && s.ready ? 'live' : ''}`}>{status}</span>
            <span className="caption-text">
              {track.title} <em>{time(track.highlight)}–{time(Math.min(track.duration, track.highlight + SNIPPET_SECONDS))}</em>
            </span>
            <i className="caption-bar" aria-hidden />
          </>
        ) : (
          <>
            <span className="caption-tag mono">Deck empty</span>
            <span className="caption-text">Each track plays its best 20 seconds.</span>
          </>
        )}
      </div>

      {soundOpen && (
        <div className="popover surface sound-pop" role="dialog" aria-label="Sound settings">
          <p className="pop-head mono"><span>Sound</span><span>Headphones on</span></p>
          <div className="seg" role="radiogroup" aria-label="Output">
            {MODES.map((m) => (
              <button key={m.id} role="radio" aria-checked={s.spatial === m.id} title={m.hint} className={s.spatial === m.id ? 'on' : ''} onClick={() => s.setSpatial(m.id)}>
                {m.label}
              </button>
            ))}
          </div>
          <Slider label="Volume" value={s.volume} onChange={s.setVolume} />
          <Slider label="Surface noise" value={s.noise} onChange={s.setNoise} hint="Hiss, ticks and pops from the groove" />
          <Slider label="Room" value={s.room} onChange={s.setRoom} hint="How much of the listening room you hear" />
        </div>
      )}

      <nav className="dock surface" aria-label="Player">
        <div className="group">
          <button className="tool icon" onClick={s.prev} disabled={!album} aria-label="Previous track"><Prev width={16} height={16} /></button>
          <button className={`tool icon play ${s.playing ? 'on' : ''}`} onClick={s.toggle} disabled={!album} aria-label={s.playing ? 'Pause' : 'Play'}>
            {s.playing ? <Pause width={16} height={16} /> : <Play width={16} height={16} />}
          </button>
          <button className="tool icon" onClick={s.next} disabled={!album} aria-label="Next track"><Next width={16} height={16} /></button>
        </div>
        <span className="sep" />
        <button className={`tool ${s.reel ? 'on' : ''}`} onClick={() => s.setReel(!s.reel)} aria-pressed={s.reel} title="Auto next: when a highlight ends, play the next track's">
          <AutoNext width={16} height={16} /> <span className="hide-sm">Auto next</span>
        </button>
        <button className={`tool ${soundOpen ? 'on' : ''}`} onClick={() => setSoundOpen((o) => !o)} aria-expanded={soundOpen} aria-label="Sound settings">
          <Sliders width={16} height={16} /> <span className="hide-sm">Sound</span>
        </button>
        <span className="sep" />
        <button className="tool icon" onClick={s.eject} disabled={!album} aria-label="Put the record away" title="Put the record away (Esc)">
          <Eject width={15} height={15} />
        </button>
      </nav>
    </div>
  );
}

function Slider({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <label className="slider" title={hint}>
      <span className="slider-head mono"><span>{label}</span><span>{Math.round(value * 100)}</span></span>
      <input type="range" min={0} max={1} step={0.01} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ '--v': value } as React.CSSProperties} aria-label={label} />
    </label>
  );
}
