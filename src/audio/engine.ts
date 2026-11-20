import type { SpatialMode, Track } from '../types';
import { SNIPPET_SECONDS } from './highlight.js';

type Vec3 = { x: number; y: number; z: number };

const FADE_IN = 0.6;
const FADE_OUT = 1.2; // also the crossfade length when auto-next moves on
const SURFACE = 0.5; // surface-noise gain under the music, at noise = 1
const SURFACE_LEAD_IN = 0.9; // the lead-in groove, before the music starts
const ROOM_MAX = 0.32; // reverb send at room = 1
const REV = 1.8; // seconds per revolution at 33⅓ rpm
const WOW = { depth: 0.0008, hz: 1 / REV }; // pitch drift, once per revolution
const FLUTTER = { depth: 0.00025, hz: 6.3 };

export type Sfx = 'thud' | 'click' | 'drop' | 'needle' | 'squeak'; // squeak: the record's faint start-up creak

interface Player {
  el: HTMLAudioElement;
  fade?: GainNode;
  busyUntil: number; // still fading out until then (ms, performance.now)
}

/**
 * Plays 20-second highlights through a model of a turntable's sound:
 *
 *   <audio> A ─ fade ─┐                        ┌─ stereo ───────────────┐
 *   <audio> B ─ fade ─┴─ tone ─┐               │                        ├─ master ─ out
 *   surface noise ─────────────┴─ bus ─────────┴─ split L/R ─ HRTF L/R ─┤
 *   mechanical sounds ───────────┘                       └─ room reverb ┘
 *
 * - Tone: a gentle treble roll-off and a little low-end warmth, like a
 *   moving-magnet cartridge into a phono stage.
 * - Wow and flutter: the playback rate drifts by a fraction of a percent,
 *   once per revolution, as an imperfect platter does.
 * - Surface noise: hiss, motor rumble, soft ticks and the odd pop, plus a
 *   couple of groove flaws that click on every revolution. It only sounds
 *   while the stylus is in the groove.
 * - Two players take turns, so the next highlight is already buffered.
 * - Each stereo channel plays from its own virtual speaker (an HRTF panner),
 *   so the mix keeps its width while the sound sits in the 3D room.
 */
class AudioEngine extends EventTarget {
  private players: Player[];
  private a = 0;
  private ctx?: AudioContext;
  private nodes?: ReturnType<AudioEngine['build']>;
  private track?: Track;
  private start = 0;
  private end = 0;
  private fadingOut = false;
  private token = 0;
  private mode: SpatialMode = 'room';
  private volume = 0.85;
  private noise = 0.6;
  private room = 0.4;
  private surfaceOn = 0; // 0 lifted, 1 playing, SURFACE_LEAD_IN/SURFACE in the lead-in
  private level = 0;
  private levelData = new Uint8Array(1024);
  private clock = 0;
  private sfxCache = new Map<Sfx, AudioBuffer>();

  constructor() {
    super();
    this.players = [0, 1].map(() => {
      const el = new Audio();
      el.crossOrigin = 'anonymous';
      el.preload = 'auto';
      // Let wow and flutter bend the pitch, as a real platter does.
      el.preservesPitch = false;
      const active = () => this.el === el;
      el.addEventListener('error', () => {
        if (active() && this.track) this.dispatchEvent(new CustomEvent('error', { detail: this.track }));
      });
      el.addEventListener('waiting', () => active() && this.dispatchEvent(new Event('buffering')));
      el.addEventListener('playing', () => active() && this.dispatchEvent(new Event('playing')));
      return { el, busyUntil: 0 };
    });
  }

  /** The player that's currently on. */
  get el() {
    return this.players[this.a].el;
  }

  /** Must run inside a click or key handler, so the browser allows sound. */
  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'playback' });
      this.nodes = this.build(this.ctx);
      this.setMode(this.mode);
      this.setVolume(this.volume);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private build(ctx: AudioContext) {
    // Everything meets on a stereo bus (mono sources are spread to both sides).
    const bus = ctx.createGain();
    bus.channelCount = 2;
    bus.channelCountMode = 'explicit';
    bus.channelInterpretation = 'speakers';

    // Cartridge and phono-stage colour, for the music only.
    const warmth = new BiquadFilterNode(ctx, { type: 'lowshelf', frequency: 110, gain: 1.5 });
    const air = new BiquadFilterNode(ctx, { type: 'highshelf', frequency: 9500, gain: -2.5 });
    const top = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 16500, Q: 0.5 });
    warmth.connect(air).connect(top).connect(bus);
    for (const p of this.players) {
      p.fade = ctx.createGain();
      p.fade.gain.value = 0;
      ctx.createMediaElementSource(p.el).connect(p.fade).connect(warmth);
    }

    const surface = ctx.createGain();
    surface.gain.value = 0;
    const noise = ctx.createBufferSource();
    noise.buffer = surfaceNoise(ctx);
    noise.loop = true;
    noise.connect(surface).connect(bus);
    noise.start();

    const master = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    master.connect(analyser).connect(ctx.destination);

    const reverb = ctx.createConvolver();
    reverb.buffer = roomImpulse(ctx, 1.4);
    const wet = ctx.createGain();
    wet.gain.value = 0;
    reverb.connect(wet).connect(master);

    const spatial = ctx.createGain();
    const stereo = ctx.createGain();
    bus.connect(stereo).connect(master);
    bus.connect(spatial);
    stereo.connect(reverb);
    const split = ctx.createChannelSplitter(2);
    spatial.connect(split);
    const panners = [0, 1].map((ch) => {
      const p = new PannerNode(ctx, {
        panningModel: 'HRTF',
        distanceModel: 'inverse',
        refDistance: 6,
        rolloffFactor: 0.9,
        maxDistance: 60,
      });
      split.connect(p, ch);
      p.connect(master);
      p.connect(reverb);
      return p;
    });
    return { bus, surface, master, analyser, wet, spatial, stereo, panners };
  }

  setMode(mode: SpatialMode) {
    this.mode = mode;
    const n = this.nodes;
    if (!n || !this.ctx) return;
    const t = this.ctx.currentTime;
    n.spatial.gain.setTargetAtTime(mode === 'stereo' ? 0 : 1, t, 0.08);
    n.stereo.gain.setTargetAtTime(mode === 'stereo' ? 1 : 0, t, 0.08);
    this.setRoom(this.room);
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.nodes && this.ctx) this.nodes.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.04);
  }

  /** How much surface noise (hiss, ticks, pops): 0 a pristine pressing, 1 a well-loved one. */
  setNoise(v: number) {
    this.noise = v;
    this.applySurface(0.1);
  }

  /** How much of the listening room you hear (reverb). */
  setRoom(v: number) {
    this.room = v;
    if (this.nodes && this.ctx) this.nodes.wet.gain.setTargetAtTime(v * ROOM_MAX, this.ctx.currentTime, 0.1);
  }

  private setSurface(level: number, tc: number) {
    this.surfaceOn = level;
    this.applySurface(tc);
  }
  private applySurface(tc: number) {
    if (!this.nodes || !this.ctx) return;
    const g = this.nodes.surface.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(this.surfaceOn * SURFACE * this.noise * this.noise, t, tc);
  }

  get playing() {
    return !this.el.paused;
  }
  get current() {
    return this.track;
  }
  /** 0..1 through the current snippet. */
  get progress() {
    if (!this.track) return 0;
    return clamp((this.el.currentTime - this.start) / (this.end - this.start), 0, 1);
  }
  /** Seconds into the full track (where the needle is). */
  get position() {
    return this.el.currentTime || this.start;
  }
  /** Smoothed loudness 0..1, for visuals. */
  get loudness() {
    return this.level;
  }
  private urlOf(track: Track) {
    return new URL(track.src, location.href).href;
  }

  /** Load a track at its highlight on the idle player, so it's ready to go. */
  prepare(track: Track) {
    const url = this.urlOf(track);
    if (this.players.some((p) => p.el.src === url)) return;
    const idle = this.players[1 - this.a];
    const wait = idle.busyUntil - performance.now();
    if (wait > 0) return void setTimeout(() => this.prepare(track), wait + 30);
    if (!idle.el.paused) return;
    idle.el.src = url;
    idle.el.addEventListener(
      'loadedmetadata',
      () => {
        if (idle.el.src === url && idle.el.paused) idle.el.currentTime = track.highlight;
      },
      { once: true },
    );
  }

  /** Fade a player out (a crossfade when another is starting), then pause it. */
  private release(p: Player, seconds: number) {
    if (!p.fade || !this.ctx) return p.el.pause();
    const t = this.ctx.currentTime;
    p.fade.gain.cancelScheduledValues(t);
    p.fade.gain.setTargetAtTime(0, t, seconds / 4);
    const ms = seconds * 1000 + 150;
    p.busyUntil = performance.now() + ms;
    setTimeout(() => this.players[this.a] !== p && p.el.pause(), ms);
  }

  async play(track: Track) {
    this.unlock();
    const token = ++this.token;
    const ctx = this.ctx!;
    const url = this.urlOf(track);
    this.track = track;
    this.start = track.highlight;
    this.end = Math.min(track.duration || Infinity, track.highlight + SNIPPET_SECONDS);
    this.fadingOut = false;

    const prev = this.players[this.a];
    let next = this.players.find((p) => p.el.src === url);
    if (!next) {
      next = this.players[1 - this.a];
      next.el.pause();
      next.el.src = url;
    }
    if (next !== prev) this.release(prev, prev.el.paused ? 0.05 : FADE_OUT);
    this.a = this.players.indexOf(next);
    const fade = next.fade!.gain;
    fade.cancelScheduledValues(ctx.currentTime);
    fade.setValueAtTime(0, ctx.currentTime);

    if (next.el.readyState < HTMLMediaElement.HAVE_METADATA) {
      try {
        await once(next.el, 'loadedmetadata');
      } catch {
        return; // the error listener already reported it
      }
      if (token !== this.token) return;
    }
    if (Number.isFinite(next.el.duration)) this.end = Math.min(next.el.duration, this.end);
    if (Math.abs(next.el.currentTime - this.start) > 0.25) next.el.currentTime = this.start;
    try {
      await next.el.play();
    } catch (err) {
      if (token === this.token && (err as Error).name !== 'AbortError') {
        this.dispatchEvent(new CustomEvent('error', { detail: track }));
      }
      return;
    }
    if (token !== this.token) return;
    const t = ctx.currentTime;
    fade.cancelScheduledValues(t);
    fade.setValueAtTime(0, t);
    fade.linearRampToValueAtTime(1, t + FADE_IN);
    // Out of the lead-in groove: the surface noise settles under the music.
    this.setSurface(1, 0.6);
  }

  pause() {
    const p = this.players[this.a];
    if (!this.ctx || !this.nodes || !p.fade) return p.el.pause();
    const t = this.ctx.currentTime;
    p.fade.gain.cancelScheduledValues(t);
    p.fade.gain.setTargetAtTime(0, t, 0.06);
    this.setSurface(0, 0.05);
    const token = this.token;
    setTimeout(() => token === this.token && p.el.pause(), 220);
  }

  resume() {
    if (!this.track) return;
    if (this.el.currentTime >= this.end - 0.05) return void this.play(this.track);
    this.unlock();
    const p = this.players[this.a];
    void p.el.play().then(() => {
      const t = this.ctx!.currentTime;
      p.fade!.gain.cancelScheduledValues(t);
      p.fade!.gain.setTargetAtTime(1, t, 0.12);
      this.setSurface(1, 0.3);
    });
  }

  stop() {
    this.token++;
    this.pause();
    this.track = undefined;
  }

  /**
   * Mechanical sounds from the deck: the stylus touching down, the record
   * settling, switches, the dust cover closing. They play through the same
   * speakers as the music, so they sit in the room.
   */
  sfx(name: Sfx, intensity = 1) {
    if (!this.ctx || !this.nodes) return;
    const ctx = this.ctx;
    let buf = this.sfxCache.get(name);
    if (!buf) {
      buf = SFX[name](ctx);
      this.sfxCache.set(name, buf);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 0.96 + Math.random() * 0.08;
    const g = ctx.createGain();
    g.gain.value = Math.min(1.2, intensity) * SFX_LEVEL[name];
    src.connect(g).connect(this.nodes.bus);
    src.start();
  }

  /** The needle just landed in the lead-in groove: hiss and a few ticks before the music. */
  leadIn() {
    this.setSurface(SURFACE_LEAD_IN / SURFACE, 0.03);
  }

  /** The needle lifted: the surface noise stops. */
  needleUp() {
    this.setSurface(0, 0.03);
  }

  /**
   * Called every frame by the 3D scene with the camera (the listener) and
   * the two virtual speakers' world positions.
   */
  update(dt: number, listener: { position: Vec3; forward: Vec3; up: Vec3 }, speakers: [Vec3, Vec3]) {
    const ctx = this.ctx;
    const n = this.nodes;
    if (!ctx || !n) return;
    this.clock += dt;

    if (this.track && !this.el.paused) {
      // Wow and flutter.
      const rate = 1 + WOW.depth * Math.sin(2 * Math.PI * WOW.hz * this.clock) + FLUTTER.depth * Math.sin(2 * Math.PI * FLUTTER.hz * this.clock);
      if (Math.abs(this.el.playbackRate - rate) > 0.00005) this.el.playbackRate = rate;

      // Near the end of the snippet: start fading and tell the store, which
      // can start the next track now (a crossfade). At the end, stop.
      const left = this.end - this.el.currentTime;
      if (!this.fadingOut && left <= FADE_OUT) {
        this.fadingOut = true;
        this.players[this.a].fade!.gain.setTargetAtTime(0, ctx.currentTime, FADE_OUT / 4);
        this.dispatchEvent(new CustomEvent('ending', { detail: this.track }));
      }
      if (this.track && left <= 0.02 && !this.el.paused) {
        this.el.pause();
        this.setSurface(0, 0.2);
        this.dispatchEvent(new CustomEvent('ended', { detail: this.track }));
      }
    }

    // Loudness for visuals.
    n.analyser.getByteTimeDomainData(this.levelData);
    let sum = 0;
    for (let i = 0; i < this.levelData.length; i += 4) {
      const v = (this.levelData[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.min(1, Math.sqrt(sum / (this.levelData.length / 4)) * 3.2);
    this.level += (rms - this.level) * Math.min(1, dt * (rms > this.level ? 18 : 5));

    if (this.mode === 'stereo') return;
    const t = ctx.currentTime + 0.02;
    const L = ctx.listener;
    if (L.positionX) {
      L.positionX.setTargetAtTime(listener.position.x, t, 0.03);
      L.positionY.setTargetAtTime(listener.position.y, t, 0.03);
      L.positionZ.setTargetAtTime(listener.position.z, t, 0.03);
      L.forwardX.setTargetAtTime(listener.forward.x, t, 0.03);
      L.forwardY.setTargetAtTime(listener.forward.y, t, 0.03);
      L.forwardZ.setTargetAtTime(listener.forward.z, t, 0.03);
      L.upX.setTargetAtTime(listener.up.x, t, 0.03);
      L.upY.setTargetAtTime(listener.up.y, t, 0.03);
      L.upZ.setTargetAtTime(listener.up.z, t, 0.03);
    } else {
      // Firefox has only the older setter methods.
      const l = L as AudioListener & {
        setPosition(x: number, y: number, z: number): void;
        setOrientation(...v: number[]): void;
      };
      l.setPosition(listener.position.x, listener.position.y, listener.position.z);
      l.setOrientation(listener.forward.x, listener.forward.y, listener.forward.z, listener.up.x, listener.up.y, listener.up.z);
    }
    n.panners.forEach((p, i) => {
      p.positionX.setTargetAtTime(speakers[i].x, t, 0.03);
      p.positionY.setTargetAtTime(speakers[i].y, t, 0.03);
      p.positionZ.setTargetAtTime(speakers[i].z, t, 0.03);
    });
  }
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function once(el: HTMLMediaElement, type: string) {
  return new Promise<void>((resolve, reject) => {
    const ok = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error('media error')); };
    const cleanup = () => { el.removeEventListener(type, ok); el.removeEventListener('error', fail); };
    el.addEventListener(type, ok);
    el.addEventListener('error', fail);
  });
}

/* ---------------------------------------------------------------------------
 * Surface noise, modelled on a real record:
 *  - hiss: soft pink noise, band-limited like groove noise through a stylus
 *  - rumble: very low, slow noise from the motor and bearing
 *  - ticks: many tiny, dull clicks; now and then a louder pop
 *  - groove flaws: two clicks that come back on every revolution
 * The loop is a whole number of revolutions long, so the flaws stay in time.
 * ------------------------------------------------------------------------- */
function surfaceNoise(ctx: BaseAudioContext) {
  const sr = ctx.sampleRate;
  const revs = 9;
  const len = Math.floor(sr * REV * revs);
  const buf = ctx.createBuffer(2, len, sr);
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
  let rnd = 1234567;
  const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647) * 2 - 1;

  // Hiss (pink, per channel) and rumble (shared).
  for (const [ch, seed] of [[L, 7], [R, 11]] as const) {
    rnd = 1234567 * seed;
    let b0 = 0, b1 = 0, b2 = 0, hp = 0, lp = 0;
    for (let i = 0; i < len; i++) {
      const w = rand();
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      const pink = (b0 + b1 + b2 + w * 0.1848) * 0.11;
      hp += (pink - hp) * 0.03; // drop the lowest part of the hiss
      lp += (pink - hp - lp) * 0.45; // and the harshest top
      ch[i] = lp * 0.012;
    }
  }
  rnd = 42;
  let r1 = 0, r2 = 0;
  for (let i = 0; i < len; i++) {
    r1 += (rand() - r1) * 0.0012;
    r2 += (r1 - r2) * 0.0012;
    const rumble = r2 * 0.5;
    L[i] += rumble;
    R[i] += rumble;
  }

  // A click: a short, dull, ringing impulse, mostly in one groove wall.
  const click = (at: number, amp: number, width: number) => {
    const pan = 0.5 + rand() * 0.45;
    const ring = 0.55 + Math.random() * 0.3;
    let y = 0, v = amp;
    for (let j = 0; j < width * 6 && at + j < len; j++) {
      v *= -ring;
      y += (v - y) * (1 / width);
      L[at + j] += y * (1 - pan) * 2;
      R[at + j] += y * pan * 2;
    }
  };
  // Random ticks (many, small) and pops (few, bigger).
  const seconds = len / sr;
  for (let k = 0; k < seconds * 5; k++) click(Math.floor(Math.random() * len), 0.04 + Math.random() ** 3 * 0.12, 2 + Math.random() * 3);
  for (let k = 0; k < seconds * 0.35; k++) click(Math.floor(Math.random() * len), 0.18 + Math.random() * 0.25, 3 + Math.random() * 4);
  // Groove flaws, once per revolution.
  for (let r = 0; r < revs; r++) {
    click(Math.floor((r + 0.27) * REV * sr), 0.16, 3);
    click(Math.floor((r + 0.71) * REV * sr), 0.09, 2.5);
  }
  return buf;
}

/** A small, soft listening room. */
function roomImpulse(ctx: BaseAudioContext, seconds: number) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      // Darker as it decays, like soft furnishings absorbing the highs.
      const k = 0.5 - 0.42 * (i / len);
      lp += (Math.random() * 2 - 1 - lp) * k;
      d[i] = lp * Math.pow(1 - i / len, 4) * (i < 120 ? i / 120 : 1) * 0.6;
    }
  }
  return buf;
}

/* --- Mechanical sounds, synthesised once and cached ---------------------- */

function render(ctx: BaseAudioContext, seconds: number, fn: (t: number) => number) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = fn(i / ctx.sampleRate);
  return buf;
}

const SFX: Record<Sfx, (ctx: BaseAudioContext) => AudioBuffer> = {
  // The dust cover settling shut: a soft, damped knock.
  thud(ctx) {
    let lp = 0;
    return render(ctx, 0.25, (t) => {
      lp += (Math.random() * 2 - 1 - lp) * 0.08;
      return Math.sin(2 * Math.PI * 95 * t) * Math.exp(-t * 28) * 0.7 + lp * Math.exp(-t * 60) * 0.8;
    });
  },
  // A switch or the cue lever: a small, dull mechanical tick.
  click(ctx) {
    let lp = 0;
    return render(ctx, 0.05, (t) => {
      lp += (Math.random() * 2 - 1 - lp) * 0.35;
      return lp * Math.exp(-t * 260) * 0.9 + Math.sin(2 * Math.PI * 1400 * t) * Math.exp(-t * 220) * 0.15;
    });
  },
  // The record settling onto the rubber mat.
  drop(ctx) {
    let lp = 0;
    return render(ctx, 0.25, (t) => {
      lp += (Math.random() * 2 - 1 - lp) * 0.04;
      return Math.sin(2 * Math.PI * 120 * t) * Math.exp(-t * 35) * 0.45 + lp * Math.exp(-t * 30) * 1.2;
    });
  },
  // Stylus touchdown: a low, felt thump through the cartridge, then a short
  // scratch as the tip finds the groove.
  needle(ctx) {
    let lp = 0, hp = 0;
    return render(ctx, 0.3, (t) => {
      const w = Math.random() * 2 - 1;
      lp += (w - lp) * 0.3;
      hp += (lp - hp) * 0.08;
      const scratch = (lp - hp) * Math.exp(-Math.max(0, t - 0.012) * 90) * (t > 0.008 ? 0.35 : 0);
      return Math.sin(2 * Math.PI * 68 * t) * Math.exp(-t * 30) * 0.6 + scratch;
    });
  },
  // The record starting under the stylus: a faint creak of friction. Not a
  // tone, but stick-slip: irregular, grainy micro-clicks (the surfaces catch,
  // then let go) ringing through the deck's body at a few low resonances.
  // The clicks come a little faster as the platter gathers speed.
  squeak(ctx) {
    const sr = ctx.sampleRate;
    const seconds = 0.6;
    const len = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(1, len, sr);
    const out = buf.getChannelData(0);

    // The excitation: a train of tiny noise bursts at uneven intervals.
    const src = new Float32Array(len);
    let at = Math.floor(sr * 0.015);
    while (at < len) {
      const t = at / sr;
      const amp = (0.35 + Math.random() * 0.65) * (Math.random() < 0.12 ? 0.25 : 1);
      const width = Math.floor(sr * (0.0006 + Math.random() * 0.0012));
      for (let j = 0; j < width && at + j < len; j++) src[at + j] += (Math.random() * 2 - 1) * amp * (1 - j / width);
      // Intervals of ~24 ms shrinking to ~11 ms, with plenty of jitter.
      const gap = (0.024 - 0.013 * Math.min(1, t / 0.45)) * (0.6 + Math.random() * 0.8);
      at += Math.floor(sr * gap);
    }

    // The body: a few damped resonances (wood, plastic, the platter rim).
    const resonators = [
      { f: 320, q: 2.2, g: 1 },
      { f: 780, q: 2.6, g: 0.8 },
      { f: 1500, q: 2.2, g: 0.45 },
    ].map(({ f, q, g }) => {
      // RBJ band-pass, 0 dB peak gain.
      const w = (2 * Math.PI * f) / sr;
      const alpha = Math.sin(w) / (2 * q);
      const a0 = 1 + alpha;
      return { b0: alpha / a0, b2: -alpha / a0, a1: (-2 * Math.cos(w)) / a0, a2: (1 - alpha) / a0, g, x1: 0, x2: 0, y1: 0, y2: 0 };
    });
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const x = src[i];
      let y = 0;
      for (const r of resonators) {
        const v = r.b0 * x + r.b2 * r.x2 - r.a1 * r.y1 - r.a2 * r.y2;
        r.x2 = r.x1; r.x1 = x; r.y2 = r.y1; r.y1 = v;
        y += v * r.g;
      }
      lp += (y - lp) * 0.35; // soften the grain
      const t = i / sr;
      const env = Math.min(1, t / 0.06) * Math.min(1, (seconds - t) / 0.18);
      out[i] = lp * env;
    }
    // Normalise, so its level is set by SFX_LEVEL alone.
    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(out[i]));
    if (peak > 0) for (let i = 0; i < len; i++) out[i] /= peak;
    return buf;
  },
};

const SFX_LEVEL: Record<Sfx, number> = { thud: 0.22, click: 0.18, drop: 0.3, needle: 0.32, squeak: 0.09 };

export const engine = new AudioEngine();
