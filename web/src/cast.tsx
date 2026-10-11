// The Loft cast: everyone is a creature, and a pigeon courier carries
// every payment. Nothing here is decoration for its own sake. The courier's
// flight lasts exactly as long as the real payment takes to confirm, and a
// creature's mood comes from real balances.
import { useEffect, useRef, useState } from "react";

export const CREATURES = ["cheetah", "fennec", "lion", "parrot"] as const;
export type Creature = (typeof CREATURES)[number];
export type Pose = "idle" | "wave" | "catch" | "cheer" | "wait" | "worried";
export type CourierPose = "fly-up" | "fly-down" | "perch" | "handoff" | "salute" | "sleep";

export const CREATURE_NAMES: Record<Creature, string> = {
  cheetah: "Cheetah",
  fennec: "Fennec",
  lion: "Lion",
  parrot: "Parrot",
};

export function isCreature(v: unknown): v is Creature {
  return typeof v === "string" && (CREATURES as readonly string[]).includes(v);
}

/** Warm the cache so a pose change never flashes an empty frame. */
export function preload(kind: Creature | "pigeon") {
  const poses = kind === "pigeon" ? ["fly-up", "fly-down", "perch", "handoff", "salute", "sleep"] : ["idle", "wave", "catch", "cheer", "wait", "worried"];
  for (const p of poses) {
    const img = new Image();
    img.src = `/cast/${kind}/${p}.webp`;
  }
}

export function CreatureSprite({
  kind,
  pose,
  size = 140,
  label,
  flip = false,
}: {
  kind: Creature;
  pose: Pose;
  size?: number;
  label?: string;
  flip?: boolean;
}) {
  useEffect(() => preload(kind), [kind]);
  return (
    <div className={`creature pose-${pose}`} style={{ height: size }} role="img" aria-label={label ?? `${CREATURE_NAMES[kind]}, ${pose}`}>
      {/* Keyed by pose so each change replays the pop-in. */}
      <img key={pose} src={`/cast/${kind}/${pose}.webp`} alt="" draggable={false} style={flip ? { transform: "scaleX(-1)" } : undefined} />
    </div>
  );
}

export function CourierSprite({ pose, size = 120 }: { pose: CourierPose; size?: number }) {
  useEffect(() => preload("pigeon"), []);
  return (
    <div className={`courier pose-${pose}`} style={{ height: size }} aria-hidden>
      <img key={pose} src={`/cast/pigeon/${pose}.webp`} alt="" draggable={false} />
    </div>
  );
}

/**
 * The courier crossing from sender to recipient. While the payment is in
 * flight it eases towards the far side and circles there; the moment the
 * relay confirms, it lands. So the flight IS the confirmation time.
 */
export function Delivery({
  from,
  to,
  confirmed,
  toRoof = false,
}: {
  from: Creature;
  to: Creature | null;
  confirmed: boolean;
  /** A link: nobody to hand it to yet, so the courier waits on their roof. */
  toRoof?: boolean;
}) {
  const [progress, setProgress] = useState(0);
  const [flap, setFlap] = useState(false);
  const [landed, setLanded] = useState(false);
  const confirmedRef = useRef(confirmed);
  confirmedRef.current = confirmed;

  useEffect(() => {
    // Position is a function of elapsed time, not accumulated frames, so a
    // backgrounded tab (no animation frames) still shows the right place.
    const start = performance.now();
    let landingFrom: { at: number; p: number } | null = null;
    const FLIGHT = 2.4; // how fast it closes on the hold point
    const LAND_MS = 350;
    const tick = () => {
      const now = performance.now();
      const inFlight = 0.82 * (1 - Math.exp(((start - now) / 1000) * FLIGHT));
      let p = inFlight;
      if (confirmedRef.current) {
        landingFrom ??= { at: now, p: inFlight };
        const k = Math.min(1, (now - landingFrom.at) / LAND_MS);
        p = landingFrom.p + (1 - landingFrom.p) * (1 - (1 - k) ** 3);
      }
      setProgress(p);
      if (p >= 1) {
        setLanded(true);
        clearInterval(timer);
      }
    };
    const timer = setInterval(tick, 16);
    const flapper = setInterval(() => setFlap((f) => !f), 150);
    return () => {
      clearInterval(timer);
      clearInterval(flapper);
    };
  }, []);

  const arc = Math.sin(progress * Math.PI) * 38;
  const hovering = !confirmed && progress > 0.78;
  const receiverPose: Pose = !confirmed ? "wait" : landed ? "cheer" : "catch";
  const courierPose: CourierPose = landed ? (toRoof ? "perch" : "handoff") : flap ? "fly-up" : "fly-down";

  return (
    <div className="delivery sky" aria-live="polite">
      <Skyline />
      <div className="delivery-from">
        <CreatureSprite kind={from} pose={landed ? "cheer" : "wave"} size={120} label="You" />
      </div>
      <div className={`delivery-sky ${toRoof ? "to-roof" : ""}`}>
        <div
          className={`delivery-courier ${hovering ? "hovering" : ""}`}
          style={{ left: `${progress * 100}%`, transform: `translate(-50%, ${-arc}px)` }}
        >
          <CourierSprite pose={courierPose} size={landed && toRoof ? 104 : 84} />
        </div>
      </div>
      <div className="delivery-to">
        {toRoof || !to ? (
          <div className="roof" aria-label="Their roof" />
        ) : (
          <CreatureSprite kind={to} pose={receiverPose} size={120} flip label="Them" />
        )}
      </div>
    </div>
  );
}

/** One tap each: the creature waves when chosen. */
export function CreaturePicker({ value, onChange }: { value: Creature | null; onChange: (c: Creature) => void }) {
  return (
    <div className="picker" role="radiogroup" aria-label="Choose your creature">
      {CREATURES.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          className={`pick ${value === c ? "on" : ""}`}
          data-creature={c}
          onClick={() => onChange(c)}
        >
          <CreatureSprite kind={c} pose={value === c ? "wave" : "idle"} size={84} />
          <span>{CREATURE_NAMES[c]}</span>
        </button>
      ))}
    </div>
  );
}

/** A round avatar: the person's creature if they have one, else their initial. */
export function CreatureAvatar({ kind, name, size }: { kind?: string | null; name: string; size?: number }) {
  const style = size ? { width: size, height: size } : undefined;
  return (
    <span className="avatar" style={style} data-creature={isCreature(kind) ? kind : undefined} aria-hidden>
      {isCreature(kind) ? <img src={`/cast/${kind}/idle.webp`} alt="" /> : name.replace("@", "").slice(0, 1).toUpperCase()}
    </span>
  );
}

/**
 * The city the courier flies over: rooftops and a water tower in the sky's
 * own haze colour, so creatures standing in front of it stay the focus.
 */
export function Skyline() {
  return (
    <svg className="skyline" viewBox="0 0 400 90" preserveAspectRatio="xMidYMax slice" aria-hidden>
      <g className="far">
        <rect x="0" y="38" width="34" height="52" rx="3" />
        <rect x="30" y="22" width="26" height="68" rx="3" />
        <rect x="60" y="46" width="40" height="44" rx="3" />
        <rect x="104" y="14" width="22" height="76" rx="3" />
        <rect x="122" y="34" width="36" height="56" rx="3" />
        <rect x="236" y="26" width="30" height="64" rx="3" />
        <rect x="262" y="44" width="42" height="46" rx="3" />
        <rect x="300" y="10" width="24" height="80" rx="3" />
        <rect x="330" y="36" width="34" height="54" rx="3" />
        <rect x="362" y="50" width="38" height="40" rx="3" />
      </g>
      <g className="near">
        <path d="M150 90V58l22-18 22 18v32z" />
        <rect x="196" y="52" width="38" height="38" rx="3" />
        <path d="M206 52v-12h4v12M220 52V36h4v16" />
        <rect x="16" y="62" width="44" height="28" rx="3" />
        <path d="M70 90V64l18-14 18 14v26z" />
        <rect x="318" y="60" width="40" height="30" rx="3" />
        <path d="M370 90V66l15-12 15 12v24z" />
      </g>
    </svg>
  );
}

/** A one-off burst for the moment money actually lands. Pure CSS, skipped under reduced motion. */
export function Confetti() {
  const colors = ["var(--c1)", "var(--c2)", "#2e7cf6", "#147a4c", "#ff5f6d", "#ffd54a"];
  return (
    <div className="confetti" aria-hidden>
      {Array.from({ length: 28 }, (_, i) => (
        <i
          key={i}
          style={{
            left: `${(i * 37) % 100}%`,
            background: colors[i % colors.length],
            animationDelay: `${(i % 7) * 60}ms`,
            animationDuration: `${1300 + ((i * 53) % 700)}ms`,
            transform: `rotate(${(i * 47) % 360}deg)`,
          }}
        />
      ))}
    </div>
  );
}
