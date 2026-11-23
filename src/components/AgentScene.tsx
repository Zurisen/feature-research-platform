"use client";

import { OrbitControls, QuadraticBezierLine } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { AgentState, deriveAgents, deriveTeam, DEVELOPER_ID, pulsesFor, SCEPTIC_ID, SceneAgent, TeamMember } from "@/lib/scene";
import type { Project, Run } from "@/lib/types";

// Realtime view of a run: the developer team in the centre (a glass sphere with its agents moving
// inside), lead agents around it, and messages travelling between them as events arrive. Purely a
// projection of the polled run state.

const PULSE_MS = 1400;
const HEAD_Y = 1.25;
const TEAM_Y = 1.55; // centre of the team sphere above the pedestal
const TEAM_R = 1.75;

type Pulse = { id: number; from: THREE.Vector3; to: THREE.Vector3; color: string; start: number };
type Theme = { border: string; muted: string; good: string; bad: string; surface: string; dark: boolean };

function useTheme(): Theme {
  const read = (): Theme => {
    const css = getComputedStyle(document.documentElement);
    const v = (n: string, d: string) => css.getPropertyValue(n).trim() || d;
    return { border: v("--border", "#444"), muted: v("--muted", "#888"), good: v("--good", "#2b8a3e"), bad: v("--bad", "#c92a2a"), surface: v("--surface", "#fff"), dark: window.matchMedia("(prefers-color-scheme: dark)").matches };
  };
  const [theme, setTheme] = useState<Theme>(read);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setTheme(read());
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return theme;
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

function layout(agents: SceneAgent[]): Map<string, THREE.Vector3> {
  const pos = new Map<string, THREE.Vector3>();
  const leads = agents.filter((a) => a.role === "lead");
  pos.set(DEVELOPER_ID, new THREE.Vector3(0, 0.35, 0));
  pos.set(SCEPTIC_ID, new THREE.Vector3(2.5, 0, 1.4)); // inside the ring, beside the developer
  leads.forEach((a, i) => {
    // Go round from the front, offset by half a step so no lead stands directly in front of the developer.
    const angle = Math.PI / 2 + ((i + 0.5) / Math.max(leads.length, 1)) * Math.PI * 2;
    pos.set(a.id, new THREE.Vector3(Math.cos(angle) * 5.6, 0, Math.sin(angle) * 4));
  });
  return pos;
}

const STATE_WORD: Record<AgentState, string> = { idle: "Waiting", working: "Working", done: "Done", error: "Failed" };

function Figure({ agent, position, theme, reduced }: { agent: SceneAgent; position: THREE.Vector3; theme: Theme; reduced: boolean }) {
  const body = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const seed = useMemo(() => [...agent.id].reduce((a, c) => a + c.charCodeAt(0), 0) % 7, [agent.id]);
  const working = agent.state === "working";
  const big = agent.role === "developer" ? 1.35 : 1;
  const ringColor = agent.state === "done" ? theme.good : agent.state === "error" ? theme.bad : working ? agent.color : theme.muted;

  useFrame(({ clock }) => {
    const t = clock.elapsedTime + seed;
    if (body.current) body.current.position.y = working && !reduced ? Math.abs(Math.sin(t * 3)) * 0.14 : 0;
    if (ring.current) {
      ring.current.rotation.z = working && !reduced ? -t * 2 : 0;
      ring.current.scale.setScalar(working && !reduced ? 1 + Math.sin(t * 4) * 0.05 : 1);
    }
  });

  return (
    <group position={position} scale={big}>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <torusGeometry key={working ? "arc" : "full"} args={[0.78, 0.05, 12, 64, working ? Math.PI * 1.5 : Math.PI * 2]} />
        <meshBasicMaterial color={ringColor} />
      </mesh>
      <group ref={body}>
        <mesh position={[0, 0.62, 0]}>
          <capsuleGeometry args={[0.3, 0.5, 8, 20]} />
          <meshStandardMaterial color={agent.color} emissive={agent.color} emissiveIntensity={working ? 0.55 : 0.1} roughness={0.45} opacity={agent.state === "idle" ? 0.55 : 1} transparent />
        </mesh>
        <mesh position={[0, HEAD_Y + 0.12, 0]}>
          <sphereGeometry args={[0.26, 28, 28]} />
          <meshStandardMaterial color={agent.color} emissive={agent.color} emissiveIntensity={working ? 0.55 : 0.1} roughness={0.45} opacity={agent.state === "idle" ? 0.55 : 1} transparent />
        </mesh>
      </group>
    </group>
  );
}

/** A small figure that wanders inside the team sphere: quickly while working, slowly otherwise. */
function Member({ member, index, count, reduced }: { member: TeamMember; index: number; count: number; reduced: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const phase = useRef(index * 1.7);
  // A resting spot on a small ring, used for reduced motion and as the centre of each wander.
  const home = useMemo(() => {
    const a = (index / Math.max(count, 1)) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a) * 0.7, (index % 3) * 0.35 - 0.1, Math.sin(a) * 0.7);
  }, [index, count]);
  const working = member.state === "working";
  const scale = member.kind === "lead" ? 0.62 : 0.48;

  useFrame((_, dt) => {
    if (!ref.current) return;
    if (reduced) {
      ref.current.position.copy(home);
      return;
    }
    phase.current += dt * (working ? 0.9 : member.state === "idle" ? 0.25 : 0.15);
    const t = phase.current;
    const p = ref.current.position;
    // Sums of sines at unrelated frequencies give a smooth path that does not visibly repeat.
    p.set(
      home.x + Math.sin(t * 1.3 + index) * 0.45 + Math.sin(t * 0.7 + index * 2) * 0.2,
      home.y + Math.sin(t * 1.1 + index * 3) * 0.5,
      home.z + Math.cos(t * 0.9 + index) * 0.45 + Math.cos(t * 1.7 + index * 5) * 0.15,
    );
    const limit = TEAM_R - 0.7; // keep the whole figure inside the glass
    if (p.length() > limit) p.setLength(limit);
    // Face the direction of travel.
    ref.current.rotation.y = Math.atan2(Math.cos(t * 1.3 + index), -Math.sin(t * 0.9 + index));
    ref.current.rotation.z = working ? Math.sin(t * 6) * 0.12 : 0;
  });

  const glow = working ? 0.6 : 0.08;
  const opacity = member.state === "idle" ? 0.45 : 1;
  return (
    <group ref={ref} position={home} scale={scale}>
      <mesh position={[0, -0.35, 0]}>
        <capsuleGeometry args={[0.3, 0.5, 8, 16]} />
        <meshStandardMaterial color={member.color} emissive={member.color} emissiveIntensity={glow} roughness={0.45} transparent opacity={opacity} />
      </mesh>
      <mesh position={[0, 0.4, 0]}>
        <sphereGeometry args={[0.26, 20, 20]} />
        <meshStandardMaterial color={member.color} emissive={member.color} emissiveIntensity={glow} roughness={0.45} transparent opacity={opacity} />
      </mesh>
      {member.state === "error" && (
        <mesh position={[0, 0.95, 0]}>
          <sphereGeometry args={[0.12, 12, 12]} />
          <meshBasicMaterial color="#e34948" />
        </mesh>
      )}
    </group>
  );
}

/** The developer team: a glass sphere on the pedestal with each of its agents moving inside. */
function Team({ agent, team, position, theme, reduced }: { agent: SceneAgent; team: TeamMember[]; position: THREE.Vector3; theme: Theme; reduced: boolean }) {
  const ring = useRef<THREE.Mesh>(null);
  const glass = useRef<THREE.Mesh>(null);
  const working = team.some((m) => m.state === "working");
  const ringColor = agent.state === "done" ? theme.good : agent.state === "error" ? theme.bad : working ? theme.muted : theme.border;

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (ring.current) ring.current.rotation.z = working && !reduced ? -t * 1.5 : 0;
    if (glass.current) glass.current.scale.setScalar(working && !reduced ? 1 + Math.sin(t * 2.2) * 0.012 : 1);
  });

  return (
    <group position={position}>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <torusGeometry key={working ? "arc" : "full"} args={[1.45, 0.05, 12, 80, working ? Math.PI * 1.5 : Math.PI * 2]} />
        <meshBasicMaterial color={ringColor} />
      </mesh>
      <group position={[0, TEAM_Y, 0]}>
        {/* Glass: a faint inner face for depth and a brighter outer face, both without writing depth so the figures stay visible. */}
        <mesh ref={glass} renderOrder={2}>
          <sphereGeometry args={[TEAM_R, 48, 48]} />
          <meshPhysicalMaterial
            color={theme.dark ? "#cfe9e8" : "#e8f3f3"}
            roughness={0.08}
            metalness={0}
            clearcoat={1}
            transparent
            opacity={theme.dark ? 0.14 : 0.22}
            depthWrite={false}
          />
        </mesh>
        <mesh renderOrder={1}>
          <sphereGeometry args={[TEAM_R * 0.995, 48, 48]} />
          <meshBasicMaterial color={theme.muted} transparent opacity={0.06} side={THREE.BackSide} depthWrite={false} />
        </mesh>
        {team.map((m, i) => (
          <Member key={m.id} member={m} index={i} count={team.length} reduced={reduced} />
        ))}
      </group>
    </group>
  );
}

type LabelRefs = React.RefObject<Map<string, HTMLDivElement>>;

/** Keeps the DOM labels (rendered outside the canvas) pinned above each agent's head. */
function LabelProjector({ agents, pos, labels }: { agents: SceneAgent[]; pos: Map<string, THREE.Vector3>; labels: LabelRefs }) {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    for (const a of agents) {
      const el = labels.current.get(a.id);
      const base = pos.get(a.id);
      if (!el || !base) continue;
      v.set(base.x, base.y + (a.role === "developer" ? TEAM_Y + TEAM_R + 0.2 : HEAD_Y + 0.55), base.z).project(camera);
      const x = (v.x * 0.5 + 0.5) * size.width;
      const y = (-v.y * 0.5 + 0.5) * size.height;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      el.style.zIndex = String(Math.round((1 - v.z) * 100000)); // nearer agents on top
      el.style.visibility = "visible";
    }
  });
  return null;
}

function arcMid(a: THREE.Vector3, b: THREE.Vector3) {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  mid.y += 1.2 + a.distanceTo(b) * 0.18;
  return mid;
}

function PulseDot({ pulse, reduced }: { pulse: Pulse; reduced: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const mid = useMemo(() => arcMid(pulse.from, pulse.to), [pulse]);
  useFrame(() => {
    if (!ref.current) return;
    const k = Math.min(1, Math.max(0, (performance.now() - pulse.start) / PULSE_MS));
    const e = reduced ? 1 : k * k * (3 - 2 * k);
    ref.current.position
      .copy(pulse.from)
      .multiplyScalar((1 - e) * (1 - e))
      .addScaledVector(mid, 2 * (1 - e) * e)
      .addScaledVector(pulse.to, e * e);
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.13, 16, 16]} />
      <meshBasicMaterial color={pulse.color} />
    </mesh>
  );
}

function World({
  agents,
  team,
  pulses,
  theme,
  reduced,
  live,
  labels,
}: {
  agents: SceneAgent[];
  team: TeamMember[];
  pulses: Pulse[];
  theme: Theme;
  reduced: boolean;
  live: boolean;
  labels: LabelRefs;
}) {
  const pos = useMemo(() => layout(agents), [agents]);
  const dev = pos.get(DEVELOPER_ID)!;
  const at = (id: string) => pos.get(id)!.clone().setY(pos.get(id)!.y + HEAD_Y);
  return (
    <>
      <ambientLight intensity={1.1} />
      <directionalLight position={[4, 9, 6]} intensity={1.6} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <circleGeometry args={[7.4, 72]} />
        <meshBasicMaterial color={theme.border} transparent opacity={0.28} />
      </mesh>
      <mesh position={[0, 0.17, 0]}>
        <cylinderGeometry args={[1.5, 1.7, 0.34, 48]} />
        <meshStandardMaterial color={theme.border} roughness={0.9} />
      </mesh>
      {agents
        .filter((a) => a.role === "lead")
        .map((a) => {
          const active = a.state === "working";
          return (
            <QuadraticBezierLine
              key={`link-${a.id}`}
              start={at(a.id)}
              end={at(DEVELOPER_ID)}
              mid={arcMid(at(a.id), at(DEVELOPER_ID))}
              color={active ? a.color : theme.muted}
              lineWidth={active ? 1.6 : 1}
              transparent
              opacity={active ? 0.7 : 0.22}
              dashed={!active}
              dashSize={0.18}
              gapSize={0.14}
            />
          );
        })}
      {agents.map((a) =>
        a.id === DEVELOPER_ID ? (
          <Team key={a.id} agent={a} team={team} position={dev} theme={theme} reduced={reduced} />
        ) : (
          <Figure key={a.id} agent={a} position={pos.get(a.id)!} theme={theme} reduced={reduced} />
        ),
      )}
      {pulses.map((p) => (
        <PulseDot key={p.id} pulse={p} reduced={reduced} />
      ))}
      <LabelProjector agents={agents} pos={pos} labels={labels} />
      <OrbitControls
        enablePan={false}
        minDistance={7}
        maxDistance={20}
        minPolarAngle={0.5}
        maxPolarAngle={1.45}
        autoRotate={live && !reduced}
        autoRotateSpeed={0.35}
        target={[0, 0.9, 0]}
      />
    </>
  );
}

export default function AgentScene({ run, project }: { run: Run; project: Project | null }) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const agents = useMemo(() => deriveAgents(run, project, theme.dark), [run, project, theme.dark]);
  const team = useMemo(() => deriveTeam(run, theme.dark), [run, theme.dark]);
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const labels = useRef(new Map<string, HTMLDivElement>());
  const seen = useRef<number | null>(null);
  const nextId = useRef(0);

  // Spawn a pulse for each event that arrived since the last poll (none for events already there on load).
  useEffect(() => {
    const total = run.events.length;
    if (seen.current === null) {
      seen.current = total;
      return;
    }
    if (total <= seen.current) return;
    const fresh = run.events.slice(seen.current);
    seen.current = total;
    const pos = layout(agents);
    const at = (id: string) => pos.get(id)?.clone().setY((pos.get(id)?.y ?? 0) + HEAD_Y);
    const now = performance.now();
    const added: Pulse[] = [];
    fresh.forEach((ev, i) =>
      pulsesFor(ev, agents).forEach((spec) => {
        const from = at(spec.from);
        const to = at(spec.to);
        if (from && to) added.push({ id: nextId.current++, from, to, color: spec.color, start: now + i * 180 });
      }),
    );
    if (added.length === 0) return;
    setPulses((cur) => [...cur, ...added]);
    const ids = new Set(added.map((p) => p.id));
    // No cleanup: the next poll re-runs this effect, and these pulses must still be removed on time.
    setTimeout(() => setPulses((cur) => cur.filter((p) => !ids.has(p.id))), PULSE_MS + fresh.length * 180 + 200);
  }, [run.events, agents]);

  const crowd = [...agents.filter((a) => a.id !== DEVELOPER_ID), ...team];
  const working = crowd.filter((a) => a.state === "working").length;
  return (
    <div className="relative h-[440px] w-full overflow-hidden rounded-lg" role="img" aria-label={`Agent view: ${run.phase}. ${working} of ${crowd.length} agents working.`}>
      <Canvas camera={{ position: [0, 6.2, 12.5], fov: 42 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
        <World agents={agents} team={team} pulses={pulses} theme={theme} reduced={reduced} live={run.status === "running"} labels={labels} />
      </Canvas>
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        {agents.map((a) => (
          <div
            key={a.id}
            ref={(el) => {
              if (el) labels.current.set(a.id, el);
              else labels.current.delete(a.id);
            }}
            className="agent-label"
            data-state={a.state}
            style={{ visibility: "hidden" }}
          >
            <span className="agent-label-name">
              <i style={{ background: a.state === "done" ? theme.good : a.state === "error" ? theme.bad : a.state === "working" ? a.color : theme.muted }} />
              {a.name}
            </span>
            <span className="agent-label-text">{a.text || STATE_WORD[a.state]}</span>
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute left-3 top-3 text-sm">
        <p className="font-medium">{run.phase}</p>
        <p className="hint">{run.status === "running" ? `${working} of ${crowd.length} agents working` : "Drag to rotate, scroll to zoom"}</p>
      </div>
    </div>
  );
}
