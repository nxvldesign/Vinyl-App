import { create } from 'zustand';
import { engine } from '../audio/engine';
import catalog from '../data/catalog.json';
import type { Album, SpatialMode, Theme } from '../types';

interface State {
  albums: Album[];
  /** The album the listener picked. */
  selectedId: string | null;
  /** True once the needle is down on the selected album's record. */
  ready: boolean;
  trackIndex: number;
  /** The listener wants sound (stays true between snippets in reel mode). */
  playing: boolean;
  buffering: boolean;
  /** Play every track's highlight back to back. */
  reel: boolean;
  spatial: SpatialMode;
  volume: number;
  /** Surface noise, 0 (pristine) to 1 (well loved). */
  noise: number;
  /** How much of the room you hear (reverb), 0 to 1. */
  room: number;
  theme: Theme;
  toast: string | null;

  select(id: string): void;
  eject(): void;
  needleDown(): void;
  playTrack(i: number): void;
  toggle(): void;
  next(): void;
  prev(): void;
  setSpatial(m: SpatialMode): void;
  setVolume(v: number): void;
  setNoise(v: number): void;
  setRoom(v: number): void;
  setReel(on: boolean): void;
  setTheme(t: Theme): void;
  addAlbum(a: Album): void;
  notify(msg: string | null): void;
}

const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem('vinyl:prefs') ?? '{}') as Partial<State>;
  } catch {
    return {};
  }
})();

export const useStore = create<State>((set, get) => ({
  albums: catalog.albums as Album[],
  selectedId: null,
  ready: false,
  trackIndex: 0,
  playing: false,
  buffering: false,
  reel: saved.reel ?? true,
  spatial: saved.spatial === 'stereo' ? 'stereo' : 'room',
  volume: saved.volume ?? 0.85,
  noise: saved.noise ?? 0.6,
  room: saved.room ?? 0.4,
  theme: saved.theme ?? 'light',
  toast: null,

  select(id) {
    engine.unlock();
    if (get().selectedId === id) return get().toggle();
    engine.stop();
    set({ selectedId: id, ready: false, trackIndex: 0, playing: true, buffering: false });
    const first = selectedAlbum(get())?.tracks[0];
    if (first) engine.prepare(first);
  },

  eject() {
    engine.stop();
    set({ selectedId: null, ready: false, playing: false, buffering: false });
  },

  /** Called by the deck when the stylus first lands on the record. */
  needleDown() {
    set({ ready: true });
    engine.sfx('needle');
    engine.leadIn();
    // The record squeaks faintly under the stylus as it comes up to speed.
    setTimeout(() => engine.sfx('squeak'), 140);
    // A second or so of crackle, then the music fades in.
    if (get().playing) setTimeout(() => get().playing && get().ready && get().playTrack(get().trackIndex), 1100);
  },

  playTrack(i) {
    const album = selectedAlbum(get());
    if (!album) return;
    const index = (i + album.tracks.length) % album.tracks.length;
    set({ trackIndex: index, playing: true });
    if (get().ready) {
      set({ buffering: true });
      const track = album.tracks[index];
      void engine.play(track).then(() => {
        // Line up the next highlight on the idle player.
        const after = album.tracks[index + 1];
        if (after && engine.current?.id === track.id) engine.prepare(after);
      });
    }
  },

  toggle() {
    const s = get();
    if (!s.selectedId) return;
    engine.unlock();
    if (s.playing) {
      engine.pause();
      set({ playing: false, buffering: false });
    } else if (s.ready) {
      if (engine.current?.id === selectedAlbum(s)?.tracks[s.trackIndex]?.id) engine.resume();
      else s.playTrack(s.trackIndex);
      set({ playing: true });
    } else {
      set({ playing: true });
    }
  },

  next: () => get().playTrack(get().trackIndex + 1),
  prev: () => get().playTrack(get().trackIndex - 1),

  setSpatial(m) {
    engine.setMode(m);
    set({ spatial: m });
  },
  setVolume(v) {
    engine.setVolume(v);
    set({ volume: v });
  },
  setNoise(v) {
    engine.setNoise(v);
    set({ noise: v });
  },
  setRoom(v) {
    engine.setRoom(v);
    set({ room: v });
  },
  setReel: (reel) => set({ reel }),
  setTheme: (theme) => set({ theme }),

  addAlbum: (a) => set((s) => ({ albums: [a, ...s.albums.filter((x) => x.id !== a.id)] })),
  notify: (toast) => set({ toast }),
}));

export const selectedAlbum = (s: Pick<State, 'albums' | 'selectedId'>) =>
  s.albums.find((a) => a.id === s.selectedId) ?? null;

// Remember listening preferences.
useStore.subscribe((s) => {
  try {
    localStorage.setItem('vinyl:prefs', JSON.stringify({ reel: s.reel, spatial: s.spatial, volume: s.volume, noise: s.noise, room: s.room, theme: s.theme }));
  } catch {
    /* private mode */
  }
});

// Engine → state. In the reel, the next track starts while this one fades
// ("ending"), so they crossfade. Otherwise playback stops at the end.
engine.addEventListener('ending', () => {
  const s = useStore.getState();
  const album = selectedAlbum(s);
  if (album && s.reel && s.trackIndex < album.tracks.length - 1) s.playTrack(s.trackIndex + 1);
});
engine.addEventListener('ended', () => useStore.setState({ playing: false, buffering: false }));
engine.addEventListener('playing', () => useStore.setState({ buffering: false }));
engine.addEventListener('buffering', () => useStore.setState({ buffering: true }));
engine.addEventListener('error', (e) => {
  const s = useStore.getState();
  const track = (e as CustomEvent).detail as { title: string };
  s.notify(`Couldn't load "${track.title}". Skipping to the next track.`);
  const album = selectedAlbum(s);
  if (album && s.trackIndex < album.tracks.length - 1) s.playTrack(s.trackIndex + 1);
  else useStore.setState({ playing: false, buffering: false });
});

// Apply saved preferences once the engine starts.
engine.setMode(useStore.getState().spatial);
engine.setVolume(useStore.getState().volume);
engine.setNoise(useStore.getState().noise);
engine.setRoom(useStore.getState().room);
