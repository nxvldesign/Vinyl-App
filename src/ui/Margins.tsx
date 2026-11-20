import { selectedAlbum, useStore } from '../state/store';
import type { Album, Track } from '../types';
import { SoundLabel } from './SoundLabel';

const LICENSES: Record<string, string> = { by: 'CC BY', 'by-sa': 'CC BY-SA', 'by-nc': 'CC BY-NC', 'by-nc-sa': 'CC BY-NC-SA', cc0: 'CC0' };

/** The wordmark. It sits behind the 3D canvas so the deck can overlap it. */
export function Wordmark() {
  return <p className="wordmark" aria-hidden>Vinyl Studio</p>;
}

/** Under the wordmark: what's on the deck. */
export function OnDeck() {
  const album = useStore(selectedAlbum);
  if (!album) {
    return (
      <div className="ondeck">
        <p className="label mono">The collection</p>
        <p className="ondeck-lede">Independent records, cut down to the part you'd rewind.</p>
      </div>
    );
  }
  return (
    <div className="ondeck" key={album.id}>
      <p className="label mono">On the deck · {album.genre}</p>
      <h1 className="ondeck-title">{album.title}</h1>
      {album.artistUrl ? (
        <a className="ondeck-artist" href={album.artistUrl} target="_blank" rel="noreferrer">{album.artist}</a>
      ) : (
        <span className="ondeck-artist">{album.artist}</span>
      )}
    </div>
  );
}

/** Bottom right: the studio's sound label. */
export function Label() {
  return (
    <div className="label-corner">
      <SoundLabel />
    </div>
  );
}

/** Bottom left: who made what's playing, and under which license. */
export function Credit() {
  const album = useStore(selectedAlbum);
  const track = useStore((s) => selectedAlbum(s)?.tracks[s.trackIndex]);
  if (!album || !track) return <p className="credit hint mono">Space play · ← → tracks · drag to look around</p>;
  return <p className="credit mono"><CreditText album={album} track={track} /></p>;
}

function CreditText({ album, track }: { album: Album; track: Track }) {
  if (album.local) return <>Playing from your device. Nothing is uploaded.</>;
  const lic = track.license;
  return (
    <>
      <a href={track.page} target="_blank" rel="noreferrer">“{track.title}”</a> by {album.artist}
      {lic && <> · <a href={lic.url} target="_blank" rel="noreferrer">{LICENSES[lic.code] ?? lic.code.toUpperCase()} {lic.version}</a></>}
      {' '}· <a href={album.page} target="_blank" rel="noreferrer">{album.source}</a>
    </>
  );
}
