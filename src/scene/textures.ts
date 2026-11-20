import * as THREE from 'three';
import type { Album } from '../types';

const images = new Map<string, Promise<HTMLImageElement | null>>();

export function loadImage(src: string) {
  if (!images.has(src)) {
    images.set(
      src,
      new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
      }),
    );
  }
  return images.get(src)!;
}

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  draw(g, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { tex, g, canvas };
}

function coverFit(g: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / img.width, h / img.height);
  const iw = img.width * s;
  const ih = img.height * s;
  g.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}

/**
 * The record's playing surface (top cap of the disc).
 * Grooves run from the lead-in to the run-out, with a smooth gap between
 * tracks spaced by the tracks' real lengths, the same as on a real pressing.
 */
export function vinylTexture(album: Album) {
  const color = new THREE.Color(album.vinyl);
  const dark = color.getHSL({ h: 0, s: 0, l: 0 }).l < 0.12;
  const base = dark ? '#0c0c0e' : `#${color.clone().multiplyScalar(0.75).getHexString()}`;

  const { tex, g } = canvasTexture(2048, (g, S) => {
    const c = S / 2;
    const R = S / 2;
    g.fillStyle = base;
    g.fillRect(0, 0, S, S);

    // Grooves.
    const outer = 0.962 * R;
    const inner = 0.405 * R;
    const total = album.tracks.reduce((t, x) => t + (x.duration || 180), 0) || 1;
    const gaps: number[] = [];
    let acc = 0;
    for (const t of album.tracks.slice(0, -1)) {
      acc += t.duration || 180;
      gaps.push(outer - (acc / total) * (outer - inner));
    }
    g.lineWidth = 1.1;
    for (let r = inner; r < outer; r += 1.6) {
      if (gaps.some((gap) => Math.abs(r - gap) < 5)) continue;
      const v = Math.random();
      g.strokeStyle = v > 0.5 ? `rgba(255,255,255,${0.025 + v * 0.05})` : `rgba(0,0,0,${0.18 + v * 0.2})`;
      g.beginPath();
      g.arc(c, c, r, 0, Math.PI * 2);
      g.stroke();
    }
    // Gaps between tracks are glossier.
    for (const gap of gaps) {
      g.strokeStyle = 'rgba(255,255,255,0.06)';
      g.lineWidth = 6;
      g.beginPath();
      g.arc(c, c, gap, 0, Math.PI * 2);
      g.stroke();
    }
    // Run-out area and the outer lip.
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(255,255,255,0.05)';
    for (const r of [inner - 18, inner - 40, outer + 14]) {
      g.beginPath();
      g.arc(c, c, r, 0, Math.PI * 2);
      g.stroke();
    }

    // Label placeholder until the cover loads.
    drawLabel(g, S, null, album);
  });

  void loadImage(album.cover).then((img) => {
    if (!img) return;
    drawLabel(g, 2048, img, album);
    tex.needsUpdate = true;
  });
  return tex;
}

function drawLabel(g: CanvasRenderingContext2D, S: number, img: HTMLImageElement | null, album: Album) {
  const c = S / 2;
  const r = 0.335 * (S / 2);
  g.save();
  g.beginPath();
  g.arc(c, c, r, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = '#e9e6df';
  g.fillRect(c - r, c - r, r * 2, r * 2);
  if (img) coverFit(g, img, c - r, c - r, r * 2, r * 2);
  else {
    g.fillStyle = '#111';
    g.font = `600 ${S * 0.022}px "DM Sans", system-ui, sans-serif`;
    g.textAlign = 'center';
    g.fillText(album.title.slice(0, 26), c, c - S * 0.04);
  }
  // Soft sheen ring at the label's edge.
  const ring = g.createRadialGradient(c, c, r * 0.86, c, c, r);
  ring.addColorStop(0, 'rgba(0,0,0,0)');
  ring.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = ring;
  g.fillRect(c - r, c - r, r * 2, r * 2);
  g.restore();
  // Spindle hole.
  g.fillStyle = '#050505';
  g.beginPath();
  g.arc(c, c, S * 0.0075, 0, Math.PI * 2);
  g.fill();
}

/** Front of the sleeve: the album cover. */
export function sleeveFrontTexture(album: Album) {
  const { tex, g } = canvasTexture(1024, (g, S) => {
    g.fillStyle = '#1a1b20';
    g.fillRect(0, 0, S, S);
  });
  void loadImage(album.cover).then((img) => {
    if (!img) return;
    coverFit(g, img, 0, 0, 1024, 1024);
    // Card-stock wear at the edges.
    const v = g.createLinearGradient(0, 0, 1024, 1024);
    v.addColorStop(0, 'rgba(255,255,255,0.06)');
    v.addColorStop(0.5, 'rgba(255,255,255,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.12)');
    g.fillStyle = v;
    g.fillRect(0, 0, 1024, 1024);
    tex.needsUpdate = true;
  });
  return tex;
}

/** Back of the sleeve: the tracklist, set like a liner card. */
export function sleeveBackTexture(album: Album) {
  const { tex } = canvasTexture(1024, (g, S) => {
    g.fillStyle = '#0f1014';
    g.fillRect(0, 0, S, S);
    g.fillStyle = album.vinyl;
    g.globalAlpha = 0.9;
    g.fillRect(72, 72, 8, 120);
    g.globalAlpha = 1;
    g.fillStyle = '#f2f2f4';
    g.font = '600 46px "DM Sans", system-ui, sans-serif';
    wrap(g, album.title, 104, 116, S - 180, 54, 2);
    g.fillStyle = '#9b9ca6';
    g.font = '400 30px "DM Sans", system-ui, sans-serif';
    g.fillText(album.artist, 104, 238);
    g.font = '400 26px "DM Mono", ui-monospace, monospace';
    album.tracks.forEach((t, i) => {
      const y = 340 + i * 58;
      g.fillStyle = '#5d5e68';
      g.fillText(String(i + 1).padStart(2, '0'), 104, y);
      g.fillStyle = '#d6d6dc';
      g.fillText(truncate(g, t.title, S - 360), 170, y);
      g.fillStyle = '#5d5e68';
      g.textAlign = 'right';
      g.fillText(time(t.duration), S - 96, y);
      g.textAlign = 'left';
    });
    g.fillStyle = '#4a4b54';
    g.font = '400 22px "DM Mono", ui-monospace, monospace';
    g.fillText(`${album.source.toUpperCase()} · CREATIVE COMMONS`, 104, S - 90);
  });
  return tex;
}

/** Faint radial glow behind the deck, tinted per album. */
export function glowTexture() {
  return canvasTexture(512, (g, S) => {
    const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.18)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
  }).tex;
}

/** A generated cover for files the listener adds, as a data URL. */
export function generatedCover(title: string, hue: number) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 600;
  const g = canvas.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, 600, 600);
  bg.addColorStop(0, `hsl(${hue} 70% 18%)`);
  bg.addColorStop(1, `hsl(${(hue + 60) % 360} 70% 8%)`);
  g.fillStyle = bg;
  g.fillRect(0, 0, 600, 600);
  for (let i = 0; i < 3; i++) {
    const x = 150 + i * 150;
    const orb = g.createRadialGradient(x, 300 - i * 40, 0, x, 300 - i * 40, 220);
    orb.addColorStop(0, `hsla(${(hue + i * 40) % 360} 90% 65% / 0.55)`);
    orb.addColorStop(1, 'transparent');
    g.fillStyle = orb;
    g.fillRect(0, 0, 600, 600);
  }
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.font = '600 44px "DM Sans", system-ui, sans-serif';
  wrap(g, title, 48, 470, 500, 50, 2);
  return canvas.toDataURL('image/jpeg', 0.9);
}

function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, lh: number, lines: number) {
  const words = text.split(/\s+/);
  let line = '';
  let n = 0;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (g.measureText(test).width > max && line) {
      g.fillText(n === lines - 1 ? truncate(g, `${line} ${w}`, max) : line, x, y + n * lh);
      if (++n >= lines) return;
      line = w;
    } else line = test;
  }
  if (line) g.fillText(line, x, y + n * lh);
}

function truncate(g: CanvasRenderingContext2D, text: string, max: number) {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length && g.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}

const time = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// --- Deck surfaces ---------------------------------------------------------

/** Plinth top plate size, in deck units (x by z). */
export const PLATE = { w: 4.66, d: 3.56 };

/** Wait for the webfonts used on canvas, so printed labels use them. */
const fontsReady = typeof document !== 'undefined' && document.fonts
  ? Promise.all(['700 80px Yesteryear', '400 40px "DM Sans"', '500 40px "DM Sans"', '400 40px "DM Mono"'].map((f) => document.fonts.load(f))).catch(() => [])
  : Promise.resolve([]);

export interface PlateMarks {
  antiSkate: [number, number];
  cue: [number, number];
  speed: [number, number];
  power: [number, number];
  badge: [number, number];
  platter: [number, number, number]; // x, z, radius
}

/**
 * The deck's top plate: brushed metal with the control legends printed on it
 * (anti-skating scale, 33/45, off/on) and the maker's badge.
 * Light: satin aluminium. Dark: champagne gold.
 */
export function plateTexture(dark: boolean, marks: PlateMarks) {
  const W = 2048;
  const H = Math.round((W * PLATE.d) / PLATE.w);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  const X = (x: number) => ((x + PLATE.w / 2) / PLATE.w) * W;
  const Y = (z: number) => ((z + PLATE.d / 2) / PLATE.d) * H;
  const S = (u: number) => (u / PLATE.w) * W;
  const ink = dark ? 'rgba(38, 30, 16, 0.86)' : 'rgba(40, 40, 42, 0.82)';
  const accent = '#e2572b';

  const draw = () => {
    const base = g.createLinearGradient(0, 0, W, H);
    if (dark) {
      base.addColorStop(0, '#c9b48b');
      base.addColorStop(0.5, '#b49c70');
      base.addColorStop(1, '#a58c61');
    } else {
      base.addColorStop(0, '#e1e1de');
      base.addColorStop(0.5, '#d2d2ce');
      base.addColorStop(1, '#c6c6c2');
    }
    g.fillStyle = base;
    g.fillRect(0, 0, W, H);

    // Brushing: long, faint horizontal strokes.
    for (let i = 0; i < 14000; i++) {
      const y = Math.random() * H;
      const x = Math.random() * W - 200;
      const len = 120 + Math.random() * 900;
      g.strokeStyle = Math.random() > 0.5 ? `rgba(255,255,255,${0.02 + Math.random() * 0.05})` : `rgba(0,0,0,${0.015 + Math.random() * 0.04})`;
      g.lineWidth = Math.random() > 0.9 ? 1.6 : 0.8;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + len, y + (Math.random() - 0.5) * 0.6);
      g.stroke();
    }

    // A soft, recessed well around the platter.
    const [px, pz, pr] = marks.platter;
    const well = g.createRadialGradient(X(px), Y(pz), S(pr * 0.98), X(px), Y(pz), S(pr * 1.09));
    well.addColorStop(0, 'rgba(0,0,0,0.42)');
    well.addColorStop(0.35, 'rgba(0,0,0,0.12)');
    well.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = well;
    g.beginPath();
    g.arc(X(px), Y(pz), S(pr * 1.09), 0, Math.PI * 2);
    g.fill();

    g.fillStyle = ink;
    g.strokeStyle = ink;
    g.textAlign = 'center';
    g.lineWidth = 2.2;
    const label = (text: string, x: number, z: number, size = 0.074) => {
      g.font = `400 ${S(size)}px "DM Sans", system-ui, sans-serif`;
      g.fillText(text, X(x), Y(z));
    };

    // Anti-skating: legend above, a 0–5 scale of ticks below.
    {
      const [x, z] = marks.antiSkate;
      label('anti-skating', x, z - 0.19);
      for (let i = 0; i <= 5; i++) {
        const tx = x - 0.16 + i * 0.064;
        g.beginPath();
        g.moveTo(X(tx), Y(z + 0.1));
        g.lineTo(X(tx), Y(z + 0.16 + (i % 5 === 0 ? 0.02 : 0)));
        g.stroke();
        label(String(i), tx, z + 0.26, 0.056);
      }
    }
    // Cue: a slot for the lever.
    {
      const [x, z] = marks.cue;
      label('cue', x, z - 0.17);
      g.fillStyle = 'rgba(0,0,0,0.55)';
      const w = S(0.06);
      const h = S(0.2);
      g.beginPath();
      g.roundRect(X(x) - w / 2, Y(z) - h / 2, w, h, w / 2);
      g.fill();
      g.fillStyle = ink;
      label('up', x + 0.13, z - 0.05, 0.05);
      label('down', x + 0.15, z + 0.08, 0.05);
    }
    // A selector's scale: the rest position straight down, the other 45° to the right.
    const selector = (x: number, z: number, title: string, rest: string, turned: string) => {
      label(title, x, z - 0.19);
      const r = S(0.14);
      g.beginPath();
      g.arc(X(x), Y(z), r, Math.PI / 4, Math.PI / 2);
      g.stroke();
      for (const a of [Math.PI / 4, Math.PI / 2]) {
        g.beginPath();
        g.moveTo(X(x) + Math.cos(a) * r, Y(z) + Math.sin(a) * r);
        g.lineTo(X(x) + Math.cos(a) * (r + S(0.035)), Y(z) + Math.sin(a) * (r + S(0.035)));
        g.stroke();
      }
      label(rest, x, z + 0.27, 0.062);
      label(turned, x + 0.19, z + 0.22, 0.062);
    };
    selector(...marks.speed, 'speed', '33', '45');
    selector(...marks.power, 'power', 'off', 'on');

    // Maker's badge: script "Vinyl", spaced caps under a swash.
    {
      const [x, z] = marks.badge;
      g.textAlign = 'left';
      g.font = `700 ${S(0.2)}px Yesteryear, "Brush Script MT", cursive`;
      g.fillText('Vinyl', X(x), Y(z));
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(X(x + 0.01), Y(z + 0.045));
      g.bezierCurveTo(X(x + 0.2), Y(z + 0.03), X(x + 0.45), Y(z + 0.04), X(x + 0.62), Y(z - 0.06));
      g.stroke();
      g.font = `500 ${S(0.04)}px "DM Sans", system-ui, sans-serif`;
      if ('letterSpacing' in g) (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${S(0.012)}px`;
      g.fillText('STUDIO · HIGH FIDELITY', X(x), Y(z + 0.13));
      if ('letterSpacing' in g) (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0px';
      g.fillStyle = accent;
      g.beginPath();
      g.arc(X(x + 0.7), Y(z - 0.1), S(0.018), 0, Math.PI * 2);
      g.fill();
    }
  };

  draw();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  void fontsReady.then(() => {
    draw();
    tex.needsUpdate = true;
  });
  return tex;
}

/** Rubber slipmat with an embossed, rippled ring pattern. */
export function matTexture() {
  return canvasTexture(1024, (g, S) => {
    const c = S / 2;
    g.fillStyle = '#18181a';
    g.fillRect(0, 0, S, S);
    g.lineWidth = 2;
    for (let r = 70; r < S / 2 - 8; r += 9) {
      g.strokeStyle = `rgba(255,255,255,${0.035 + (r % 27 === 0 ? 0.03 : 0)})`;
      g.beginPath();
      for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.02) {
        const rr = r + Math.sin(a * 3 + r * 0.05) * 6 + Math.sin(a * 7 - r * 0.02) * 2.5;
        const x = c + Math.cos(a) * rr;
        const y = c + Math.sin(a) * rr;
        if (a === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
  }).tex;
}
