export interface PointerPoint {
  x: number;
  y: number;
}

const CURVE_SAMPLES = 8;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Quadratic bezier through a perpendicular bulge, then a short overshoot/settle. */
export function mouseTravelPath(from: PointerPoint, to: PointerPoint): PointerPoint[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) {
    return [from, to];
  }

  const nx = -dy / dist;
  const ny = dx / dist;
  const bulge = Math.min(72, Math.max(16, dist * 0.22));
  const cx = (from.x + to.x) / 2 + nx * bulge;
  const cy = (from.y + to.y) / 2 + ny * bulge;

  const points: PointerPoint[] = [];
  for (let i = 0; i <= CURVE_SAMPLES; i += 1) {
    const t = i / CURVE_SAMPLES;
    const u = 1 - t;
    points.push({
      x: u * u * from.x + 2 * u * t * cx + t * t * to.x,
      y: u * u * from.y + 2 * u * t * cy + t * t * to.y,
    });
  }

  const overshoot = Math.min(12, Math.max(6, dist * 0.04));
  points.push({
    x: to.x + (dx / dist) * overshoot,
    y: to.y + (dy / dist) * overshoot,
  });
  points.push({ x: to.x, y: to.y });
  return points;
}

export function mouseTravelDurationMs(from: PointerPoint, to: PointerPoint): number {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  return Math.min(780, Math.max(420, 280 + dist * 0.9));
}

export function mouseTravelTimes(pointCount: number): number[] {
  if (pointCount <= 1) return [0];
  if (pointCount === 2) return [0, 1];
  const curveCount = pointCount - 2;
  const times: number[] = [];
  for (let i = 0; i < curveCount; i += 1) {
    times.push(lerp(0, 0.78, curveCount === 1 ? 1 : i / (curveCount - 1)));
  }
  times.push(0.9, 1);
  return times;
}

export function pointerEntryPoint(target: PointerPoint): PointerPoint {
  return { x: target.x - 52, y: target.y - 18 };
}
