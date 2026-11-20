import { MusicMenu } from './MusicMenu';
import { ThemeKeys } from './ThemeKeys';

/** Light/dark keys on the left, the music menu on the right. */
export function Header() {
  return (
    <header className="header">
      <ThemeKeys />
      <MusicMenu />
    </header>
  );
}
