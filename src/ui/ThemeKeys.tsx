import { useStore } from '../state/store';

/**
 * Light/dark as a hi-fi rocker button: a red key with an orange pilot light
 * above it. Lights on (light mode) shows the lit pilot; press it and the
 * rocker flips, the pilot goes dark, and so does the room.
 */
export function ThemeKeys() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const dark = theme === 'dark';
  return (
    <button
      className={`rocker-switch ${dark ? 'off' : 'on'}`}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-pressed={dark}
      aria-label="Dark mode"
      title={dark ? 'Lights on (light mode)' : 'Lights off (dark mode)'}
    >
      <span className="rocker-housing" aria-hidden>
        <i className="rocker-pilot" />
        <span className="rocker" />
      </span>
      <span className="rocker-label mono">{dark ? 'Dark' : 'Light'}</span>
    </button>
  );
}
