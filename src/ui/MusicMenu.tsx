import { useEffect, useRef, useState } from 'react';
import { engine } from '../audio/engine';
import { albumFromFiles } from '../audio/local';
import { selectedAlbum, useStore } from '../state/store';
import type { Album } from '../types';
import { shortTitle, TrackRow } from './shared';

/**
 * Top right: the music list as a dropdown (what's on the deck and its queue,
 * then the whole crate), with a small "up next" nudge beside it.
 */
export function MusicMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const album = useStore(selectedAlbum);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    addEventListener('pointerdown', onDown);
    addEventListener('keydown', onKey, true);
    return () => { removeEventListener('pointerdown', onDown); removeEventListener('keydown', onKey, true); };
  }, [open]);

  return (
    <div className="music" ref={root}>
      <Nudge onClick={() => setOpen(true)} />
      <button className={`music-trigger ${open ? 'on' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog">
        <span className="mini-disc" style={{ '--vinyl': album?.vinyl ?? '#6e6b62' } as React.CSSProperties} aria-hidden>
          {album && <img src={album.cover} alt="" crossOrigin="anonymous" />}
        </span>
        <span className="music-trigger-label">{album ? shortTitle(album.title, 22) : 'Music'}</span>
        <svg className="chev" width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && <Panel onPick={() => setOpen(false)} />}
    </div>
  );
}

/** "Up next" while a record plays; a gentle pointer to the crate before. */
function Nudge({ onClick }: { onClick: () => void }) {
  const s = useStore();
  const album = selectedAlbum(s);
  const bar = useRef<HTMLButtonElement>(null);
  const [late, setLate] = useState(false);

  // Brighten the nudge in the last few seconds of a highlight.
  useEffect(() => {
    const id = setInterval(() => setLate(engine.progress > 0.78 && engine.playing), 250);
    return () => clearInterval(id);
  }, []);

  if (!album) {
    return (
      <button className="nudge" onClick={onClick} ref={bar}>
        <span className="nudge-tag mono">Start</span> Pick a record
      </button>
    );
  }
  const next = album.tracks[s.trackIndex + 1];
  if (!next) return <span className="nudge quiet mono">Last track</span>;
  return (
    <button className={`nudge ${late && s.reel ? 'soon' : ''}`} onClick={onClick} title={`Up next: ${next.title}`}>
      <span className="nudge-tag mono">{s.reel ? 'Up next' : 'Next'}</span> {shortTitle(next.title, 24)}
    </button>
  );
}

function Panel({ onPick }: { onPick: () => void }) {
  const s = useStore();
  const album = selectedAlbum(s);

  return (
    <div className="music-panel surface" role="dialog" aria-label="Music">
      {album && (
        <section>
          <p className="pop-head mono"><span>Queue · {album.tracks.length} highlights</span><span>{s.trackIndex + 1}/{album.tracks.length}</span></p>
          <ol className="tracks">
            {album.tracks.map((t, i) => (
              <TrackRow
                key={t.id}
                track={t}
                index={i}
                active={i === s.trackIndex}
                playing={i === s.trackIndex && s.playing}
                tag={i === s.trackIndex + 1 ? 'Up next' : undefined}
                onPlay={() => s.playTrack(i)}
              />
            ))}
          </ol>
        </section>
      )}
      <section>
        <p className="pop-head mono"><span>Crate</span><span>{s.albums.length} records</span></p>
        <ul className="crate-list">
          {s.albums.map((a) => (
            <CrateRow key={a.id} album={a} on={a.id === s.selectedId} onClick={() => { s.select(a.id); onPick(); }} />
          ))}
          <AddRow onDone={onPick} />
        </ul>
      </section>
    </div>
  );
}

function CrateRow({ album, on, onClick }: { album: Album; on: boolean; onClick: () => void }) {
  return (
    <li>
      <button className={`crate-row ${on ? 'on' : ''}`} onClick={onClick} aria-pressed={on} style={{ '--vinyl': album.vinyl } as React.CSSProperties}>
        <span className="crate-art">
          <img src={album.cover} alt="" crossOrigin="anonymous" loading="lazy" />
        </span>
        <span className="crate-text">
          <span className="crate-title">{shortTitle(album.title, 34)}</span>
          <span className="crate-meta">{album.artist} · {album.genre}</span>
        </span>
        {on && <span className="crate-on mono">On deck</span>}
      </button>
    </li>
  );
}

function AddRow({ onDone }: { onDone: () => void }) {
  const addAlbum = useStore((s) => s.addAlbum);
  const select = useStore((s) => s.select);
  const notify = useStore((s) => s.notify);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const album = await albumFromFiles(files);
      addAlbum(album);
      select(album.id);
      onDone();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <li>
      <label
        className={`crate-row add ${drag ? 'drag' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); void load(e.dataTransfer.files); }}
      >
        <input ref={input} type="file" accept="audio/*" multiple hidden onChange={(e) => void load(e.target.files)} />
        <span className="crate-art add-art" aria-hidden>{busy ? <i className="spinner" /> : '+'}</span>
        <span className="crate-text">
          <span className="crate-title">{busy ? 'Finding highlights…' : 'Your own files'}</span>
          <span className="crate-meta">Drop audio here. It stays on your device.</span>
        </span>
      </label>
    </li>
  );
}
