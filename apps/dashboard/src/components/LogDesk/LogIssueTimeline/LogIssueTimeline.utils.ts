export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

export function pickBucketSizeMs(spanMs: number): number {
  if (spanMs <= 6 * HOUR_MS) return 15 * 60 * 1000; // 15 min
  if (spanMs <= 2 * DAY_MS) return HOUR_MS;
  return DAY_MS;
}

export function bucketOccurrences(
  timestamps: number[],
  bucketSizeMs: number,
  min: number,
  max: number,
): Array<{ bucketStart: number; count: number }> {
  if (timestamps.length === 0) return [];
  const firstBucket = Math.floor(min / bucketSizeMs) * bucketSizeMs;
  const lastBucket = Math.floor(max / bucketSizeMs) * bucketSizeMs;

  const counts = new Map<number, number>();
  for (const ts of timestamps) {
    const bucketStart = Math.floor(ts / bucketSizeMs) * bucketSizeMs;
    counts.set(bucketStart, (counts.get(bucketStart) ?? 0) + 1);
  }

  const buckets: Array<{ bucketStart: number; count: number }> = [];
  for (let bucketStart = firstBucket; bucketStart <= lastBucket; bucketStart += bucketSizeMs) {
    buckets.push({ bucketStart, count: counts.get(bucketStart) ?? 0 });
  }
  return buckets;
}
