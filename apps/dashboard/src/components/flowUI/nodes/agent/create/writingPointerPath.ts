export interface PointerPoint {
  x: number;
  y: number;
}

export type TravelKind = 'entry' | 'field-down' | 'reduced';

const CURVE_SAMPLES = 10;

/** Clicky scale pulse peaks at 1.3× mid-flight. */
export const FLIGHT_SCALE_PEAK = 1.3;

/**
 * SVG tip points roughly up-left (~−135°). Offset so tip faces travel
 * direction: atan2(ty, tx)·180/π + this value.
 */
export const POINTER_TIP_OFFSET_DEG = 135;

/** Hermite smoothstep 3t² − 2t³ — Clicky-style ease along the hop. */
export function hermiteSmoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** Quadratic bezier B(t) = (1−t)²·P0 + 2(1−t)t·P1 + t²·P2. */
export function quadraticPoint(
  from: PointerPoint,
  control: PointerPoint,
  to: PointerPoint,
  t: number,
): PointerPoint {
  const u = 1 - t;
  return {
    x: u * u * from.x + 2 * u * t * control.x + t * t * to.x,
    y: u * u * from.y + 2 * u * t * control.y + t * t * to.y,
  };
}

/** Bezier tangent B′(t) = 2(1−t)(P1−P0) + 2t(P2−P1). */
export function quadraticTangent(
  from: PointerPoint,
  control: PointerPoint,
  to: PointerPoint,
  t: number,
): PointerPoint {
  const u = 1 - t;
  return {
    x: 2 * u * (control.x - from.x) + 2 * t * (to.x - control.x),
    y: 2 * u * (control.y - from.y) + 2 * t * (to.y - control.y),
  };
}

/** Upward quadratic arc height — Clicky: min(0.2·distance, 80). */
export function travelArcHeight(distance: number): number {
  return Math.min(0.2 * distance, 80);
}

/** Midpoint control with upward swoop (screen Y grows downward). */
export function flightControlPoint(
  from: PointerPoint,
  to: PointerPoint,
  kind: TravelKind = 'entry',
): PointerPoint {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const arc = travelArcHeight(dist);
  return {
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2 - arc - (kind === 'entry' ? 4 : 0),
  };
}

/**
 * Mid-flight scale pulse — Clicky: 1 + sin(linearProgress · π) · 0.3.
 * Uses linear progress (not Hermite-warped t).
 */
export function flightScale(linearProgress: number): number {
  const p = Math.min(1, Math.max(0, linearProgress));
  return 1 + Math.sin(p * Math.PI) * (FLIGHT_SCALE_PEAK - 1);
}

/** Degrees to rotate the pointer SVG so its tip faces the travel tangent. */
export function headingDegrees(tangent: PointerPoint): number {
  if (Math.abs(tangent.x) < 1e-6 && Math.abs(tangent.y) < 1e-6) {
    return 0;
  }
  return (Math.atan2(tangent.y, tangent.x) * 180) / Math.PI + POINTER_TIP_OFFSET_DEG;
}

function sampleQuadratic(
  from: PointerPoint,
  control: PointerPoint,
  to: PointerPoint,
  samples: number,
  /** When true, sample at Hermite-warped t so linear sampling feels smoothstepped. */
  hermiteSpace = false,
): PointerPoint[] {
  const points: PointerPoint[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const raw = i / samples;
    const t = hermiteSpace ? hermiteSmoothstep(raw) : raw;
    points.push(quadraticPoint(from, control, to, t));
  }
  return points;
}

/**
 * Distance-scaled hop duration in ms.
 * Clicky: clamp(distance/800, 0.6, 1.4) seconds; reduced motion scales down.
 */
export function mouseTravelDurationMs(
  from: PointerPoint,
  to: PointerPoint,
  kind: TravelKind = 'entry',
): number {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const seconds = Math.min(1.4, Math.max(0.6, dist / 800));
  if (kind === 'reduced') {
    return Math.round(seconds * 0.35 * 1000);
  }
  return Math.round(seconds * 1000);
}

/** Quadratic bezier with an upward mid-flight arc — one intentional hop. */
export function mouseTravelPath(
  from: PointerPoint,
  to: PointerPoint,
  kind: TravelKind = 'entry',
): PointerPoint[] {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  if (dist < 1) {
    return [from, to];
  }

  if (kind === 'reduced') {
    return [from, to];
  }

  const control = flightControlPoint(from, to, kind);
  return sampleQuadratic(from, control, to, CURVE_SAMPLES, true);
}

/** Field-to-field hop — same upward quadratic; kept as a named alias for callers/tests. */
export function fieldTransitionPath(from: PointerPoint, to: PointerPoint): PointerPoint[] {
  return mouseTravelPath(from, to, 'field-down');
}

export function pickTravelPath(
  from: PointerPoint,
  to: PointerPoint,
  kind: TravelKind,
): PointerPoint[] {
  return mouseTravelPath(from, to, kind);
}

/** Linear sample times; Hermite easing is applied by continuous flight or Motion. */
export function mouseTravelTimes(pointCount: number): number[] {
  if (pointCount <= 1) return [0];
  if (pointCount === 2) return [0, 1];
  const times: number[] = [];
  for (let i = 0; i < pointCount; i += 1) {
    times.push(i / (pointCount - 1));
  }
  return times;
}

/** Enter from the chat card (right of the profile), slightly above the target. */
export function pointerEntryPoint(target: PointerPoint): PointerPoint {
  return { x: target.x + 56, y: target.y - 24 };
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
  return pointerCaretPoint(null, box, '');
}

/** Rest on a Hub capability row's value side, past the left label. */
export function pointerHubRowPoint(box: FieldBox): PointerPoint {
  const y = box.top + Math.min(32, Math.max(22, box.height * 0.38));
  const x = box.left + Math.min(Math.max(160, box.width * 0.55), box.width - 40);
  return { x, y };
}

/** Resting position on the field text line (optionally tracks typed width). */
export function pointerCaretPoint(
  control: HTMLInputElement | HTMLTextAreaElement | null,
  box: FieldBox,
  value: string,
): PointerPoint {
  const lineY = box.top + (box.inline ? 4 : 10);
  const startX = box.left + (box.inline ? 10 : 4);

  if (value.length === 0 || !control || typeof window === 'undefined') {
    if (value.length === 0) {
      return { x: startX, y: lineY };
    }
    return { x: startX + Math.min(value.length * 7, box.width * 0.55), y: lineY };
  }

  const style = window.getComputedStyle(control);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { x: startX + Math.min(value.length * 7, box.width * 0.55), y: lineY };
  }
  ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const textWidth = ctx.measureText(value).width;
  const maxX = box.left + Math.max(32, box.width - 28);
  return { x: Math.min(startX + textWidth + 2, maxX), y: lineY };
}

/** @deprecated alias kept for tests — landing equals caret at write start */
export function pointerLandingPoint(box: FieldBox): PointerPoint {
  return pointerCaretPoint(null, box, '');
}

export function caretTrackDurationMs(deltaX: number): number {
  return Math.min(0.18, Math.max(0.08, 0.06 + Math.abs(deltaX) * 0.002));
}
