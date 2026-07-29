/**
 * Clustering primitives.
 *
 * Bootstrap clusters *unique normalized surface forms*, not raw mentions.
 * That is what keeps the naive O(n^2) comparison affordable: millions of
 * mentions collapse to thousands of distinct forms before this code runs.
 *
 * Similarity is injected rather than fixed, so the same clustering works for
 * entity names (lexical) and, if ever wanted, anything else.
 */

export class UnionFind {
  private parent: number[]
  private rank: number[]

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i)
    this.rank = new Array<number>(size).fill(0)
  }

  find(x: number): number {
    let root = x
    while (this.parent[root] !== root) root = this.parent[root]!
    let cur = x
    while (this.parent[cur] !== root) {
      const next = this.parent[cur]!
      this.parent[cur] = root
      cur = next
    }
    return root
  }

  union(a: number, b: number): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra === rb) return
    if (this.rank[ra]! < this.rank[rb]!) {
      this.parent[ra] = rb
    } else if (this.rank[ra]! > this.rank[rb]!) {
      this.parent[rb] = ra
    } else {
      this.parent[rb] = ra
      this.rank[ra]!++
    }
  }

  groups(): number[][] {
    const byRoot = new Map<number, number[]>()
    for (let i = 0; i < this.parent.length; i++) {
      const root = this.find(i)
      const list = byRoot.get(root)
      if (list) list.push(i)
      else byRoot.set(root, [i])
    }
    return [...byRoot.values()]
  }
}

export interface ClusterOptions<T> {
  /** Text compared for similarity. */
  keyOf: (item: T) => string
  /** Hard partition — items in different buckets are never compared. */
  bucketOf?: ((item: T) => string) | undefined
  /** Pairwise similarity in 0-1. */
  similarity: (a: string, b: string) => number
  /** Merge outright at or above this score. */
  mergeThreshold: number
  /**
   * Lower threshold applied only to pairs that also satisfy `bridge`.
   * Set equal to mergeThreshold to disable bridging.
   */
  bridgeThreshold?: number | undefined
  bridge?: ((a: T, b: T) => boolean) | undefined
  /**
   * Minimum similarity between a member and its group's anchor. Guards against
   * single-linkage chaining. Omit to keep raw connected components.
   */
  cohesionFloor?: number | undefined
  /** Picks the group anchor. Highest weight wins. */
  weightOf?: ((item: T) => number) | undefined
}

/**
 * Connected components over a thresholded similarity graph.
 *
 * Transitivity is intentional: "hdfc" ~ "hdfc bank" ~ "hdfc bank ltd" should
 * land in one group even when the endpoints are not directly similar enough.
 * The cost is chaining risk, which the type bucket and the thresholds are there
 * to contain — and which the human review gate exists to catch.
 */
export function clusterBySimilarity<T>(
  items: T[],
  opts: ClusterOptions<T>,
): T[][] {
  if (items.length === 0) return []

  const uf = new UnionFind(items.length)
  const bridgeThreshold = opts.bridgeThreshold ?? opts.mergeThreshold
  const keys = items.map(opts.keyOf)

  const buckets = new Map<string, number[]>()
  for (let i = 0; i < items.length; i++) {
    const key = opts.bucketOf ? opts.bucketOf(items[i]!) : '_'
    const list = buckets.get(key)
    if (list) list.push(i)
    else buckets.set(key, [i])
  }

  for (const indices of buckets.values()) {
    for (let a = 0; a < indices.length; a++) {
      for (let b = a + 1; b < indices.length; b++) {
        const i = indices[a]!
        const j = indices[b]!

        // Skip the comparison entirely if they are already grouped.
        if (uf.find(i) === uf.find(j)) continue

        const score = opts.similarity(keys[i]!, keys[j]!)
        if (score >= opts.mergeThreshold) {
          uf.union(i, j)
          continue
        }
        if (
          opts.bridge &&
          score >= bridgeThreshold &&
          opts.bridge(items[i]!, items[j]!)
        ) {
          uf.union(i, j)
        }
      }
    }
  }

  const groups = uf.groups().map((group) => group.map((i) => items[i]!))

  if (opts.cohesionFloor === undefined) return groups

  // Single-linkage chains: A~B and B~C puts A and C together even when they are
  // unrelated. One generic bridging token is enough to fuse an entire corpus.
  // So validate each group against its dominant member and split off anything
  // that was only ever connected transitively.
  return groups.flatMap((group) =>
    enforceCohesion(group, opts, opts.cohesionFloor!),
  )
}

/**
 * Keeps only members similar to the group's anchor (its largest member by
 * `weightOf`, which is the form the canonical name will come from). Rejected
 * members are re-clustered among themselves rather than discarded, so a genuine
 * second entity that got swept in survives as its own group.
 */
function enforceCohesion<T>(
  group: T[],
  opts: ClusterOptions<T>,
  floor: number,
): T[][] {
  if (group.length <= 1) return [group]

  const weight = opts.weightOf ?? (() => 1)
  const sorted = [...group].sort((a, b) => weight(b) - weight(a))
  const anchor = sorted[0]!
  const anchorKey = opts.keyOf(anchor)

  const kept: T[] = [anchor]
  const rejected: T[] = []

  for (const member of sorted.slice(1)) {
    const score = opts.similarity(anchorKey, opts.keyOf(member))
    const bridged =
      opts.bridge?.(anchor, member) === true && score >= (opts.bridgeThreshold ?? floor)
    if (score >= floor || bridged) kept.push(member)
    else rejected.push(member)
  }

  if (rejected.length === 0) return [kept]
  return [kept, ...enforceCohesion(rejected, opts, floor)]
}
