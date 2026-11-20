import { useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '../state/store';
import { Deck } from './Deck';

const TARGET = new THREE.Vector3(0, 0.75, -0.4);
// Looking down about 34 degrees, slightly from the right.
const VIEW_DIR = new THREE.Vector3(0.1, 0.56, 0.82).normalize();

/**
 * Frames the deck as the page's centrepiece. The picture is nudged up a
 * little (a view offset) so the deck sits above the caption and dock,
 * while orbiting still turns around the deck itself.
 */
function CameraRig() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const { width, height } = useThree((s) => s.size);
  const portrait = height > width * 1.05;
  // Far enough that the deck (plus its speakers) fits the screen's width.
  // Generous margins: the deck should breathe, and the open lid needs headroom.
  const fit = (portrait ? 3.3 : 4.3) / (Math.tan(THREE.MathUtils.degToRad(16)) * (width / height));
  const distance = Math.round(Math.min(32, Math.max(14.5, fit)) * 2) / 2;

  useEffect(() => {
    camera.position.copy(TARGET).addScaledVector(VIEW_DIR, distance);
    camera.lookAt(TARGET);
  }, [camera, distance]);

  useEffect(() => {
    // A little above centre, leaving room for the caption and dock below.
    const up = portrait ? Math.round(height * 0.04) : Math.round(height * 0.045);
    camera.setViewOffset(width, height, 0, up, width, height);
    camera.updateProjectionMatrix();
  }, [camera, portrait, width, height]);

  return (
    <OrbitControls
      makeDefault
      target={TARGET}
      enablePan={false}
      enableDamping
      dampingFactor={0.06}
      rotateSpeed={0.55}
      zoomSpeed={0.6}
      minDistance={distance * 0.55}
      maxDistance={distance * 1.45}
      minPolarAngle={0.3}
      maxPolarAngle={1.32}
      minAzimuthAngle={-1.15}
      maxAzimuthAngle={1.15}
    />
  );
}

export function Scene() {
  const dark = useStore((s) => s.theme === 'dark');
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ fov: 32, near: 0.1, far: 90, position: TARGET.clone().addScaledVector(VIEW_DIR, 10.5).toArray() }}
      // Transparent, so the page (and the wordmark behind it) shows through.
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      aria-label="3D turntable. Drag to look around."
    >
      {/* Studio lighting built in-scene, so nothing is fetched. */}
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={2.4} position={[0, 6, 1]} rotation-x={Math.PI / 2} scale={[12, 5, 1]} />
        <Lightformer form="rect" intensity={1.5} position={[-7, 2.5, 1]} rotation-y={Math.PI / 2} scale={[8, 2, 1]} color="#dfe5ff" />
        <Lightformer form="rect" intensity={1.2} position={[7, 2.5, -1]} rotation-y={-Math.PI / 2} scale={[8, 2, 1]} color="#ffe6cf" />
        <Lightformer form="ring" intensity={1.6} position={[0, 3, -7]} scale={4} />
      </Environment>
      <ambientLight intensity={dark ? 0.12 : 0.35} />
      <directionalLight position={[-4, 7, 3]} intensity={dark ? 1.1 : 1.4} />

      <Deck />

      {/* A big, soft shadow on the page, offset like a low lamp from the right. */}
      <ContactShadows position={[-0.25, -0.465, 0.1]} opacity={dark ? 0.75 : 0.32} scale={14} blur={2.6} far={0.9} resolution={512} color={dark ? '#000000' : '#3b302b'} />

      <CameraRig />
    </Canvas>
  );
}
