// Finds the "main part" of a song: the 20-second window that's loud and full,
// and that preferably starts where the energy jumps (a chorus or a drop
// coming in). Plain JS so the Node catalog script and the browser share it.

export const SNIPPET_SECONDS = 20;

const mean = (prefix, a, b) => (b > a ? (prefix[b] - prefix[a]) / (b - a) : 0);

/**
 * @param {ArrayLike<number>} envelope  amplitude samples (0..1) spread evenly across the track
 * @param {number} duration             track length in seconds
 * @param {number} [length]             snippet length in seconds
 * @returns {number} start time in seconds
 */
export function findHighlight(envelope, duration, length = SNIPPET_SECONDS) {
  const n = envelope.length;
  if (!n || duration <= length + 4) return 0;
  const dt = duration / n;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + envelope[i];

  const win = Math.max(1, Math.round(length / dt));
  const onset = Math.max(1, Math.round(4 / dt)); // first 4s of the window...
  const before = Math.max(1, Math.round(6 / dt)); // ...against the 6s before it
  // Skip intros and outros.
  const lo = Math.round(Math.max(6, duration * 0.08) / dt);
  const hi = Math.min(n - win, Math.round((duration - length - Math.max(4, duration * 0.06)) / dt));
  if (hi <= lo) return Math.max(0, Math.min(duration - length, duration * 0.35));

  let best = lo;
  let bestScore = -Infinity;
  for (let s = lo; s <= hi; s++) {
    const body = mean(prefix, s, s + win);
    const lift = mean(prefix, s, s + onset) - mean(prefix, Math.max(0, s - before), s);
    const centre = Math.abs((s * dt) / duration - 0.45);
    const score = body + 0.6 * lift - 0.08 * centre;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best * dt;
}

/**
 * Peak envelope of a decoded AudioBuffer, for files the user drops in.
 * @param {AudioBuffer} buffer
 * @param {number} [points]
 */
export function envelopeOf(buffer, points = 1000) {
  const out = new Float32Array(points);
  const block = Math.floor(buffer.length / points) || 1;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  let peak = 0;
  for (let i = 0; i < points; i++) {
    let sum = 0;
    for (const data of channels) {
      for (let j = i * block, end = Math.min(data.length, j + block); j < end; j += 8) sum += data[j] * data[j];
    }
    out[i] = Math.sqrt(sum / ((block / 8) * channels.length));
    peak = Math.max(peak, out[i]);
  }
  if (peak > 0) for (let i = 0; i < points; i++) out[i] /= peak;
  return out;
}
