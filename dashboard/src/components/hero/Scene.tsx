import { Float, Html, Line, Sparkles } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

/**
 * The hero's 3D scene: Base and Unichain as two bodies that never touch, the Reactive ledger between
 * them, and value streaming only through the ledger. Lazy-loaded so three.js never blocks first paint.
 */

const BLUE = new THREE.Color("#4C8DFF");
const CYAN = new THREE.Color("#22D3EE");
const PINK = new THREE.Color("#FF4FA3");

const POS = {
  base: new THREE.Vector3(-3.1, -0.35, 0),
  lasna: new THREE.Vector3(0, 0.55, -0.6),
  unichain: new THREE.Vector3(3.1, -0.35, 0),
};

function Body({ position, color, radius, ring, label, role, above }: { position: THREE.Vector3; color: THREE.Color; radius: number; ring?: boolean; label: string; role: string; above?: boolean }) {
  const ringRef = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (ringRef.current) ringRef.current.rotation.z += dt * 0.25;
  });
  return (
    <Float speed={1.2} rotationIntensity={0.15} floatIntensity={0.35}>
      <group position={position}>
        {/* core: unlit and not tone-mapped so the chain color stays saturated */}
        <mesh>
          <sphereGeometry args={[radius, 48, 48]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
        <mesh scale={0.62}>
          <sphereGeometry args={[radius, 32, 32]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.35} toneMapped={false} />
        </mesh>
        <Html center position={[0, above ? radius * 3.4 : -radius * 3.2, 0]} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
          <div style={{ textAlign: "center", whiteSpace: "nowrap", fontFamily: "var(--font-sans)" }}>
            <div style={{ color: `#${color.getHexString()}`, fontSize: 14, fontWeight: 600 }}>{label}</div>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>{role}</div>
          </div>
        </Html>
        {/* soft halo layers fake a bloom without a post-processing pass */}
        {[1.6, 2.4, 3.6].map((s, i) => (
          <mesh key={s}>
            <sphereGeometry args={[radius * s, 32, 32]} />
            <meshBasicMaterial color={color} transparent opacity={[0.16, 0.07, 0.03][i]} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
        ))}
        {ring && (
          <mesh ref={ringRef} rotation={[Math.PI / 2.4, 0, 0]}>
            <torusGeometry args={[radius * 2.1, 0.012, 16, 160]} />
            <meshBasicMaterial color={color} transparent opacity={0.55} blending={THREE.AdditiveBlending} />
          </mesh>
        )}
      </group>
    </Float>
  );
}

/** Particles flowing along one curve. Colors blend from the source chain to the destination. */
function Stream({ from, to, lift, count, speed, colorFrom, colorTo, phase }: {
  from: THREE.Vector3;
  to: THREE.Vector3;
  lift: number;
  count: number;
  speed: number;
  colorFrom: THREE.Color;
  colorTo: THREE.Color;
  phase: number;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const curve = useMemo(() => {
    const mid = from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, lift, 0.4));
    return new THREE.QuadraticBezierCurve3(from, mid, to);
  }, [from, to, lift]);
  const offsets = useMemo(() => Array.from({ length: count }, (_, i) => i / count + Math.random() * 0.02), [count]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const tmp = useMemo(() => new THREE.Color(), []);

  useEffect(() => {
    if (!mesh.current) return;
    offsets.forEach((o, i) => mesh.current!.setColorAt(i, tmp.copy(colorFrom).lerp(colorTo, o)));
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  }, [offsets, colorFrom, colorTo, tmp]);

  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    const t = clock.getElapsedTime() * speed + phase;
    for (let i = 0; i < count; i++) {
      const u = (offsets[i] + t) % 1;
      const p = curve.getPoint(u);
      dummy.position.copy(p);
      const s = 0.025 + Math.sin(u * Math.PI) * 0.035; // swell mid-flight
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      m.setColorAt(i, tmp.copy(colorFrom).lerp(colorTo, u));
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 10, 10]} />
      <meshBasicMaterial transparent opacity={0.9} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
    </instancedMesh>
  );
}

/** Faint guide arcs so the routes read even between particles. */
function Arc({ from, to, lift, color }: { from: THREE.Vector3; to: THREE.Vector3; lift: number; color: THREE.Color }) {
  const pts = useMemo(() => {
    const mid = from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, lift, 0.4));
    return new THREE.QuadraticBezierCurve3(from, mid, to).getPoints(64);
  }, [from, to, lift]);
  return <Line points={pts} color={color} lineWidth={1} transparent opacity={0.22} />;
}

/** Pulls the camera back on narrow screens so all three bodies stay in frame. */
function Fit() {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    // Half-width the scene needs (outer bodies at ±3.1 plus halo and label), solved for camera distance.
    const halfFov = ((camera as THREE.PerspectiveCamera).fov * Math.PI) / 360;
    camera.position.z = Math.max(7.2, 4.4 / (Math.tan(halfFov) * aspect));
    camera.updateProjectionMatrix();
  }, [camera, size]);
  return null;
}

/** Slow parallax toward the pointer. */
function Rig() {
  const { camera, pointer } = useThree();
  useFrame(() => {
    camera.position.x += (pointer.x * 0.6 - camera.position.x) * 0.03;
    camera.position.y += (0.4 + pointer.y * 0.35 - camera.position.y) * 0.03;
    camera.lookAt(0, 0, 0);
  });
  return null;
}

/** Turns and tilts the whole system as the hero scrolls away. */
function ScrollSpin({ scroll, children }: { scroll: { current: number }; children: React.ReactNode }) {
  const g = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!g.current) return;
    const t = scroll.current;
    g.current.rotation.y += (t * 0.9 - g.current.rotation.y) * 0.08;
    g.current.rotation.x += (t * 0.35 - g.current.rotation.x) * 0.08;
    g.current.position.z += (-t * 2.2 - g.current.position.z) * 0.08;
  });
  return <group ref={g}>{children}</group>;
}

export default function Scene({ still, scroll, onReady }: { still: boolean; scroll: { current: number }; onReady?: () => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);

  // Stop rendering when the hero scrolls out of view to save battery.
  useEffect(() => {
    if (!wrap.current) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.01 });
    io.observe(wrap.current);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={wrap} className="absolute inset-0">
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, 0.4, 7.2], fov: 42 }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        frameloop={still || !visible ? "demand" : "always"}
        onCreated={() => requestAnimationFrame(() => onReady?.())}
      >
        <Fit />
        <ambientLight intensity={0.35} />
        <pointLight position={[0, 3, 4]} intensity={18} color="#ffffff" />
        <ScrollSpin scroll={scroll}>
        <Body position={POS.base} color={BLUE} radius={0.42} label="Base" role="Your collateral" />
        <Body position={POS.lasna} color={CYAN} radius={0.3} ring label="Reactive" role="The shared ledger" above />
        <Body position={POS.unichain} color={PINK} radius={0.42} label="Unichain" role="Your credit" />

        <Arc from={POS.base} to={POS.lasna} lift={0.9} color={BLUE} />
        <Arc from={POS.lasna} to={POS.unichain} lift={0.9} color={PINK} />
        <Arc from={POS.unichain} to={POS.lasna} lift={-1.1} color={PINK} />
        <Arc from={POS.lasna} to={POS.base} lift={-1.1} color={BLUE} />

        <Stream from={POS.base} to={POS.lasna} lift={0.9} count={26} speed={0.16} colorFrom={BLUE} colorTo={CYAN} phase={0} />
        <Stream from={POS.lasna} to={POS.unichain} lift={0.9} count={26} speed={0.16} colorFrom={CYAN} colorTo={PINK} phase={0.5} />
        <Stream from={POS.unichain} to={POS.lasna} lift={-1.1} count={18} speed={0.12} colorFrom={PINK} colorTo={CYAN} phase={0.2} />
        <Stream from={POS.lasna} to={POS.base} lift={-1.1} count={18} speed={0.12} colorFrom={CYAN} colorTo={BLUE} phase={0.7} />

        </ScrollSpin>
        <Sparkles count={90} scale={[12, 6, 4]} size={1.6} speed={0.25} opacity={0.35} color="#9fb4d9" />
        {!still && <Rig />}
      </Canvas>
    </div>
  );
}
