// The Loft cast: everyone is a creature, and a pigeon courier carries
// every payment. Nothing here is decoration for its own sake. The courier's
// flight lasts exactly as long as the real payment takes to confirm, and a
// creature's mood comes from real balances.
import { useEffect, useRef, useState } from "react";

export const CREATURES = ["pangolin", "tortoise", "hornbill"] as const;
export type Creature = (typeof CREATURES)[number];
export type Pose = "idle" | "wave" | "catch" | "cheer" | "wait" | "worried";
export type CourierPose = "fly-up" | "fly-down" | "perch" | "handoff" | "salute" | "sleep";

export const CREATURE_NAMES: Record<Creature, string> = {
  pangolin: "Pangolin",
  tortoise: "Tortoise",
  hornbill: "Hornbill",
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
    <div className="delivery" aria-live="polite">
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
          onClick={() => onChange(c)}
        >
          <CreatureSprite kind={c} pose={value === c ? "wave" : "idle"} size={96} />
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
    <span className="avatar" style={style} aria-hidden>
      {isCreature(kind) ? <img src={`/cast/${kind}/idle.webp`} alt="" /> : name.replace("@", "").slice(0, 1).toUpperCase()}
    </span>
  );
}
