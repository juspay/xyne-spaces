export interface PointerPoint {
  x: number;
  y: number;
}

export type TravelKind = 'entry' | 'field-down' | 'reduced';

const CURVE_SAMPLES = 10;

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

/** Downward arc between fields — one smooth move, then rest. */
export function fieldTransitionPath(from: PointerPoint, to: PointerPoint): PointerPoint[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return [from, to];

  if (dy <= 6) {
    return mouseTravelPath(from, to, 'entry');
  }

  const side = dx >= 0 ? 1 : -1;
  const bulge = Math.min(80, Math.max(24, dist * 0.34));
  const c1 = {
    x: from.x + side * bulge * 0.55,
    y: from.y + dy * 0.22,
  };
  const c2 = {
    x: to.x + side * bulge * 0.35,
    y: from.y + dy * 0.78,
  };
  return sampleCubic(from, c1, c2, to, CURVE_SAMPLES);
}

/** Single curved travel onto the target — no looped wiggle afterward. */
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
  const bulge = Math.min(88, Math.max(18, dist * 0.26));
  const cx = (from.x + to.x) / 2 + nx * bulge;
  const cy = (from.y + to.y) / 2 + ny * bulge + (kind === 'entry' ? -8 : 0);
  return sampleQuadratic(from, cx, cy, to, CURVE_SAMPLES);
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

export function mouseTravelDurationMs(
  from: PointerPoint,
  to: PointerPoint,
  kind: TravelKind = 'entry',
): number {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  if (kind === 'reduced') {
    return Math.min(220, Math.max(120, 80 + dist * 0.35));
  }
  if (kind === 'field-down') {
    return Math.min(880, Math.max(460, 340 + dist * 0.8));
  }
  return Math.min(760, Math.max(420, 280 + dist * 0.88));
}

export function mouseTravelTimes(pointCount: number): number[] {
  if (pointCount <= 1) return [0];
  if (pointCount === 2) return [0, 1];
  const times: number[] = [0];
  for (let i = 1; i < pointCount - 1; i += 1) {
    times.push(lerp(0, 0.82, i / (pointCount - 2)));
  }
  times.push(1);
  return times;
}

export function pointerEntryPoint(target: PointerPoint): PointerPoint {
  return { x: target.x - 56, y: target.y - 24 };
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

/** Resting position on the field text line (optionally tracks typed width). */
export function pointerCaretPoint(
  control: HTMLInputElement | HTMLTextAreaElement | null,
  box: FieldBox,
  value: string,
): PointerPoint {
  const lineY = box.top + (box.inline ? 4 : 22);
  const startX = box.left + (box.inline ? 10 : 12);

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
