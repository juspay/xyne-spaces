import { percentile } from '../ringBuffer';
import type { Confidence } from './types';

export { percentile };

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

export function maxOf(values: number[]): number | null {
  if (values.length === 0) return null;
  let max = -Infinity;
  for (const value of values) if (value > max) max = value;
  return max;
}

export function minOf(values: number[]): number | null {
  if (values.length === 0) return null;
  let min = Infinity;
  for (const value of values) if (value < min) min = value;
  return min;
}

/**
 * Least-squares slope in units per minute. Used to tell a metric that sits high
 * from one that is still climbing — the difference between "memory is heavy" and
 * "memory is leaking", which have different answers.
 */
export function slopePerMinute(points: { t: number; v: number }[]): number | null {
  if (points.length < 3) return null;
  const n = points.length;
  let meanX = 0;
  let meanY = 0;
  for (const point of points) {
    meanX += point.t;
    meanY += point.v;
  }
  meanX /= n;
  meanY /= n;

  let covariance = 0;
  let variance = 0;
  for (const point of points) {
    covariance += (point.t - meanX) * (point.v - meanY);
    variance += (point.t - meanX) ** 2;
  }
  if (variance === 0) return null;
  return (covariance / variance) * 60_000;
}

/**
 * Grades how much a check's evidence is worth.
 *
 * Sample count alone is not enough: twenty samples taken over three seconds
 * describe three seconds. Both the count and the span the samples cover have to
 * clear the bar before a verdict is stated with confidence.
 */
export function confidenceFrom(options: {
  samples: number;
  /** Counts at or above which the sample size is adequate. */
  mediumSamples: number;
  highSamples: number;
  /** Span the samples cover, when it is meaningful for this check. */
  spanMs?: number;
  minSpanMs?: number;
}): Confidence {
  const { samples, mediumSamples, highSamples, spanMs, minSpanMs } = options;
  if (samples < mediumSamples) return 'low';
  if (minSpanMs !== undefined && spanMs !== undefined && spanMs < minSpanMs) return 'low';
  if (samples < highSamples) return 'medium';
  return 'high';
}

const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

export function lowestConfidence(values: Confidence[]): Confidence {
  let lowest: Confidence = 'high';
  for (const value of values) {
    if (CONFIDENCE_RANK[value] < CONFIDENCE_RANK[lowest]) lowest = value;
  }
  return lowest;
}

export function describeSamples(count: number, spanMs: number): string {
  const seconds = Math.round(spanMs / 1000);
  const plural = count === 1 ? '' : 's';
  return `${count} sample${plural} over ${seconds}s`;
}

/** Rounds for display without pretending to a precision the measurement lacks. */
export function fmt(value: number | null, decimals = 0, unit = ''): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(decimals)}${unit ? ` ${unit}` : ''}`;
}
