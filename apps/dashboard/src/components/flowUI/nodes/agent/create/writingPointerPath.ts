export interface PointerPoint {
  x: number;
  y: number;
}

export type TravelKind = 'entry' | 'field-down' | 'wander' | 'settle' | 'reduced';

const CURVE_SAMPLES = 10;
const SETTLE_SAMPLES = 4;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function sampleQuadratic(
  from: PointerPoint,
  cx: number,
  cy: number,
  to: PointerPoint,
  samples: number,
): PointerPoint[] {
  const points: PointerPoint[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const u = 1 - t;
    points.push({
      x: u * u * from.x + 2 * u * t * cx + t * t * to.x,
      y: u * u * from.y + 2 * u * t * cy + t * t * to.y,
    });
  }
  return points;
}

function sampleCubic(
  from: PointerPoint,
  c1: PointerPoint,
  c2: PointerPoint,
  to: PointerPoint,
  samples: number,
): PointerPoint[] {
  const points: PointerPoint[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const u = 1 - t;
    points.push({
      x:
        u * u * u * from.x +
        3 * u * u * t * c1.x +
        3 * u * t * t * c2.x +
        t * t * t * to.x,
      y:
        u * u * u * from.y +
        3 * u * u * t * c1.y +
        3 * u * t * t * c2.y +
        t * t * t * to.y,
    });
  }
  return points;
}

function appendOvershootSettle(
  points: PointerPoint[],
  from: PointerPoint,
  to: PointerPoint,
  strength: number,
): PointerPoint[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return [...points, to];
  const overshoot = Math.min(14, Math.max(4, dist * strength));
  const last = points[points.length - 1] ?? to;
  if (last.x === to.x && last.y === to.y) {
    points = points.slice(0, -1);
  }
  return [
    ...points,
    {
      x: to.x + (dx / dist) * overshoot,
      y: to.y + (dy / dist) * overshoot,
    },
    { x: to.x, y: to.y },
  ];
}

/** Downward arc between fields — bulges sideways, never a linear left park. */
export function fieldTransitionPath(from: PointerPoint, to: PointerPoint): PointerPoint[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return [from, to];

  const downward = dy > 6;
  if (!downward) {
    return mouseTravelPath(from, to, 'wander');
  }

  const side = dx >= 0 ? 1 : -1;
  const bulge = Math.min(88, Math.max(28, dist * 0.38));
  const c1 = {
    x: from.x + side * bulge * 0.55,
    y: from.y + dy * 0.22,
  };
  const c2 = {
    x: to.x + side * bulge * 0.35,
    y: from.y + dy * 0.78,
  };
  const curve = sampleCubic(from, c1, c2, to, CURVE_SAMPLES);
  return appendOvershootSettle(curve, from, to, 0.035);
}

/** Quadratic swish with optional overshoot/settle. */
export function mouseTravelPath(
  from: PointerPoint,
  to: PointerPoint,
  kind: TravelKind = 'entry',
): PointerPoint[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) {
    return [from, to];
  }

  if (kind === 'reduced') {
    return [from, to];
  }

  if (kind === 'field-down' && dy > 6) {
    return fieldTransitionPath(from, to);
  }

  const nx = -dy / dist;
  const ny = dx / dist;
  const bulgeScale =
    kind === 'entry' ? 0.32 : kind === 'settle' ? 0.08 : kind === 'wander' ? 0.14 : 0.22;
  const bulgeCap = kind === 'entry' ? 96 : kind === 'wander' ? 36 : kind === 'settle' ? 10 : 72;
  const bulgeFloor = kind === 'settle' ? 3 : kind === 'wander' ? 8 : 16;
  const bulge = Math.min(bulgeCap, Math.max(bulgeFloor, dist * bulgeScale));

  const entryLift = kind === 'entry' ? -10 : 0;
  const cx = (from.x + to.x) / 2 + nx * bulge;
  const cy = (from.y + to.y) / 2 + ny * bulge + entryLift;

  const samples = kind === 'settle' ? SETTLE_SAMPLES : CURVE_SAMPLES;
  const curve = sampleQuadratic(from, cx, cy, to, samples);

  if (kind === 'settle' || kind === 'wander') {
    return [...curve.slice(0, -1), to];
  }

  const strength = kind === 'entry' ? 0.05 : 0.04;
  return appendOvershootSettle(curve, from, to, strength);
}

export function pickTravelPath(
  from: PointerPoint,
  to: PointerPoint,
  kind: TravelKind,
): PointerPoint[] {
  if (kind === 'field-down') {
    return fieldTransitionPath(from, to);
  }
  return mouseTravelPath(from, to, kind);
}

/** Tiny hover wiggle once the pointer lands on text. */
export function pointerSettlePath(at: PointerPoint): PointerPoint[] {
  return [
    at,
    { x: at.x + 3, y: at.y - 2 },
    { x: at.x - 2, y: at.y + 1 },
    { x: at.x + 1, y: at.y - 1 },
    at,
  ];
}

export function mouseTravelDurationMs(
  from: PointerPoint,
  to: PointerPoint,
  kind: TravelKind = 'entry',
): number {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  if (kind === 'reduced') {
    return Math.min(220, Math.max(120, 80 + dist * 0.35));
  }
  if (kind === 'settle') {
    return Math.min(340, Math.max(180, 140 + dist * 0.25));
  }
  if (kind === 'wander') {
    return Math.min(480, Math.max(200, 160 + dist * 0.55));
  }
  if (kind === 'field-down') {
    return Math.min(920, Math.max(480, 320 + dist * 0.85));
  }
  return Math.min(820, Math.max(440, 300 + dist * 0.92));
}

export function mouseTravelTimes(pointCount: number, kind: TravelKind = 'entry'): number[] {
  if (pointCount <= 1) return [0];
  if (pointCount === 2) return [0, 1];
  const curveCount = pointCount - 2;
  const times: number[] = [];
  const curveEnd = kind === 'settle' ? 0.88 : kind === 'wander' ? 0.92 : 0.78;
  for (let i = 0; i < curveCount; i += 1) {
    times.push(lerp(0, curveEnd, curveCount === 1 ? 1 : i / (curveCount - 1)));
  }
  if (kind === 'settle' || kind === 'wander') {
    times.push(1);
    return times;
  }
  times.push(0.9, 1);
  return times;
}

export function pointerEntryPoint(target: PointerPoint): PointerPoint {
  return { x: target.x - 64, y: target.y - 28 };
}

export interface FieldBox {
  left: number;
  top: number;
  width: number;
  height: number;
  inline: boolean;
}

/** Mid-field rest for prefers-reduced-motion — never the title’s left edge. */
export function pointerParkPoint(box: FieldBox): PointerPoint {
  return pointerLandingPoint(box);
}

/** First touch on the field text — not parked on the title’s left. */
export function pointerLandingPoint(box: FieldBox): PointerPoint {
  return {
    x: box.left + Math.max(32, box.width * 0.42),
    y: box.top + (box.inline ? 4 : 22),
  };
}

/**
 * Hover drift while “typing” — tight left/right micro moves on the text line,
 * with gentle vertical bobbing (not a linear sweep or left-edge park).
 */
export function pointerWanderStops(box: FieldBox): PointerPoint[] {
  const anchor = pointerLandingPoint(box);
  const padL = box.inline ? 18 : 12;
  const padR = 36;
  const usableW = Math.max(48, box.width - padL - padR);
  const lineY = anchor.y;
  const fracs = [0.38, 0.52, 0.44, 0.61, 0.47, 0.58, 0.41, 0.55];
  return fracs.map((frac, index) => ({
    x: box.left + padL + usableW * frac,
    y: lineY + (index % 4 === 0 ? -1 : index % 4 === 2 ? 1 : 0),
  }));
}

export function wanderHopDurationMs(from: PointerPoint, to: PointerPoint): number {
  return mouseTravelDurationMs(from, to, 'wander');
}
