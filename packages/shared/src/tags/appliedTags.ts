/**
 * An applied tag, and the one place that reads and writes the stored form.
 *
 * `conversations.threadType` and `messages.messageActs` are plain TEXT columns holding a
 * JSON array of these. They used to hold a bare array of names; the parser still accepts that
 * shape so pre-existing rows keep rendering, as a classifier-applied tag with no known
 * timestamp.
 *
 * Which messages evidence a thread's tag is not recorded on the tag — it is expressed by
 * which MESSAGES carry that tag, which the thread view already has in hand.
 *
 * Everything that touches those columns — classifier, mutators, Vespa mapper, UI — goes
 * through here, because a hand-rolled JSON.parse is how the two shapes start disagreeing.
 */

export interface AppliedTag {
  /** Vocabulary entry name, or a free-form tag someone typed. */
  name: string;
  /**
   * Someone took this tag off the thread.
   *
   * A tombstone rather than a delete. Deletion is the only edit that destroys its own
   * evidence — a removed tag and a tag that was never suggested look identical — so without
   * this the classifier would hand it straight back on its next pass.
   *
   * There is no approval state here. Whether a NAME belongs in the vocabulary is decided
   * once, on the vocabulary row; whether a tag belongs on a thread is decided by the person
   * who put it there.
   */
  removed?: boolean;
  /** Epoch ms. 0 for a legacy row, which carried no timestamp — render as unknown. */
  at: number;
  /**
   * The person who last acted on this tag — set when someone adds it, and when someone
   * removes it. The classifier never sets it, so its presence IS "a human touched this":
   * there is no separate method field, because a second field could only ever disagree.
   */
  by?: string | null;
}

/** Legacy rows carried no timestamp; 0 is the sentinel for "applied, time unknown". */
export const UNKNOWN_APPLIED_AT = 0;

/** A bare name from a legacy row: the classifier wrote it, and nothing gated it. */
const fromLegacyName = (name: string): AppliedTag => ({
  name,
  at: UNKNOWN_APPLIED_AT,
});

const fromObject = (value: Record<string, unknown>): AppliedTag | null => {
  const name = typeof value['name'] === 'string' ? value['name'].trim() : '';
  if (!name) return null;

  return {
    name,
    // 'DEACTIVATED' is the old spelling of removed. The other old values — PENDING,
    // APPROVED — both meant the tag was on the thread, so they read as not removed.
    removed: value['removed'] === true || value['status'] === 'DEACTIVATED',
    at: typeof value['at'] === 'number' && Number.isFinite(value['at']) ? value['at'] : UNKNOWN_APPLIED_AT,
    by: typeof value['by'] === 'string' ? value['by'] : null,
  };
};

/**
 * Parse a stored column into applied tags. Never throws: the column is plain TEXT with no
 * database-level guarantee of shape, and an unreadable value means "no tags", never a crash
 * in a chat row.
 *
 * Accepts all four shapes that exist in the wild: null/empty, `'[]'`, a legacy array of
 * names, a legacy bare name, and the current array of objects. Duplicates by name are
 * collapsed, last write winning, so a merge bug can't render the same chip twice.
 */
export const parseAppliedTags = (raw: string | null | undefined): AppliedTag[] => {
  if (!raw || !raw.trim()) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Rows written before the column held JSON stored a bare name.
    return raw.trim() ? [fromLegacyName(raw.trim())] : [];
  }

  const list = Array.isArray(parsed) ? parsed : [parsed];
  const byName = new Map<string, AppliedTag>();

  for (const item of list) {
    let tag: AppliedTag | null = null;
    if (typeof item === 'string' && item.trim()) {
      tag = fromLegacyName(item.trim());
    } else if (item && typeof item === 'object') {
      tag = fromObject(item as Record<string, unknown>);
    }
    if (tag) byName.set(tag.name, tag);
  }

  return [...byName.values()];
};

/**
 * Serialize for storage. Always an array, always a string — `'[]'` rather than null when
 * empty, because null means "never classified" and would make the thread eligible again on
 * the classifier's next pass.
 */
export const serializeAppliedTags = (tags: AppliedTag[]): string =>
  JSON.stringify(
    tags.map(tag => ({
      name: tag.name,
      at: tag.at,
      // Only fields that DEVIATE from the norm are written; the parser fills the rest back
      // in. Anything present in a stored tag is therefore something that happened to it, and
      // these columns replicate to every client through Zero.
      ...(tag.removed ? { removed: true } : {}),
      ...(tag.by ? { by: tag.by } : {}),
    })),
  );

/** Tags a reader should see — everything still on the thread. */
export const visibleTags = (tags: AppliedTag[]): AppliedTag[] =>
  tags.filter(tag => !tag.removed);

/**
 * Names for search. Everything on the thread is indexed the moment it lands, whether the
 * classifier or a person put it there, and whether or not the name is in the vocabulary —
 * a tag you can see on a thread and cannot find by searching for it is just broken.
 */
export const indexableTagNames = (tags: AppliedTag[]): string[] =>
  visibleTags(tags).map(tag => tag.name);

/**
 * Whether a person has acted on this tag — added it, or removed it.
 *
 * The classifier never writes `by`, so this is the whole test. Used to decide that a thread
 * has been curated and should no longer be re-classified.
 */
export const isHumanApplied = (tag: AppliedTag): boolean => Boolean(tag.by);

/**
 * The stored form of a tag name, applied the moment someone invents one.
 *
 * Normalising at CREATION rather than at approval is what keeps a tag matching itself. If a
 * name were rewritten later, the threads already carrying it would keep the old spelling: the
 * chips would stop resolving to the vocabulary entry, the usage count would read zero, and a
 * search for the approved name would find none of them.
 *
 * There is exactly one copy of this rule and every writer imports it — the two Zero mutator
 * copies, the picker, and the promotion path. Two copies of it either side of a network
 * boundary is how a proposal ends up approved under a name the server never retires.
 *
 * Returns '' when nothing usable survives (punctuation only); callers refuse rather than
 * store a blank.
 *
 * NOT to be confused with `normalizeTagName` in this package's index, which is the Desk tag
 * system's rule and produces the opposite shape — lowercase, hyphen-separated.
 */
export const normalizeThreadTypeName = (raw: string): string =>
  raw
    .trim()
    .toUpperCase()
    // Every RUN of non-alphanumerics becomes one underscore, so "vespa latency",
    // "vespa-latency" and "Vespa/Latency" are one tag rather than three near-duplicates.
    // Underscore is itself non-alphanumeric, so existing ones are absorbed by the same run:
    // "VESPA__LATENCY" collapses here too, and nothing downstream can see a doubled one.
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
