import { ChannelScopeType, ChannelVisibility, ProjectType, UserStatus } from '@xyne/shared';
import type { FieldOption, FieldOptionsContext, FieldOptionsPage } from '@xyne/workflow-sdk';
import { db } from '@/database/client';
import type { XyneCtx } from '../../types';
import { decodeSeek, encodeSeek } from '../../utils';

/**
 * Loaders behind the builder's pickers — one per kind of thing, called by name.
 *
 * Automations resolved these in the browser from Zero-synced queries
 * (`useAllChannels`, `useUsers`, …). `workflow-ui` is server-driven and has no
 * Zero, so the same lists are answered here.
 *
 * Every loader answers in one of two modes, and the editor uses both:
 *
 * - **describe** (`q.values`) — it reopened a saved workflow holding ids and no
 *   labels and is asking what they were. Answer those, no paging.
 * - **browse** — filter by `q.search` in the query, return one page, and hand
 *   back a `nextCursor` if there is more. The picker's Load-more reads it.
 *
 * Each loader is written out rather than sharing a "generic lookup", because
 * they are not the same shape: channels have a visibility rule, stages have no
 * ids at all, users match on two columns, boards narrow by project. Three small
 * helpers do the parts that genuinely repeat; the rest reads top to bottom.
 */

const PAGE = 25;
const BY_NAME = [{ name: 'asc' as const }, { id: 'asc' as const }];

/** Nothing to offer. Distinct from a notice, which means "cannot answer yet". */
export const noOptions: FieldOptionsPage = { items: [] };

/** Everything a loader reads from the editing session, and nothing else. */
export interface OptionsQuery {
  readonly workspaceId: string;
  readonly callerUserId: string;
  readonly search?: string | undefined;
  readonly cursor?: string | undefined;
  /** Ids to describe rather than search for. */
  readonly values?: readonly string[] | undefined;
}

/**
 * The editor's context, narrowed to what loaders use. Generic over the
 * component's own config so `ctx.literal` stays typed at the call site.
 */
export function optionsQuery<TConfig>(
  ctx: FieldOptionsContext<TConfig, Record<string, unknown>, XyneCtx>,
): OptionsQuery {
  return {
    workspaceId: ctx.attributes.workspaceId ?? ctx.caller.workspaceId,
    callerUserId: ctx.caller.userId,
    search: ctx.search,
    cursor: ctx.cursor,
    values: ctx.values,
  };
}

// ── the three things that genuinely repeat ───────────────────────────────────

/** Case-insensitive contains, or nothing when the author has not typed. */
const nameLike = (search: string | undefined) =>
  search?.trim() ? { name: { contains: search.trim(), mode: 'insensitive' as const } } : {};

/** Rows after the cursor's position, as a `(name, id)` tuple comparison. */
const after = (cursor: string | undefined) => {
  const [name, id] = (cursor !== undefined ? decodeSeek(cursor) : null) ?? [];
  return name !== undefined && id !== undefined
    ? { OR: [{ name: { gt: name } }, { AND: [{ name }, { id: { gt: id } }] }] }
    : {};
};

/** One browse page: trims the probe row and emits a cursor only if there is more. */
function page<T extends { id: string; name: string }>(
  rows: T[],
  label: (row: T) => FieldOption,
): FieldOptionsPage {
  if (rows.length <= PAGE) return { items: rows.map(label) };
  const shown = rows.slice(0, PAGE);
  const last = shown[shown.length - 1]!;
  return { items: shown.map(label), nextCursor: encodeSeek([last.name, last.id]) };
}

// ── loaders ──────────────────────────────────────────────────────────────────

/**
 * Channels the caller can see. DMs are not something a workflow is scoped to —
 * the automations picker hid them too — and a private channel the caller is not
 * in must not even be named back to them.
 */
export async function channelOptions(
  q: OptionsQuery,
  projectIds?: readonly string[] | undefined,
): Promise<FieldOptionsPage> {
  const narrowed = (projectIds ?? []).filter((id) => !!id?.trim());
  const visible = {
    workspaceId: q.workspaceId,
    // Matches automations' picker, which hid DMs and group DMs and nothing else.
    // (`browsableChannels` in zero/queries.ts is stricter — DEFAULT only — but
    // that is a different picker, and parity here is with automations.)
    scopeType: { notIn: [ChannelScopeType.DM, ChannelScopeType.GROUP_DM] },
    // The codebase's canonical read rule, as `zero/queries.ts` states it: public,
    // or private and you are in it. A channel is one or the other, so testing
    // membership alone on the second arm is the same set.
    OR: [
      { visibility: ChannelVisibility.PUBLIC },
      { participants: { some: { userId: q.callerUserId } } },
    ],
    // Automations narrowed the channel list by the trigger's selected projects.
    ...(narrowed.length > 0 ? { projectId: { in: [...narrowed] } } : {}),
  };
  const select = { id: true, name: true, visibility: true };
  const label = (r: { id: string; name: string; visibility: string }): FieldOption => ({
    value: r.id,
    label: r.name,
    ...(r.visibility === 'PRIVATE' ? { hint: 'private' } : {}),
    icon: 'hash',
  });

  if (q.values?.length) {
    const rows = await db.channel.findMany({
      where: { ...visible, id: { in: [...q.values] } },
      select,
      orderBy: BY_NAME,
    });
    return { items: rows.map(label) };
  }
  const rows = await db.channel.findMany({
    where: { ...visible, ...nameLike(q.search), ...after(q.cursor) },
    select,
    orderBy: BY_NAME,
    take: PAGE + 1,
  });
  return page(rows, label);
}

export async function projectOptions(q: OptionsQuery): Promise<FieldOptionsPage> {
  // A DM is stored as a project; `getAllProjectsList` excludes them and so must
  // this, or every direct message shows up as a pickable "project".
  const real = { workspaceId: q.workspaceId, type: { not: ProjectType.DM } };
  const select = { id: true, name: true };
  const label = (r: { id: string; name: string }): FieldOption => ({
    value: r.id,
    label: r.name,
    icon: 'folder',
  });

  if (q.values?.length) {
    const rows = await db.project.findMany({
      where: { ...real, id: { in: [...q.values] } },
      select,
      orderBy: BY_NAME,
    });
    return { items: rows.map(label) };
  }
  const rows = await db.project.findMany({
    where: { ...real, ...nameLike(q.search), ...after(q.cursor) },
    select,
    orderBy: BY_NAME,
    take: PAGE + 1,
  });
  return page(rows, label);
}

/**
 * Boards, narrowed to the projects already chosen when there are any — the one
 * question only `literal` can answer, and why the caller passes it.
 */
export async function boardOptions(
  q: OptionsQuery,
  projectIds?: readonly string[] | undefined,
): Promise<FieldOptionsPage> {
  const narrowed = (projectIds ?? []).filter((id) => !!id?.trim());
  const inProjects = narrowed.length > 0 ? { projectId: { in: [...narrowed] } } : {};
  const select = { id: true, name: true };
  const label = (r: { id: string; name: string }): FieldOption => ({
    value: r.id,
    label: r.name,
    icon: 'columns',
  });

  if (q.values?.length) {
    const rows = await db.board.findMany({
      where: { workspaceId: q.workspaceId, id: { in: [...q.values] } },
      select,
      orderBy: BY_NAME,
    });
    return { items: rows.map(label) };
  }
  const rows = await db.board.findMany({
    where: { workspaceId: q.workspaceId, ...inProjects, ...nameLike(q.search), ...after(q.cursor) },
    select,
    orderBy: BY_NAME,
    take: PAGE + 1,
  });
  return rows.length === 0 && narrowed.length > 0
    ? { items: [], notice: 'No boards in the selected project.' }
    : page(rows, label);
}

/**
 * Stage names for the chosen boards.
 *
 * The odd one out: `stageName` stores the name, not an id, so the value IS the
 * label and there is nothing to page by. The same name can exist on several
 * boards, so they are de-duplicated, and they are ordered by the board's own
 * sequence rather than alphabetically because that is the order authors think in.
 */
export async function stageOptions(
  q: OptionsQuery,
  boardIds: readonly string[] | undefined,
): Promise<FieldOptionsPage> {
  const narrowed = (boardIds ?? []).filter((id) => !!id?.trim());
  if (narrowed.length === 0 && !q.values?.length) {
    // Not "there are none" — "not answerable yet", which the editor says out loud.
    return { items: [], notice: 'Choose a board first — stages are defined per board.' };
  }

  const rows = await db.stage.findMany({
    where: {
      workspaceId: q.workspaceId,
      ...(narrowed.length > 0 ? { boardId: { in: [...narrowed] } } : {}),
      ...(q.values?.length ? { name: { in: [...q.values] } } : nameLike(q.search)),
    },
    select: { name: true, sequenceNumber: true },
    orderBy: [{ sequenceNumber: 'asc' }, { name: 'asc' }],
    take: PAGE,
  });

  const seen = new Set<string>();
  const items: FieldOption[] = [];
  for (const row of rows) {
    if (seen.has(row.name)) continue;
    seen.add(row.name);
    items.push({ value: row.name, label: row.name, icon: 'flag' });
  }
  return { items };
}

/** People. Matched on name or address, since an author knows one or the other. */
export async function userOptions(q: OptionsQuery): Promise<FieldOptionsPage> {
  // `useActiveUsers` — deactivated people must not appear in assignment pickers.
  const active = { workspaceId: q.workspaceId, status: UserStatus.ACTIVE };
  const select = { id: true, name: true, email: true };
  const label = (r: { id: string; name: string; email: string }): FieldOption => ({
    value: r.id,
    label: r.name,
    description: r.email,
    icon: 'user',
  });

  if (q.values?.length) {
    const rows = await db.user.findMany({
      where: { ...active, id: { in: [...q.values] } },
      select,
      orderBy: BY_NAME,
    });
    return { items: rows.map(label) };
  }
  const search = q.search?.trim();
  const rows = await db.user.findMany({
    where: {
      ...active,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...after(q.cursor),
    },
    select,
    orderBy: BY_NAME,
    take: PAGE + 1,
  });
  return page(rows, label);
}

export async function userGroupOptions(q: OptionsQuery): Promise<FieldOptionsPage> {
  const select = { id: true, name: true, alias: true };
  const label = (r: { id: string; name: string; alias: string | null }): FieldOption => ({
    value: r.id,
    label: r.name,
    ...(r.alias ? { description: `@${r.alias}` } : {}),
    icon: 'users',
  });

  if (q.values?.length) {
    const rows = await db.userGroup.findMany({
      where: { workspaceId: q.workspaceId, id: { in: [...q.values] } },
      select,
      orderBy: BY_NAME,
    });
    return { items: rows.map(label) };
  }
  const rows = await db.userGroup.findMany({
    where: { workspaceId: q.workspaceId, ...nameLike(q.search), ...after(q.cursor) },
    select,
    orderBy: BY_NAME,
    take: PAGE + 1,
  });
  return page(rows, label);
}
