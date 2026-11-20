import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { engine } from '../audio/engine';
import { selectedAlbum, useStore } from '../state/store';
import type { Album } from '../types';
import { matTexture, PLATE, plateTexture, sleeveBackTexture, sleeveFrontTexture, vinylTexture } from './textures';

/* ----------------------------------------------------------------------------
 * Layout, in deck units (about a foot each). The top plate's surface is y = 0.
 * ------------------------------------------------------------------------- */
const W = 4.7;
const D = 3.6;
const RECORD_R = 1.48;
const RECORD_H = 0.018;
const PLATTER = new THREE.Vector3(-0.45, 0, 0.1);
const PLATTER_R = 1.56;
const RECORD_Y = 0.137; // record centre when it sits on the mat
const PIVOT = new THREE.Vector3(1.45, 0.27, -1.15);
const ARM_L = 2.25;
const LEAD_IN = 1.42;
const RUN_OUT = 0.62;
const REST_ANGLE = 0.03;
const RPM_33 = (33.333 / 60) * Math.PI * 2;
// The control column on the right, in one straight line (like the reference deck).
const COLUMN_X = 2.02;
const ANTI_SKATE: [number, number] = [COLUMN_X, -0.85];
const CUE: [number, number] = [COLUMN_X, -0.2];
const SPEED: [number, number] = [COLUMN_X, 0.45];
const POWER: [number, number] = [COLUMN_X, 1.15];
const BADGE: [number, number] = [-2.18, 1.5];
const HINGE_Z = -D / 2 + 0.02;
const LID_H = 0.8;
const LID_OPEN = 1.22; // about 70 degrees
const LIFT_UP = -0.085; // tonearm pitch when cued up (radians)
const DROP_H = 0.45; // the record is let go this far above the mat
// Where the sound comes from (invisible virtual speakers beside the deck).
const SPEAKERS = [new THREE.Vector3(-3.1, 1.1, -1.3), new THREE.Vector3(3.1, 1.1, -1.3)];

/* Physics constants (deck units, seconds, radians). */
const LID = { k: 30, c: 8.5, cClose: 11, gravity: 3.5, bounce: 0.22, max: 1.42 };
const ARM = { k: 26, c: 9 };
const CUE_RISE = 0.42; // rad/s: the cue lever lifts quickly...
const CUE_SINK = 3.6; // ...and lowers slowly, damped like a real hydraulic cue
const GRAVITY = 12;
const REST_BOUNCE = 0.18;
const WOBBLE = { k: 220, c: 6, kick: 0.06 };
const MOTOR = { spinUp: 2.2, coast: 2.4 }; // coast: the platter's brake when switched off

type Pose = { p: THREE.Vector3; q: THREE.Quaternion };
const pose = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): Pose => ({
  p: new THREE.Vector3(x, y, z),
  q: new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
});
const clonePose = (a: Pose): Pose => ({ p: a.p.clone(), q: a.q.clone() });
const SLEEVE_OFF = pose(3.0, -3.8, 5.6, 0.6, -0.4, 0.3);
const SLEEVE_HOVER = pose(1.0, 1.95, 0.35, -0.42, 0.12, 0);
const SLEEVE_EXIT = pose(5.6, 3.6, 0.6, -0.2, -0.7, -0.4);
const Q_UPRIGHT = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const ABOVE = new THREE.Vector3(PLATTER.x, RECORD_Y + DROP_H, PLATTER.z);

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeIn = (t: number) => t * t * t;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Tonearm yaw that puts the stylus `r` from the spindle. */
function armAngleFor(r: number) {
  const dx = PIVOT.x - PLATTER.x;
  const dz = PIVOT.z - PLATTER.z;
  const d = Math.hypot(dx, dz);
  const k = (r * r - d * d - ARM_L * ARM_L) / (2 * ARM_L * d);
  return Math.asin(Math.min(1, Math.max(-1, k))) - Math.atan2(dz, dx);
}

/** Groove radius for a moment in the album: grooves run inwards, track after track. */
function grooveAngle(album: Album, trackIndex: number, seconds: number) {
  const total = album.tracks.reduce((t, x) => t + x.duration, 0) || 1;
  const before = album.tracks.slice(0, trackIndex).reduce((t, x) => t + x.duration, 0);
  return armAngleFor(LEAD_IN - ((before + seconds) / total) * (LEAD_IN - RUN_OUT));
}

/** Where the record sits when pulled `amount` (0..1) out of the sleeve. */
function pulled(sleeve: Pose, amount: number, out: Pose, tmp: THREE.Vector3) {
  out.q.copy(sleeve.q).multiply(Q_UPRIGHT);
  out.p.copy(sleeve.p).add(tmp.set(-3.08 * amount, Math.sin(amount * Math.PI) * 0.2, 0).applyQuaternion(sleeve.q));
  return out;
}

interface Step {
  name: string;
  enter?: () => void;
  tick: (dt: number, t: number) => boolean; // true when done
}

export function Deck() {
  const albums = useStore((s) => s.albums);
  const selectedId = useStore((s) => s.selectedId);
  const dark = useStore((s) => s.theme === 'dark');
  const [shown, setShown] = useState<Album | null>(null);

  // Meshes we move every frame.
  const group = useRef<THREE.Group>(null!);
  const lid = useRef<THREE.Group>(null!);
  const sleeve = useRef<THREE.Mesh>(null!);
  const record = useRef<THREE.Mesh>(null!);
  const platter = useRef<THREE.Group>(null!);
  const armYaw = useRef<THREE.Group>(null!);
  const armPitch = useRef<THREE.Group>(null!);
  const cueLever = useRef<THREE.Group>(null!);
  const powerKnob = useRef<THREE.Group>(null!);
  const pilot = useRef<THREE.MeshStandardMaterial>(null!);

  // Everything physical about the deck.
  const P = useRef({
    phase: 'empty' as 'empty' | 'loading' | 'loaded' | 'unloading',
    album: null as Album | null,
    steps: [] as Step[],
    stepT: 0,
    entered: false,
    lid: 0, lidV: 0, lidOpen: false,
    arm: REST_ANGLE, armV: 0, armTarget: REST_ANGLE,
    lift: 0, cueUp: false, down: true, tracking: false,
    onLand: null as null | (() => void),
    spin: 0, angle: 0, power: false, knob: 0,
    sleeve: { visible: false, cur: clonePose(SLEEVE_OFF), from: clonePose(SLEEVE_OFF), to: clonePose(SLEEVE_OFF), t: 1, dur: 1, ease: easeOut },
    rec: { mode: 'hidden' as 'hidden' | 'sleeve' | 'free' | 'platter', slide: 0, y: 0, vy: 0, tilt: 0, tiltV: 0, from: clonePose(SLEEVE_HOVER), pos: new THREE.Vector3(), q: new THREE.Quaternion() },
  }).current;
  const tmp = useMemo(() => ({ v: new THREE.Vector3(), v2: new THREE.Vector3(), pose: pose(0, 0, 0), q: new THREE.Quaternion(), q2: new THREE.Quaternion() }), []);

  // Textures.
  const marks = useMemo(() => ({ antiSkate: ANTI_SKATE, cue: CUE, speed: SPEED, power: POWER, badge: BADGE, platter: [PLATTER.x, PLATTER.z, PLATTER_R] as [number, number, number] }), []);
  const plate = useMemo(() => plateTexture(dark, marks), [dark, marks]);
  const mat = useMemo(() => matTexture(), []);
  const tex = useMemo(() => (shown ? { vinyl: vinylTexture(shown), front: sleeveFrontTexture(shown), back: sleeveBackTexture(shown) } : null), [shown]);
  useEffect(() => () => plate.dispose(), [plate]);
  useEffect(() => () => { if (tex) Object.values(tex).forEach((t) => t.dispose()); }, [tex]);

  // Arm geometry: a straight tube with a gentle bend before the headshell.
  const armCurve = useMemo(
    () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, -0.34), new THREE.Vector3(0, 0, 1.2), new THREE.Vector3(0.07, 0, 1.7), new THREE.Vector3(0.035, -0.004, 2.0), new THREE.Vector3(0, -0.01, ARM_L - 0.2),
    ]), 64, 0.019, 12, false),
    [],
  );

  // If the chosen album was removed from the list, put the record away.
  useEffect(() => {
    if (selectedId && !albums.some((a) => a.id === selectedId)) useStore.getState().eject();
  }, [albums, selectedId]);

  /* --- Sleeve tween helpers --------------------------------------------- */
  const sleeveSet = (p: Pose) => {
    P.sleeve.cur = clonePose(p);
    P.sleeve.from = clonePose(p);
    P.sleeve.to = clonePose(p);
    P.sleeve.t = P.sleeve.dur = 1;
  };
  const sleeveTo = (p: Pose, dur: number, ease = easeInOut) => {
    P.sleeve.from = clonePose(P.sleeve.cur);
    P.sleeve.to = clonePose(p);
    P.sleeve.t = 0;
    P.sleeve.dur = dur;
    P.sleeve.ease = ease;
  };
  const sleeveDone = () => P.sleeve.t >= P.sleeve.dur;
  const recordPoseOnPlatter = (out: Pose) => {
    out.p.set(PLATTER.x, RECORD_Y, PLATTER.z);
    out.q.setFromAxisAngle(Y_AXIS, P.angle);
    return out;
  };
  const armSettled = () => Math.abs(P.arm - P.armTarget) < 0.005 && Math.abs(P.armV) < 0.03;

  /* --- The ritual: putting a record on --------------------------------- */
  const loadSteps = (album: Album): Step[] => [
    {
      name: 'open lid',
      enter: () => { P.lidOpen = true; },
      tick: () => P.lid > LID_OPEN * 0.45,
    },
    {
      name: 'sleeve in',
      enter: () => { P.sleeve.visible = true; sleeveSet(SLEEVE_OFF); sleeveTo(SLEEVE_HOVER, 0.7, easeOut); P.rec.mode = 'sleeve'; P.rec.slide = 0; },
      tick: () => sleeveDone(),
    },
    {
      name: 'slide out',
      tick: (_, t) => { P.rec.slide = easeInOut(clamp01(t / 0.55)); return t >= 0.55; },
    },
    {
      name: 'carry over the spindle',
      enter: () => { P.rec.from = clonePose(pulled(SLEEVE_HOVER, 1, tmp.pose, tmp.v)); P.rec.mode = 'free'; },
      tick: (_, t) => {
        const e = easeInOut(clamp01(t / 0.75));
        P.rec.pos.lerpVectors(P.rec.from.p, ABOVE, e);
        P.rec.pos.y += Math.sin(e * Math.PI) * 0.35;
        P.rec.q.slerpQuaternions(P.rec.from.q, tmp.q.setFromAxisAngle(Y_AXIS, P.angle), e);
        return t >= 0.75;
      },
    },
    {
      name: 'let go',
      // From here gravity takes over; the empty sleeve leaves.
      enter: () => { P.rec.mode = 'platter'; P.rec.y = DROP_H; P.rec.vy = 0; sleeveTo(SLEEVE_EXIT, 0.7, easeIn); },
      tick: (_, t) => t > 0.45 && P.rec.y === 0 && Math.abs(P.rec.vy) < 0.02 && Math.abs(P.rec.tilt) < 0.004,
    },
    {
      name: 'power on, cue up',
      enter: () => { P.sleeve.visible = false; P.power = true; P.cueUp = true; engine.sfx('click'); setTimeout(() => engine.sfx('click', 0.6), 180); },
      tick: (_, t) => t > 0.3 && P.lift <= LIFT_UP + 0.002,
    },
    {
      name: 'swing to the highlight',
      enter: () => {
        const s = useStore.getState();
        const track = album.tracks[s.trackIndex] ?? album.tracks[0];
        P.armTarget = grooveAngle(album, s.trackIndex, track.highlight);
      },
      tick: (_, t) => armSettled() || t > 2.5,
    },
    {
      name: 'lower the needle',
      enter: () => {
        P.cueUp = false;
        P.onLand = () => {
          P.tracking = true;
          const s = useStore.getState();
          if (s.selectedId === album.id) s.needleDown();
          // Close the dust cover once the needle is down.
          setTimeout(() => P.phase === 'loaded' && (P.lidOpen = false), 700);
        };
      },
      tick: () => P.down,
    },
  ];

  /* --- And taking it off again ----------------------------------------- */
  const unloadSteps = (): Step[] => [
    {
      name: 'open lid, cue up, power off',
      enter: () => {
        P.tracking = false;
        P.lidOpen = true;
        if (P.down && P.arm < REST_ANGLE - 0.1) { P.cueUp = true; engine.needleUp(); }
        P.power = false;
        setTimeout(() => engine.sfx('click'), 250);
      },
      tick: () => P.lid > LID_OPEN * 0.6 && (P.lift <= LIFT_UP + 0.002 || P.arm >= REST_ANGLE - 0.1),
    },
    {
      name: 'arm home',
      enter: () => { P.armTarget = REST_ANGLE; },
      tick: (_, t) => armSettled() || t > 2.5,
    },
    {
      name: 'arm onto its rest',
      enter: () => { P.cueUp = false; P.onLand = () => engine.sfx('click', 0.35); },
      tick: (_, t) => P.spin < 0.6 && t > 0.2,
    },
    {
      name: 'lift record, sleeve in',
      enter: () => {
        P.rec.from = clonePose(recordPoseOnPlatter(tmp.pose));
        P.rec.mode = 'free';
        P.sleeve.visible = true;
        sleeveSet(SLEEVE_OFF);
        sleeveTo(SLEEVE_HOVER, 0.7, easeOut);
      },
      tick: (_, t) => {
        const e = easeInOut(clamp01(t / 0.55));
        P.rec.pos.lerpVectors(P.rec.from.p, ABOVE, e);
        P.rec.q.copy(P.rec.from.q);
        return t >= 0.55 && sleeveDone();
      },
    },
    {
      name: 'carry back',
      enter: () => { P.rec.from = { p: ABOVE.clone(), q: P.rec.q.clone() }; },
      tick: (_, t) => {
        const e = easeInOut(clamp01(t / 0.7));
        const to = pulled(SLEEVE_HOVER, 1, tmp.pose, tmp.v);
        P.rec.pos.lerpVectors(P.rec.from.p, to.p, e);
        P.rec.pos.y += Math.sin(e * Math.PI) * 0.35;
        P.rec.q.slerpQuaternions(P.rec.from.q, to.q, e);
        return t >= 0.7;
      },
    },
    {
      name: 'slide in',
      enter: () => { P.rec.mode = 'sleeve'; P.rec.slide = 1; },
      tick: (_, t) => { P.rec.slide = 1 - easeInOut(clamp01(t / 0.45)); return t >= 0.45; },
    },
    {
      name: 'sleeve away',
      enter: () => {
        sleeveTo(SLEEVE_OFF, 0.6, easeIn);
        // Switching albums? Leave the lid open for the next record.
        if (!useStore.getState().selectedId) P.lidOpen = false;
      },
      tick: () => sleeveDone(),
    },
  ];

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 30);
    const s = useStore.getState();

    /* --- Decide what to do next ----------------------------------------- */
    if (!P.steps.length) {
      const wanted = s.selectedId;
      if (P.phase === 'empty' && wanted) {
        const album = selectedAlbum(s);
        if (album) {
          P.album = album;
          setShown(album);
          P.steps = loadSteps(album);
          P.phase = 'loading';
        }
      } else if (P.phase === 'loading') {
        P.phase = 'loaded';
      } else if (P.phase === 'loaded' && wanted !== P.album?.id) {
        P.steps = unloadSteps();
        P.phase = 'unloading';
      } else if (P.phase === 'unloading') {
        P.phase = 'empty';
        P.album = null;
        P.sleeve.visible = false;
        P.rec.mode = 'hidden';
        setShown(null);
      }
    }
    const step = P.steps[0];
    if (step) {
      if (!P.entered) { step.enter?.(); P.entered = true; P.stepT = 0; }
      P.stepT += dt;
      if (step.tick(dt, P.stepT)) { P.steps.shift(); P.entered = false; }
    }

    /* --- While playing: the arm follows the groove ---------------------- */
    if (P.tracking && P.album) {
      const album = P.album;
      const track = album.tracks[s.trackIndex];
      const at = engine.current?.id === track?.id ? engine.position : (track?.highlight ?? 0);
      const target = grooveAngle(album, s.trackIndex, at);
      const err = Math.abs(P.arm - target);
      if (P.down && (err > 0.03 || !s.playing)) {
        // Jumping to another track, or pausing: lift the needle first.
        P.cueUp = true;
        engine.needleUp();
      }
      if (P.down || P.lift <= LIFT_UP + 0.004) P.armTarget = target;
      if (P.cueUp && s.playing && err < 0.012 && Math.abs(P.armV) < 0.05) {
        P.cueUp = false;
        P.onLand = () => { engine.sfx('needle', 0.45); engine.leadIn(); };
      }
    }

    /* --- Dust cover: a hinged lid with gravity, damping and end stops --- */
    {
      const target = P.lidOpen ? LID_OPEN : 0;
      const c = P.lidOpen ? LID.c : LID.cClose;
      const acc = LID.k * (target - P.lid) - c * P.lidV - LID.gravity * Math.cos(P.lid) * (P.lidOpen ? 0.2 : 1);
      P.lidV += acc * dt;
      P.lid += P.lidV * dt;
      if (P.lid < 0) {
        const impact = -P.lidV;
        P.lid = 0;
        P.lidV = impact * LID.bounce;
        if (impact > 0.25) engine.sfx('thud', Math.min(1, impact / 2.5));
        if (P.lidV < 0.05) P.lidV = 0;
      }
      if (P.lid > LID.max) { P.lid = LID.max; P.lidV = -Math.abs(P.lidV) * 0.3; }
      lid.current.rotation.x = -P.lid;
    }

    /* --- Tonearm: a sprung, damped swing and the cue lever --------------- */
    {
      const canSwing = !P.down || P.tracking || P.arm >= REST_ANGLE - 0.01;
      if (canSwing) {
        P.armV += (ARM.k * (P.armTarget - P.arm) - ARM.c * P.armV) * dt;
        P.arm += P.armV * dt;
      }
      if (P.cueUp) {
        P.down = false;
        P.lift = Math.max(LIFT_UP, P.lift - CUE_RISE * dt);
      } else if (!P.down) {
        P.lift += (0 - P.lift) * (1 - Math.exp(-dt * CUE_SINK));
        if (P.lift > -0.0015) {
          P.lift = 0;
          P.down = true;
          P.armV = 0;
          const land = P.onLand;
          P.onLand = null;
          land?.();
        }
      }
      armYaw.current.rotation.y = P.arm;
      armPitch.current.rotation.x = P.lift;
      cueLever.current.rotation.x = THREE.MathUtils.damp(cueLever.current.rotation.x, P.cueUp ? -0.7 : 0, 12, dt);
    }

    /* --- Platter motor and the power knob ------------------------------- */
    P.spin = P.power ? P.spin + (RPM_33 - P.spin) * (1 - Math.exp(-dt * MOTOR.spinUp)) : P.spin * Math.exp(-dt * MOTOR.coast);
    if (P.spin < 0.005) P.spin = 0;
    P.angle += P.spin * dt;
    platter.current.rotation.y = P.angle;
    P.knob = THREE.MathUtils.damp(P.knob, P.power ? 1 : 0, 10, dt);
    powerKnob.current.rotation.y = (P.knob * Math.PI) / 4;
    pilot.current.emissiveIntensity = 0.1 + P.knob * 2.4;

    /* --- Sleeve ------------------------------------------------------------ */
    {
      const sl = P.sleeve;
      sl.t = Math.min(sl.dur, sl.t + dt);
      const e = sl.ease(clamp01(sl.t / sl.dur));
      sl.cur.p.lerpVectors(sl.from.p, sl.to.p, e);
      sl.cur.q.slerpQuaternions(sl.from.q, sl.to.q, e);
      sleeve.current.position.copy(sl.cur.p);
      sleeve.current.quaternion.copy(sl.cur.q);
      sleeve.current.visible = sl.visible && !!tex;
    }

    /* --- Record: in the sleeve, carried, or falling onto the platter ----- */
    {
      const r = P.rec;
      const rec = record.current;
      if (r.mode === 'sleeve') {
        const at = pulled(P.sleeve.cur, r.slide, tmp.pose, tmp.v);
        rec.position.copy(at.p);
        rec.quaternion.copy(at.q);
      } else if (r.mode === 'free') {
        rec.position.copy(r.pos);
        rec.quaternion.copy(r.q);
      } else if (r.mode === 'platter') {
        // Free fall, a small bounce on the mat, and a wobble that settles.
        if (r.y > 0 || r.vy > 0) {
          r.vy -= GRAVITY * dt;
          r.y += r.vy * dt;
          if (r.y <= 0) {
            const impact = -r.vy;
            r.y = 0;
            r.vy = impact > 0.3 ? impact * REST_BOUNCE : 0;
            r.tiltV += impact * WOBBLE.kick;
            if (impact > 0.4) engine.sfx('drop', Math.min(1, impact / 3.2));
          }
        }
        r.tiltV += (-WOBBLE.k * r.tilt - WOBBLE.c * r.tiltV) * dt;
        r.tilt += r.tiltV * dt;
        rec.position.set(PLATTER.x, RECORD_Y + r.y, PLATTER.z);
        rec.quaternion.setFromAxisAngle(Y_AXIS, P.angle).premultiply(tmp.q2.setFromAxisAngle(X_AXIS, r.tilt));
      }
      rec.visible = r.mode !== 'hidden' && !!tex;
    }

    /* --- Spatial audio: the camera is the listener's head --------------- */
    const cam = state.camera;
    const forward = cam.getWorldDirection(tmp.v2);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const world = SPEAKERS.map((v) => v.clone().add(group.current.position)) as [THREE.Vector3, THREE.Vector3];
    engine.update(dt, { position: cam.position, forward, up }, world);
  });

  /* --- Materials ---------------------------------------------------------- */
  const metal = dark ? '#b9a57f' : '#d4d6d9';
  const base = dark ? '#0b0b0c' : '#1c1c1e';
  const acrylic = (
    <meshPhysicalMaterial
      color={dark ? '#a9b0ba' : '#ffffff'}
      transparent
      opacity={dark ? 0.2 : 0.14}
      roughness={0.04}
      clearcoat={1}
      clearcoatRoughness={0.03}
      envMapIntensity={1.6}
      depthWrite={false}
      side={THREE.DoubleSide}
    />
  );

  return (
    <group ref={group}>
      {/* Plinth: a black base under a brushed top plate */}
      <RoundedBox args={[W, 0.3, D]} radius={0.06} smoothness={5} position={[0, -0.195, 0]}>
        <meshStandardMaterial color={base} metalness={0.4} roughness={0.5} />
      </RoundedBox>
      <mesh position={[0, -0.0225, 0]}>
        <boxGeometry args={[PLATE.w, 0.045, PLATE.d]} />
        <meshStandardMaterial attach="material-0" color={metal} metalness={0.9} roughness={0.35} />
        <meshStandardMaterial attach="material-1" color={metal} metalness={0.9} roughness={0.35} />
        <meshStandardMaterial attach="material-2" map={plate} metalness={0.78} roughness={0.42} />
        <meshStandardMaterial attach="material-3" color={metal} metalness={0.9} roughness={0.35} />
        <meshStandardMaterial attach="material-4" color={metal} metalness={0.9} roughness={0.35} />
        <meshStandardMaterial attach="material-5" color={metal} metalness={0.9} roughness={0.35} />
      </mesh>
      {[[-2.05, -1.5], [2.05, -1.5], [-2.05, 1.5], [2.05, 1.5]].map(([x, z]) => (
        <group key={`${x}${z}`} position={[x, -0.4, z]}>
          <mesh>
            <cylinderGeometry args={[0.2, 0.22, 0.1, 40]} />
            <meshStandardMaterial color={metal} metalness={1} roughness={0.3} />
          </mesh>
          <mesh position={[0, -0.06, 0]}>
            <cylinderGeometry args={[0.18, 0.18, 0.03, 40]} />
            <meshStandardMaterial color="#111" roughness={0.9} />
          </mesh>
        </group>
      ))}

      {/* Platter, rubber mat, spindle */}
      <group position={[PLATTER.x, 0, PLATTER.z]}>
        <group ref={platter}>
          <mesh position={[0, 0.07, 0]}>
            <cylinderGeometry args={[PLATTER_R, PLATTER_R, 0.1, 160]} />
            <meshStandardMaterial color="#c9ccd1" metalness={1} roughness={0.24} />
          </mesh>
          {Array.from({ length: 60 }, (_, i) => {
            const a = (i / 60) * Math.PI * 2;
            return (
              <mesh key={i} position={[Math.cos(a) * (PLATTER_R + 0.002), 0.07, Math.sin(a) * (PLATTER_R + 0.002)]} rotation={[0, -a, 0]}>
                <boxGeometry args={[0.004, 0.035, 0.04]} />
                <meshStandardMaterial color="#5d6168" metalness={0.8} roughness={0.35} />
              </mesh>
            );
          })}
          <mesh position={[0, 0.124, 0]}>
            <cylinderGeometry args={[1.5, 1.5, 0.008, 160]} />
            <meshStandardMaterial attach="material-0" color="#141416" roughness={0.95} />
            <meshStandardMaterial attach="material-1" map={mat} bumpMap={mat} bumpScale={1.5} roughness={0.92} />
            <meshStandardMaterial attach="material-2" color="#141416" roughness={0.95} />
          </mesh>
          <mesh position={[0, 0.17, 0]}>
            <cylinderGeometry args={[0.028, 0.028, 0.1, 24]} />
            <meshStandardMaterial color="#e6e8ec" metalness={1} roughness={0.1} />
          </mesh>
        </group>
      </group>

      {/* Tonearm base: a ball gimbal in a rounded housing */}
      <RoundedBox args={[0.5, 0.05, 0.5]} radius={0.08} smoothness={4} position={[PIVOT.x, 0.025, PIVOT.z]}>
        <meshStandardMaterial color="#1b1b1d" metalness={0.5} roughness={0.35} />
      </RoundedBox>
      <mesh position={[PIVOT.x, 0.15, PIVOT.z]}>
        <cylinderGeometry args={[0.05, 0.06, 0.22, 24]} />
        <meshStandardMaterial color="#26272a" metalness={0.8} roughness={0.3} />
      </mesh>
      {/* Arm rest with its cradle */}
      <group position={[PIVOT.x, 0, 0.86]}>
        <mesh position={[0, 0.11, 0]}>
          <cylinderGeometry args={[0.025, 0.03, 0.22, 16]} />
          <meshStandardMaterial color="#26272a" metalness={0.8} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.235, 0]}>
          <boxGeometry args={[0.09, 0.03, 0.05]} />
          <meshStandardMaterial color="#111" roughness={0.6} />
        </mesh>
      </group>
      <group ref={armYaw} position={PIVOT.toArray()}>
        <mesh>
          <sphereGeometry args={[0.1, 32, 20]} />
          <meshStandardMaterial color="#0f0f10" metalness={0.6} roughness={0.22} />
        </mesh>
        <group ref={armPitch}>
          <mesh geometry={armCurve}>
            <meshStandardMaterial color="#2b2c2f" metalness={0.9} roughness={0.28} />
          </mesh>
          {/* Counterweight: brushed, with a knurled ring and a scale */}
          <group position={[0, 0, -0.5]} rotation={[Math.PI / 2, 0, 0]}>
            <mesh>
              <cylinderGeometry args={[0.1, 0.1, 0.24, 40]} />
              <meshStandardMaterial color="#c3c6cb" metalness={1} roughness={0.32} />
            </mesh>
            {[-0.06, -0.04, -0.02].map((y) => (
              <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.1, 0.006, 6, 40]} />
                <meshStandardMaterial color="#8e9297" metalness={1} roughness={0.4} />
              </mesh>
            ))}
            <mesh position={[0, 0.125, 0]}>
              <cylinderGeometry args={[0.08, 0.1, 0.02, 40]} />
              <meshStandardMaterial color="#2b2c2f" metalness={0.8} roughness={0.3} />
            </mesh>
          </group>
          {/* Headshell, finger lift and cartridge */}
          <group position={[0, -0.01, ARM_L - 0.04]} rotation={[0, 0.28, 0]}>
            <mesh>
              <boxGeometry args={[0.13, 0.02, 0.3]} />
              <meshStandardMaterial color="#1a1a1c" metalness={0.5} roughness={0.3} />
            </mesh>
            <mesh position={[0.11, 0.01, 0.06]} rotation={[0, 0, -0.35]}>
              <boxGeometry args={[0.12, 0.012, 0.03]} />
              <meshStandardMaterial color="#1a1a1c" metalness={0.5} roughness={0.3} />
            </mesh>
            <mesh position={[0, -0.05, 0.04]}>
              <boxGeometry args={[0.075, 0.07, 0.12]} />
              <meshStandardMaterial color="#e2572b" roughness={0.45} />
            </mesh>
            <mesh position={[0, -0.1, 0.08]} rotation={[Math.PI, 0, 0]}>
              <coneGeometry args={[0.008, 0.03, 8]} />
              <meshStandardMaterial color="#ddd" metalness={1} roughness={0.1} />
            </mesh>
          </group>
        </group>
      </group>

      {/* Cue lever */}
      <group position={[CUE[0], 0, CUE[1]]}>
        <group ref={cueLever} position={[0, 0, 0.06]}>
          <mesh position={[0, 0.06, -0.02]}>
            <boxGeometry args={[0.034, 0.12, 0.034]} />
            <meshStandardMaterial color="#141416" roughness={0.4} metalness={0.3} />
          </mesh>
          <mesh position={[0, 0.125, -0.02]}>
            <boxGeometry args={[0.05, 0.02, 0.07]} />
            <meshStandardMaterial color="#141416" roughness={0.4} metalness={0.3} />
          </mesh>
        </group>
      </group>

      {/* Anti-skating: a small black knob */}
      <group position={[ANTI_SKATE[0], 0, ANTI_SKATE[1]]}>
        <mesh position={[0, 0.035, 0]}>
          <cylinderGeometry args={[0.075, 0.08, 0.07, 32]} />
          <meshStandardMaterial color="#141416" roughness={0.45} />
        </mesh>
        <mesh position={[0, 0.071, 0.045]}>
          <boxGeometry args={[0.008, 0.002, 0.05]} />
          <meshStandardMaterial color="#f2f2f0" />
        </mesh>
      </group>
      {/* Speed: a white teardrop selector, pointing straight down at 33 */}
      <group position={[SPEED[0], 0, SPEED[1]]}>
        <mesh position={[0, 0.03, 0]}>
          <cylinderGeometry args={[0.085, 0.09, 0.06, 40]} />
          <meshStandardMaterial color="#efeeea" roughness={0.35} />
        </mesh>
        <mesh position={[0, 0.03, 0.1]} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.05, 0.14, 24]} />
          <meshStandardMaterial color="#efeeea" roughness={0.35} />
        </mesh>
      </group>
      {/* Power: a red teardrop knob and its pilot light */}
      <group ref={powerKnob} position={[POWER[0], 0, POWER[1]]}>
        <mesh position={[0, 0.03, 0]}>
          <cylinderGeometry args={[0.085, 0.09, 0.06, 40]} />
          <meshStandardMaterial color="#d8341f" roughness={0.38} />
        </mesh>
        <mesh position={[0, 0.03, 0.1]} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.05, 0.14, 24]} />
          <meshStandardMaterial color="#d8341f" roughness={0.38} />
        </mesh>
      </group>
      <mesh position={[POWER[0] + 0.19, 0.012, POWER[1] - 0.215]}>
        <sphereGeometry args={[0.022, 16, 12]} />
        <meshStandardMaterial ref={pilot} color="#3a1a10" emissive="#ff6a2b" emissiveIntensity={0.1} toneMapped={false} />
      </mesh>

      {/* Dust cover: clear acrylic, hinged at the back */}
      {[-1.7, 1.7].map((x) => (
        <mesh key={x} position={[x, 0.03, HINGE_Z - 0.04]}>
          <boxGeometry args={[0.32, 0.07, 0.09]} />
          <meshStandardMaterial color="#141416" metalness={0.5} roughness={0.4} />
        </mesh>
      ))}
      <group ref={lid} position={[0, 0.005, HINGE_Z]}>
        <mesh position={[0, LID_H, (D - 0.04) / 2]} renderOrder={2}>
          <boxGeometry args={[W - 0.08, 0.02, D - 0.04]} />
          {acrylic}
        </mesh>
        <mesh position={[0, LID_H / 2, D - 0.05]} renderOrder={2}>
          <boxGeometry args={[W - 0.08, LID_H, 0.02]} />
          {acrylic}
        </mesh>
        <mesh position={[0, LID_H / 2, 0.01]} renderOrder={2}>
          <boxGeometry args={[W - 0.08, LID_H, 0.02]} />
          {acrylic}
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * (W / 2 - 0.05), LID_H / 2, (D - 0.04) / 2]} renderOrder={2}>
            <boxGeometry args={[0.02, LID_H, D - 0.04]} />
            {acrylic}
          </mesh>
        ))}
      </group>

      {/* Sleeve and record */}
      <mesh ref={sleeve} visible={false}>
        <boxGeometry args={[3.12, 3.12, 0.045]} />
        <meshStandardMaterial attach="material-0" color="#16171b" roughness={0.7} />
        <meshStandardMaterial attach="material-1" color="#16171b" roughness={0.7} />
        <meshStandardMaterial attach="material-2" color="#16171b" roughness={0.7} />
        <meshStandardMaterial attach="material-3" color="#16171b" roughness={0.7} />
        <meshStandardMaterial attach="material-4" map={tex?.front ?? null} roughness={0.72} envMapIntensity={0.45} />
        <meshStandardMaterial attach="material-5" map={tex?.back ?? null} roughness={0.75} />
      </mesh>
      <mesh ref={record} visible={false}>
        <cylinderGeometry args={[RECORD_R, RECORD_R, RECORD_H, 160, 1]} />
        <meshPhysicalMaterial attach="material-0" color={shown?.vinyl ?? '#111'} roughness={0.3} clearcoat={1} />
        <meshPhysicalMaterial attach="material-1" map={tex?.vinyl ?? null} roughness={0.42} clearcoat={1} clearcoatRoughness={0.18} />
        <meshPhysicalMaterial attach="material-2" map={tex?.vinyl ?? null} roughness={0.42} clearcoat={1} clearcoatRoughness={0.18} />
      </mesh>
    </group>
  );
}
