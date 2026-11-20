import type { SVGProps } from 'react';

const base = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
type P = SVGProps<SVGSVGElement>;

export const Play = (p: P) => (<svg {...base} {...p}><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none" /></svg>);
export const Pause = (p: P) => (<svg {...base} {...p}><rect x="6.5" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none" /><rect x="13.9" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none" /></svg>);
export const Next = (p: P) => (<svg {...base} {...p}><path d="M6 6l8 6-8 6z" fill="currentColor" stroke="none" /><path d="M17.5 6v12" /></svg>);
export const Prev = (p: P) => (<svg {...base} {...p}><path d="M18 6l-8 6 8 6z" fill="currentColor" stroke="none" /><path d="M6.5 6v12" /></svg>);
export const Eject = (p: P) => (<svg {...base} {...p}><path d="M12 5l7 8H5z" fill="currentColor" stroke="none" /><path d="M5 18h14" /></svg>);
export const Plus = (p: P) => (<svg {...base} {...p}><path d="M12 5v14M5 12h14" /></svg>);
export const Volume = (p: P) => (<svg {...base} {...p}><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" /><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11" /></svg>);
export const Headphones = (p: P) => (<svg {...base} {...p}><path d="M4 15v-3a8 8 0 0 1 16 0v3" /><rect x="3.5" y="14" width="4" height="6" rx="1.5" /><rect x="16.5" y="14" width="4" height="6" rx="1.5" /></svg>);
export const Disc = (p: P) => (<svg {...base} {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2.6" /><path d="M12 3a9 9 0 0 1 8.5 6" opacity=".55" /></svg>);
export const Sun = (p: P) => (<svg {...base} {...p}><circle cx="12" cy="12" r="3.6" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" /></svg>);
export const Moon = (p: P) => (<svg {...base} {...p}><path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z" /></svg>);
export const List = (p: P) => (<svg {...base} {...p}><path d="M9 7h11M9 12h11M9 17h11" /><circle cx="4.8" cy="7" r=".9" fill="currentColor" /><circle cx="4.8" cy="12" r=".9" fill="currentColor" /><circle cx="4.8" cy="17" r=".9" fill="currentColor" /></svg>);
export const Reel = (p: P) => (<svg {...base} {...p}><path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.7" /><path d="M20 4v4.7h-4.7" /><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.3" /><path d="M4 20v-4.7h4.7" /></svg>);
export const AutoNext = (p: P) => (<svg {...base} {...p}><path d="M4 8.5l6 3.5-6 3.5z" fill="currentColor" stroke="none" /><path d="M11 8.5l6 3.5-6 3.5z" fill="currentColor" stroke="none" /><path d="M20 7v10" /><path d="M5 20.5h11a3 3 0 0 0 3-3" opacity=".55" /></svg>);
export const Sliders = (p: P) => (<svg {...base} {...p}><path d="M5 6h9M18 6h1M5 12h3M12 12h7M5 18h7M16 18h3" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="14" cy="18" r="2" /></svg>);
