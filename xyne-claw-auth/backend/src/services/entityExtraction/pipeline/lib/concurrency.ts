/** Bounded-concurrency map that preserves input order in the result. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []
  const width = Math.max(1, Math.min(limit, items.length))
  const results = new Array<R>(items.length)
  let cursor = 0

  const workers = Array.from({ length: width }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await fn(items[index]!, index)
    }
  })

  await Promise.all(workers)
  return results
}

export function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) throw new Error('chunk size must be positive')
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}

/**
 * Batches by a size budget as well as a count, so batches stay even when
 * document length varies by orders of magnitude — which it does once threads
 * are folded into single documents. An item exceeding the budget alone becomes
 * its own batch rather than being dropped.
 */
export function chunkBySize<T>(
  items: T[],
  sizeOf: (item: T) => number,
  maxSize: number,
  maxCount: number,
): T[][] {
  if (maxSize <= 0 || maxCount <= 0) {
    throw new Error('maxSize and maxCount must be positive')
  }

  const out: T[][] = []
  let current: T[] = []
  let total = 0

  for (const item of items) {
    const size = sizeOf(item)
    if (
      current.length > 0 &&
      (total + size > maxSize || current.length >= maxCount)
    ) {
      out.push(current)
      current = []
      total = 0
    }
    current.push(item)
    total += size
  }

  if (current.length > 0) out.push(current)
  return out
}
