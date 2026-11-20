import type { Album, Track } from '../types';
import { envelopeOf, findHighlight } from './highlight.js';
import { generatedCover } from '../scene/textures';

const AUDIO = /\.(mp3|wav|ogg|oga|flac|m4a|aac|opus|webm)$/i;
const MAX_FILES = 12;

/**
 * Turns audio files from the listener's device into an album. Files are
 * decoded at a low sample rate (only to find each 20-second highlight),
 * then played from local blob URLs. Nothing leaves the device.
 */
export async function albumFromFiles(list: FileList | File[]): Promise<Album> {
  const files = [...list].filter((f) => f.type.startsWith('audio/') || AUDIO.test(f.name)).slice(0, MAX_FILES);
  if (!files.length) throw new Error('Those files don’t look like audio. Try MP3, WAV, FLAC, M4A or OGG.');

  const tracks: Track[] = [];
  for (const file of files) {
    let duration = 0;
    let highlight = 0;
    let waveform: number[] | undefined;
    try {
      const ctx = new OfflineAudioContext(1, 1, 11025);
      const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
      const env = envelopeOf(buffer, 1000);
      duration = buffer.duration;
      highlight = findHighlight(env, duration);
      waveform = downsample(env, 96);
    } catch {
      continue; // undecodable in this browser
    }
    tracks.push({
      id: `local-${file.name}-${file.size}`,
      title: file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim(),
      duration: Math.round(duration),
      highlight: Math.round(highlight * 10) / 10,
      src: URL.createObjectURL(file),
      waveform,
    });
  }
  if (!tracks.length) throw new Error('This browser couldn’t decode those files. Try MP3 or WAV.');

  const hue = Math.floor(Math.random() * 360);
  const title = tracks.length === 1 ? tracks[0].title : 'From your library';
  return {
    id: `local-${Date.now()}`,
    title,
    artist: 'Your files',
    genre: 'Personal',
    tags: [],
    cover: generatedCover(title, hue),
    vinyl: hslToHex(hue, 70, 55),
    source: 'Local',
    tracks,
    local: true,
  };
}

function downsample(points: ArrayLike<number>, n: number) {
  const out: number[] = [];
  const step = points.length / n;
  for (let i = 0; i < n; i++) {
    let max = 0;
    for (let j = Math.floor(i * step); j < Math.floor((i + 1) * step); j++) max = Math.max(max, points[j]);
    out.push(Math.round(max * 100) / 100);
  }
  return out;
}

function hslToHex(h: number, s: number, l: number) {
  s /= 100;
  l /= 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
