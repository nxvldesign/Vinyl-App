/**
 * The studio's sound label: a script wordmark with a swash underline over
 * spaced caps. An original mark for this site, in the spirit of classic
 * audiophile pressing labels.
 */
export function SoundLabel({ className = '' }: { className?: string }) {
  return (
    <svg className={`sound-label ${className}`} viewBox="0 0 200 92" role="img" aria-label="Vinyl Studio, high fidelity analogue pressings">
      <text x="100" y="50" textAnchor="middle" fontFamily="Yesteryear, 'Brush Script MT', cursive" fontSize="52" fill="currentColor">
        Vinyl
      </text>
      <path d="M34 60 C 76 55, 128 57, 168 47 C 176 45, 181 41, 183 35" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
      <circle cx="187" cy="31" r="2.6" className="sound-label-dot" />
      <text x="100" y="77" textAnchor="middle" fontFamily="'DM Sans', sans-serif" fontSize="9.5" letterSpacing="3.1" fill="currentColor">
        STUDIO · HIGH FIDELITY
      </text>
      <text x="100" y="90" textAnchor="middle" fontFamily="'DM Sans', sans-serif" fontSize="7.5" letterSpacing="2.6" fill="currentColor" opacity="0.6">
        ANALOGUE PRESSINGS
      </text>
    </svg>
  );
}
