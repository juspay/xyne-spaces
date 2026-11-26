import { ChannelScopeType, ChannelVisibility } from '@xyne/shared';
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
 * they are not the same shape: channels have a visibility rule, boards do not.
 * Three small helpers do the parts that genuinely repeat.
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

/**
 * These return WHERE FRAGMENTS, and fragments are combined with `AND: [...]`,
 * never by spreading them into one object.
 *
 * Spreading looks equivalent and is not: two fragments that both use `OR` —
 * the channel visibility rule and the keyset seek, say — collide on the key,
 * and the later one silently wins. That dropped the visibility filter on every
 * page after the first, which is an ACL bypass that page one cannot show you.
 */

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
export async function channelOptions(q: OptionsQuery): Promise<FieldOptionsPage> {
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
      where: { AND: [visible, { id: { in: [...q.values] } }] },
      select,
      orderBy: BY_NAME,
    });
    return { items: rows.map(label) };
  }
  const rows = await db.channel.findMany({
    where: { AND: [visible, nameLike(q.search), after(q.cursor)] },
    select,
    orderBy: BY_NAME,
    take: PAGE + 1,
  });
  return page(rows, label);
}

/** SDLC hubs the caller can read, by the same rule as `requireSdlcHubReader`. */
export async function sdlcHubOptions(q: OptionsQuery): Promise<FieldOptionsPage> {
  const visible = {
    workspaceId: q.workspaceId,
    type: 'SDLC' as const,
    OR: [
      { visibility: ChannelVisibility.PUBLIC },
      { participants: { some: { userId: q.callerUserId } } },
    ],
  };
  const select = { id: true, name: true };
  const label = (r: { id: string; name: string }): FieldOption => ({ value: r.id, label: r.name, icon: 'hash' });

  if (q.values?.length) {
    const rows = await db.channel.findMany({
      where: { AND: [visible, { id: { in: [...q.values] } }] },
      select,
      orderBy: BY_NAME,
    });
    return { items: rows.map(label) };
  }
  const rows = await db.channel.findMany({
    where: { AND: [visible, nameLike(q.search), after(q.cursor)] },
    select,
    orderBy: BY_NAME,
    take: PAGE + 1,
  });
  return page(rows, label);
}

export async function boardOptions(q: OptionsQuery): Promise<FieldOptionsPage> {
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
    where: {
      AND: [{ workspaceId: q.workspaceId }, nameLike(q.search), after(q.cursor)],
    },
    select,
    orderBy: BY_NAME,
    take: PAGE + 1,
  });
  return page(rows, label);
}
