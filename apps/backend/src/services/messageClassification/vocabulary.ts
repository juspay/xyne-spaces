/**
 * The thread-type vocabulary a workspace classifies against.
 *
 * One source for three things that must never disagree: the classifier prompt, the
 * validation that filters the model's output, and the picker the dashboard renders.
 *
 * The table is the whole truth. A workspace's vocabulary is its rows in
 * non_zero.thread_type_vocabulary — there is no fallback to code, so a workspace with no
 * rows has no types and classification skips it until an admin installs some. THREAD_TYPES
 * is a template `seedWorkspaceVocabulary` copies in on request; nothing else reads it.
 *
 * ORG and USER scopes are not resolved yet but need no schema change to slot in — that is
 * what `scope` is for.
 */
import { normalizeThreadTypeName, THREAD_TYPES, type ThreadTypeEntry } from '@xyne/shared';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';

const TAG = '[ThreadTypeVocabulary]';

/** Matches the picker's cap and the stored-value cap in threadTypes.ts. */
export const MAX_NAME_LENGTH = 40;

/** A vocabulary bigger than this stops fitting in one prompt, and in one menu. */
export const MAX_ENTRIES = 40;

/**
 * Who owns an entry. `scopeId` says which one: '' for GLOBAL, the org/workspace/user id
 * otherwise. Resolution runs broadest to narrowest, so a narrower entry with the same name
 * replaces a wider one, and a narrower deleted row suppresses it.
 */
export const VOCABULARY_SCOPES = ['GLOBAL', 'ORG', 'WORKSPACE', 'USER'] as const;
export type VocabularyScope = (typeof VOCABULARY_SCOPES)[number];

/**
 * APPROVED entries are the vocabulary: the picker offers them and the classifier is given
 * them. UNDER_REVIEW is a free-form tag someone invented — recorded so an admin can promote
 * it, but withheld from both until they do. REJECTED is one an admin turned down.
 *
 * Rejection is a status, not `isDeleted`: that flag already means "this workspace removed
 * this type", and a boolean has nowhere to record WHY a name was turned down.
 *
 * A rejected name keeps everything it already had — the tag stays on its threads and stays
 * searchable. All the status governs is whether the NAME spreads: whether the picker offers
 * it, whether the classifier may assign it, and whether it can be proposed again.
 */
export const VOCABULARY_STATUSES = ['APPROVED', 'UNDER_REVIEW', 'REJECTED'] as const;
export type VocabularyStatus = (typeof VOCABULARY_STATUSES)[number];

const isStatus = (value: string): value is VocabularyStatus =>
  (VOCABULARY_STATUSES as readonly string[]).includes(value);

const isScope = (value: string): value is VocabularyScope =>
  (VOCABULARY_SCOPES as readonly string[]).includes(value);


/**
 * Short TTL rather than explicit invalidation: the classifier reads this once per thread and
 * the picker once per open, so a stale minute costs nothing, and API and worker are separate
 * processes — an in-process bust would only ever fix one of them.
 */
const CACHE_TTL_MS = 60_000;

const cache = new Map<string, { entries: ThreadTypeEntry[]; expiresAt: number }>();

export const clearVocabularyCache = (workspaceId?: string): void => {
  if (workspaceId) cache.delete(workspaceId);
  else cache.clear();
};

/** Outcome types before answer types, alphabetical within each — stable across layers. */
const inDisplayOrder = (entries: ThreadTypeEntry[]): ThreadTypeEntry[] =>
  [...entries].sort(
    (a, b) =>
      a.name.localeCompare(b.name),
  );

const toEntry = (row: {
  name: string;
  label: string;
  summary: string;
  color: string;
  description: string;
}): ThreadTypeEntry => ({
  name: row.name,
  label: row.label,
  summary: row.summary,
  color: row.color,
  description: row.description,
});

/**
 * The approved names, read straight from the database.
 *
 * `getThreadTypeVocabulary` is fine to serve a minute-old answer to a prompt or a picker. It
 * is NOT fine to diff a destructive write against: the cache is per process, so on a second
 * instance a PUT can compute "this type is already gone" from a stale list and skip the
 * removal, and the must-keep-one guard can pass on a vocabulary that is no longer there.
 * Taken inside the caller's transaction so the decision and the write see the same rows.
 */
const approvedNames = async (tx: Tx, workspaceId: string): Promise<Set<string>> => {
  const rows = await tx.threadTypeVocabulary.findMany({
    where: { ...scopeKey(workspaceId), status: 'APPROVED', isDeleted: false },
    select: { name: true },
  });
  return new Set(rows.map(row => row.name));
};

const scopeKey = (workspaceId: string): { scope: string; scopeId: string } => ({
  scope: 'WORKSPACE',
  scopeId: workspaceId,
});

/** A candidate belongs to the person who invented it, not to the workspace — see below. */
const userKey = (userId: string): { scope: string; scopeId: string } => ({
  scope: 'USER',
  scopeId: userId,
});

/**
 * Copy the starting vocabulary into a workspace.
 *
 * The list in code is a TEMPLATE, not the live vocabulary — a workspace gets its own rows so
 * the table alone answers "what can this workspace tag with". Nothing reads the template at
 * runtime.
 *
 * Explicitly invoked by an admin, never on a read: a workspace that has deliberately pared
 * its vocabulary down, or has not chosen one yet, must not have fifteen types appear because
 * somebody happened to open a thread. `skipDuplicates` makes it idempotent, so running it
 * twice adds only what is missing.
 */
export const seedWorkspaceVocabulary = async (
  workspaceId: string,
  userId: string,
): Promise<{ added: number }> => {
  const key = scopeKey(workspaceId);
  let added = 0;

  for (const entry of THREAD_TYPES) {
    const existing = await db.threadTypeVocabulary.findUnique({
      where: { scope_scopeId_name: { ...key, name: entry.name } },
      select: { id: true, isDeleted: true },
    });

    // Already live: left exactly as it is. An admin may have renamed it, recoloured it or
    // rewritten its instruction, and "add the standard types" must not quietly undo that.
    if (existing && !existing.isDeleted) continue;

    if (existing) {
      // Suppressed. Reviving is the whole point of running this again — skipping it (which is
      // what createMany's skipDuplicates did) left a workspace that had removed the standard
      // types unable to ever get them back, because the tombstone still holds the unique key.
      await db.threadTypeVocabulary.update({
        where: { id: existing.id },
        data: {
          label: entry.label,
          summary: entry.summary,
          color: entry.color,
          description: entry.description,
          status: 'APPROVED',
          isDeleted: false,
          updatedBy: userId,
          updatedAt: new Date(),
        },
      });
      added += 1;
      continue;
    }

    await db.threadTypeVocabulary.create({
      data: {
        ...key,
        workspaceId,
        name: entry.name,
        label: entry.label,
        summary: entry.summary,
        color: entry.color,
        description: entry.description,
        status: 'APPROVED',
        // The admin who installed the set. They own these like any other entry: there is no
        // authorless row, so "Proposed by" never has to show a bucket for nobody.
        createdBy: userId,
        updatedBy: userId,
      },
    });
    added += 1;
  }

  clearVocabularyCache(workspaceId);
  logger.info(`${TAG} Installed standard vocabulary`, { workspaceId, added, userId });
  return { added };
};

/**
 * The APPROVED vocabulary a workspace classifies and picks from.
 *
 * Read entirely from the table, and the table is taken at its word — including when it is
 * empty. Falling back to the list in code would resurrect types an admin deleted and would
 * give a workspace that has not chosen a vocabulary one it never asked for.
 */
export async function getThreadTypeVocabulary(workspaceId: string): Promise<ThreadTypeEntry[]> {
  const cached = cache.get(workspaceId);
  if (cached && cached.expiresAt > Date.now()) return cached.entries;

  const key = scopeKey(workspaceId);
  const rows = await db.threadTypeVocabulary.findMany({
    // UNDER_REVIEW is excluded here and only here: this call feeds both the classifier
    // prompt and the picker, so a candidate must reach neither.
    where: { ...key, status: 'APPROVED', isDeleted: false },
  });

  const entries = inDisplayOrder(rows.map(toEntry));
  cache.set(workspaceId, { entries, expiresAt: Date.now() + CACHE_TTL_MS });
  return entries;
}

export interface VocabularyInput {
  name: string;
  label: string;
  color: string;
  description: string;
  /** Omitted means APPROVED — writing an entry through the API is how a candidate is promoted. */
  status?: VocabularyStatus;
}

/**
 * Replace the workspace's overrides with exactly this list.
 *
 * The declarative form: GET the vocabulary, edit the JSON, PUT it back. Names dropped from
 * the list are suppressed. For adding or dropping one type prefer patchThreadTypeVocabulary
 * — a full replace makes two concurrent edits clobber each other.
 */
export async function setThreadTypeVocabulary(
  workspaceId: string,
  entries: VocabularyInput[],
  userId: string,
): Promise<ThreadTypeEntry[]> {
  const now = new Date();
  const key = scopeKey(workspaceId);
  const keep = new Set(entries.map(entry => entry.name));

  await db.$transaction(async tx => {
    // Read inside the transaction: what is removed is everything currently approved that the
    // caller did not resend, and that set has to be the one this write is about to act on.
    const current = await approvedNames(tx, workspaceId);
    for (const name of current) {
      if (keep.has(name)) continue;
      await tx.threadTypeVocabulary.upsert({
        where: { scope_scopeId_name: { ...key, name } },
        create: { ...key, workspaceId, ...suppression(name), createdBy: userId, updatedBy: userId },
        update: { isDeleted: true, updatedBy: userId, updatedAt: now },
      });
    }

    for (const entry of entries) {
      // Upsert on (scope, scopeId, name) so re-adding a suppressed entry revives that row
      // rather than colliding with it on the unique index.
      await tx.threadTypeVocabulary.upsert({
        where: { scope_scopeId_name: { ...key, name: entry.name } },
        create: {
          ...key,
          workspaceId,
          ...entry,
          status: entry.status ?? 'APPROVED',
          createdBy: userId,
          updatedBy: userId,
        },
        update: {
          ...entry,
          status: entry.status ?? 'APPROVED',
          isDeleted: false,
          updatedBy: userId,
          updatedAt: now,
        },
      });
    }

    await retireCandidates(tx, workspaceId, entries.map(entry => entry.name));
  });

  clearVocabularyCache(workspaceId);
  logger.info(`${TAG} Vocabulary replaced`, { workspaceId, entries: entries.length, userId });

  return getThreadTypeVocabulary(workspaceId);
}

/** A row that exists only to hide a name. Nothing renders from these fields. */
const suppression = (name: string) => ({
  name,
  label: name,
  summary: '',
  color: '#6b7280',
  description: '',
  isDeleted: true,
});

export interface VocabularyPatchResult {
  entries: ThreadTypeEntry[];
  added: string[];
  updated: string[];
  removed: string[];
  /** Names in `remove` the workspace did not have. Reported, not an error. */
  ignored: string[];
}

/**
 * Add or drop individual types without resending the whole list.
 *
 * Idempotent both ways so a script can be re-run: adding a name that already exists updates
 * it in place, and removing one that isn't there is reported under `ignored`.
 */
export async function patchThreadTypeVocabulary(
  workspaceId: string,
  patch: { add?: VocabularyInput[]; remove?: string[] },
  userId: string,
): Promise<VocabularyPatchResult> {
  const add = patch.add ?? [];
  const remove = patch.remove ?? [];
  const now = new Date();
  const key = scopeKey(workspaceId);
  const added: string[] = [];
  const updated: string[] = [];
  let removed: string[] = [];
  let ignored: string[] = [];

  await db.$transaction(async tx => {
    // Read inside the transaction rather than through the cache. Both the guard below and the
    // removed/ignored split are DECISIONS taken on this list, and a per-process cache means a
    // second instance can decide them on a vocabulary that no longer exists.
    const effective = await approvedNames(tx, workspaceId);

    // Refuse to empty the vocabulary: a workspace with nothing to pick from cannot classify.
    const surviving = new Set(effective);
    for (const name of remove) surviving.delete(name);
    for (const entry of add) surviving.add(entry.name);
    if (surviving.size === 0) {
      throw new Error('A workspace must keep at least one thread type');
    }

    removed = remove.filter(name => effective.has(name));
    ignored = remove.filter(name => !effective.has(name));

    for (const name of removed) {
      await tx.threadTypeVocabulary.upsert({
        where: { scope_scopeId_name: { ...key, name } },
        create: { ...key, workspaceId, ...suppression(name), createdBy: userId, updatedBy: userId },
        update: { isDeleted: true, updatedBy: userId, updatedAt: now },
      });
    }

    for (const entry of add) {
      (effective.has(entry.name) ? updated : added).push(entry.name);
      await tx.threadTypeVocabulary.upsert({
        where: { scope_scopeId_name: { ...key, name: entry.name } },
        create: {
          ...key,
          workspaceId,
          ...entry,
          status: entry.status ?? 'APPROVED',
          createdBy: userId,
          updatedBy: userId,
        },
        update: {
          ...entry,
          status: entry.status ?? 'APPROVED',
          isDeleted: false,
          updatedBy: userId,
          updatedAt: now,
        },
      });
    }

    await retireCandidates(tx, workspaceId, add.map(entry => entry.name));
  });

  clearVocabularyCache(workspaceId);
  logger.info(`${TAG} Vocabulary patched`, { workspaceId, userId, added, updated, removed, ignored });

  return { entries: await getThreadTypeVocabulary(workspaceId), added, updated, removed, ignored };
}

/** A vocabulary row as an admin sees it — including the ones awaiting a decision. */
export interface VocabularyRow extends ThreadTypeEntry {
  /**
   * The row id, and the only unique thing about a row.
   *
   * `name` is NOT unique here: candidates are USER-scoped, so two people inventing `p0`
   * produce two rows with the same name, both in this list. Anything keying on name — a
   * React key, a selection — collides and makes the second proposer's row unreachable.
   */
  id: string;
  scope: VocabularyScope;
  status: VocabularyStatus;
  /** Who invented it, or who installed it with the standard set. */
  createdBy: string | null;
  /** When the row was written, epoch ms. */
  proposedAt: number | null;
}

/**
 * Everything this workspace can see, approved and under review alike.
 *
 * Separate from getThreadTypeVocabulary on purpose: that one is wired to the classifier and
 * the picker and must never widen to include candidates.
 *
 * Paged, because candidates are UNBOUNDED — anyone can invent a name on any thread, and a
 * busy workspace accumulates them without limit. The approved vocabulary is capped at
 * MAX_ENTRIES and so is resolved whole; only the candidate half is paged in the database.
 */
export interface VocabularyQuery {
  statuses?: readonly VocabularyStatus[];
  /** User ids. The empty string selects rows with no recorded author. */
  proposedBy?: readonly string[];
  limit?: number;
  offset?: number;
}

/** One option in a filter, already labelled — the client should not need a user lookup. */
export interface VocabularyFacet {
  value: string;
  label: string;
  /** Only set for proposers. What the "Proposed by" search matches on. */
  email?: string;
  count: number;
}

export interface VocabularyPage {
  rows: VocabularyRow[];
  /** Rows matching the filters, ignoring the page window. */
  total: number;
  facets: {
    proposedBy: VocabularyFacet[];
    status: VocabularyFacet[];
  };
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 200;

const STATUS_LABEL: Record<string, string> = {
  APPROVED: 'Approved',
  UNDER_REVIEW: 'Under review',
  REJECTED: 'Turned down',
};

export async function listThreadTypeVocabulary(
  workspaceId: string,
  query: VocabularyQuery = {},
): Promise<VocabularyPage> {
  const statuses = query.statuses?.length ? query.statuses : VOCABULARY_STATUSES;
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const offset = Math.max(query.offset ?? 0, 0);

  const people = query.proposedBy ?? [];
  // '' is the unattributed bucket — rows written before seeding named its author.
  const wantsBuiltIn = people.includes('');
  const personIds = people.filter(Boolean);

  const proposedByWhere = (): Record<string, unknown> => {
    if (people.length === 0) return {};
    if (wantsBuiltIn && personIds.length > 0) {
      return { OR: [{ createdBy: null }, { createdBy: { in: personIds } }] };
    }
    return wantsBuiltIn ? { createdBy: null } : { createdBy: { in: personIds } };
  };

  // Each facet group is counted with every OTHER group's filter applied but not its own, so
  // `ignore` drops exactly one clause.
  const whereFor = (ignore?: 'proposedBy' | 'status'): Record<string, unknown> => ({
    workspaceId,
    // Suppressed types are gone from the workspace's point of view; the row survives only so
    // the removal is not silently undone.
    isDeleted: false,
    ...(ignore === 'status' ? {} : { status: { in: [...statuses] } }),
    ...(ignore === 'proposedBy' ? {} : proposedByWhere()),
  });

  const where = whereFor();
  const [total, rows] = await Promise.all([
    db.threadTypeVocabulary.count({ where }),
    db.threadTypeVocabulary.findMany({
      where,
      // Newest first: the sort the UI would prefer — most-used — lives in Vespa, and ordering
      // a database page by a column the database does not have would sort only within the
      // page, which is worse than not sorting.
      orderBy: [{ createdAt: 'desc' }, { name: 'asc' }],
      skip: offset,
      take: limit,
    }),
  ]);

  return {
    rows: rows.map(row => ({
      ...toEntry(row),
      id: row.id,
      scope: isScope(row.scope) ? row.scope : ('USER' as VocabularyScope),
      status: isStatus(row.status) ? row.status : ('UNDER_REVIEW' as VocabularyStatus),
      createdBy: row.createdBy,
      proposedAt: row.createdAt.getTime(),
    })),
    total,
    facets: await buildFacets(whereFor),
  };
}

/**
 * Option counts for the toolbar.
 *
 * Each group is counted with every OTHER group's filter applied but not its own — otherwise
 * selecting one proposer would zero out every other proposer, and the filter could never be
 * widened again. Server-side because the client only holds one page and cannot count what it
 * has not been sent.
 */
async function buildFacets(
  whereFor: (ignore?: 'proposedBy' | 'status') => Record<string, unknown>,
): Promise<VocabularyPage['facets']> {
  const [byPerson, byStatus] = await Promise.all([
    db.threadTypeVocabulary.groupBy({
      by: ['createdBy'],
      where: whereFor('proposedBy') as never,
      _count: { _all: true },
    }),
    db.threadTypeVocabulary.groupBy({
      by: ['status'],
      where: whereFor('status') as never,
      _count: { _all: true },
    }),
  ]);

  // Names and emails come from here rather than from the client's user map: a proposer who
  // has left, or whom the client has not synced, would otherwise render as "Someone" and be
  // unsearchable by email — which is the whole point of the search.
  const ids = byPerson.map(group => group.createdBy).filter((id): id is string => Boolean(id));
  const users = ids.length
    ? await db.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const userById = new Map(users.map(user => [user.id, user]));

  const byCount = (a: VocabularyFacet, b: VocabularyFacet): number =>
    b.count - a.count || a.label.localeCompare(b.label);

  return {
    proposedBy: byPerson
      .map(group => {
        // Nothing writes a null proposer any more; rows predating that read as System rather
        // than being dropped, which would make them unfilterable.
        if (!group.createdBy) {
          return { value: '', label: 'System', count: group._count._all };
        }
        const user = userById.get(group.createdBy);
        return {
          value: group.createdBy,
          label: user?.name ?? 'Someone',
          email: user?.email ?? '',
          count: group._count._all,
        };
      })
      .sort(byCount),
    status: byStatus
      .map(group => ({
        value: group.status,
        label: STATUS_LABEL[group.status] ?? group.status,
        count: group._count._all,
      }))
      .sort(byCount),
  };
}

/** Every tag this person has invented, across the workspaces they work in. */
export async function listTagsCreatedBy(
  userId: string,
  workspaceId?: string,
): Promise<VocabularyRow[]> {
  const rows = await db.threadTypeVocabulary.findMany({
    where: { ...userKey(userId), isDeleted: false, ...(workspaceId ? { workspaceId } : {}) },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(row => ({
    ...toEntry(row),
    id: row.id,
    scope: isScope(row.scope) ? row.scope : ('USER' as VocabularyScope),
    // Read the stored value rather than collapsing "not under review" to approved — that
    // would report a name this person proposed and had turned down as though it had been
    // accepted into the vocabulary.
    status: isStatus(row.status) ? row.status : ('UNDER_REVIEW' as VocabularyStatus),
    createdBy: row.createdBy,
    proposedAt: row.createdAt.getTime(),
  }));
}

/**
 * Record a free-form tag as a candidate for the vocabulary.
 *
 * Written at USER scope, not WORKSPACE. A candidate is one person's suggestion — workspace
 * scope is what approval CONFERS, not where a proposal starts. Scoping it to the inventor is
 * also the only way "which tags has Arun created" is answerable: at workspace scope, two
 * people inventing the same name collapse into one row and the second creation is lost.
 *
 * The tag still lands on the thread regardless. This only governs whether the NAME becomes
 * something the picker offers and the classifier may assign.
 */
export async function recordVocabularyCandidate(
  workspaceId: string,
  name: string,
  userId: string,
  description = '',
): Promise<void> {
  try {
    // A name someone has already turned down does not come back. The upsert below is keyed on
    // (scope, scopeId, name), so re-typing your OWN rejected tag is a no-op anyway — but a
    // DIFFERENT person typing it would open a fresh candidate, and the queue would refill with
    // a decision that has already been made.
    const turnedDown = await db.threadTypeVocabulary.findFirst({
      where: { workspaceId, name, status: 'REJECTED' },
      select: { id: true },
    });
    if (turnedDown) {
      logger.info(`${TAG} Skipping candidate for a name already turned down`, {
        workspaceId,
        name,
        userId,
      });
      return;
    }

    await db.threadTypeVocabulary.upsert({
      where: { scope_scopeId_name: { ...userKey(userId), name } },
      create: {
        ...userKey(userId),
        // Kept alongside the scope so tenant filtering and cleanup still run off a real
        // column — scopeId is polymorphic and cannot carry a foreign key.
        workspaceId,
        name,
        // Placeholders an admin edits on approval. The label is the raw name so the review
        // screen shows what was actually typed.
        label: name,
        color: '#6b7280',
        // The note the inventor typed, if they gave one. It belongs here rather than on the
        // thread: it explains what the TAG means, so it is written once and every chip of
        // that name renders it — and it gives an admin something to judge on promotion.
        description,
        status: 'UNDER_REVIEW',
        createdBy: userId,
        updatedBy: userId,
      },
      // Re-using their own tag changes nothing, except that a note fills in a description
      // they did not give the first time.
      update: description ? { description, updatedBy: userId } : {},
    });
    logger.info(`${TAG} Recorded free-form tag as a candidate`, { workspaceId, name, userId });
  } catch (error) {
    // Never fail the tag write for this — the label is on the thread either way.
    logger.error(`${TAG} Failed to record vocabulary candidate`, { workspaceId, name, error });
  }
}

/**
 * Turn down every outstanding proposal of these names.
 *
 * Workspace-wide, mirroring promotion: candidates are USER-scoped, so rejecting only the row
 * you were looking at would leave an identical proposal from someone else sitting in the
 * queue. A decision is about the NAME, not about who happened to type it first.
 *
 * Nothing is deleted. The tag stays on its threads and stays searchable — see VocabularyStatus.
 */
export async function rejectVocabularyCandidates(
  workspaceId: string,
  names: string[],
  userId: string,
): Promise<number> {
  if (names.length === 0) return 0;
  const { count } = await db.threadTypeVocabulary.updateMany({
    where: { workspaceId, status: 'UNDER_REVIEW', name: { in: names } },
    data: { status: 'REJECTED', updatedBy: userId, updatedAt: new Date() },
  });
  clearVocabularyCache(workspaceId);
  logger.info(`${TAG} Candidates turned down`, { workspaceId, names, count, userId });
  return count;
}

/** Put a turned-down name back in the queue. */
export async function reconsiderVocabularyCandidates(
  workspaceId: string,
  names: string[],
  userId: string,
): Promise<number> {
  if (names.length === 0) return 0;
  const { count } = await db.threadTypeVocabulary.updateMany({
    where: { workspaceId, status: 'REJECTED', name: { in: names } },
    data: { status: 'UNDER_REVIEW', updatedBy: userId, updatedAt: new Date() },
  });
  clearVocabularyCache(workspaceId);
  logger.info(`${TAG} Candidates reopened`, { workspaceId, names, count, userId });
  return count;
}

/**
 * Promoting a name to the workspace retires every user's candidate for it — the suggestion
 * has been answered, and leaving them would keep the name in the review queue forever.
 */
const retireCandidates = async (tx: Tx, workspaceId: string, names: string[]): Promise<void> => {
  if (names.length === 0) return;

  // Names are normalised where they are INVENTED, so a proposal and the entry that approves
  // it are already the same string and this is an exact match. It is still routed through
  // normalizeThreadTypeName rather than compared raw, so that rows written before that rule
  // existed still retire instead of sitting in the queue forever.
  const promoted = new Set(names.map(normalizeThreadTypeName));
  const outstanding = await tx.threadTypeVocabulary.findMany({
    where: { workspaceId, scope: 'USER', status: 'UNDER_REVIEW' },
    select: { id: true, name: true },
  });
  const resolved = outstanding
    .filter(row => promoted.has(normalizeThreadTypeName(row.name)))
    .map(row => row.id);
  if (resolved.length === 0) return;

  await tx.threadTypeVocabulary.updateMany({
    where: { id: { in: resolved } },
    data: { status: 'APPROVED', updatedAt: new Date() },
  });
};

/** Prisma's transaction client, so the helper above composes inside one. */
type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];
