import { useEffect } from 'react';
import { Scene } from './scene/Scene';
import { selectedAlbum, useStore } from './state/store';
import { Dock } from './ui/Dock';
import { Header } from './ui/Header';
import { Credit, Label, OnDeck, Wordmark } from './ui/Margins';

export default function App() {
  const album = useStore(selectedAlbum);
  const theme = useStore((s) => s.theme);
  const toast = useStore((s) => s.toast);
  const notify = useStore((s) => s.notify);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0d0d0c' : '#f2f0e9');
  }, [theme]);

  // Keyboard: space to play/pause, arrows for tracks, Esc to put the record away.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
      const s = useStore.getState();
      if (e.code === 'Space' && !t.closest('button')) { e.preventDefault(); s.toggle(); }
      else if (e.key === 'ArrowRight') s.next();
      else if (e.key === 'ArrowLeft') s.prev();
      else if (e.key === 'Escape') s.eject();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => notify(null), 4200);
    return () => clearTimeout(id);
  }, [toast, notify]);

  return (
    <div className="app" style={{ '--accent': album?.vinyl ?? '#8f8b80' } as React.CSSProperties}>
      <div className="halo" aria-hidden />
      <Wordmark />
      <div className="stage"><Scene /></div>
      <div className="chrome">
        <Header />
        <OnDeck />
        <Dock />
        <Label />
        <Credit />
      </div>
      <div className={`toast surface ${toast ? 'show' : ''}`} role="status" aria-live="polite">{toast}</div>
    </div>
  );
}
