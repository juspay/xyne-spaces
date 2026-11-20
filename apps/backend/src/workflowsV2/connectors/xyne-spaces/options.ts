import type { FieldOption, FieldOptionsContext, FieldOptionsPage } from '@xyne/workflow-sdk';
import { db } from '@/database/client';
import type { XyneCtx } from '../../types';
import { decodeSeek, encodeSeek } from '../../utils';

/**
 * The board picker behind the builder. Two modes: **describe** (`values` — a saved workflow
 * holds ids and no labels) and **browse** (`search`, one page, a `nextCursor` if there is more).
 * Where fragments are combined, use `AND: [...]`, never a spread: two `OR` keys collide.
 */

const PAGE = 25;
const BY_NAME = [{ name: 'asc' as const }, { id: 'asc' as const }];

/** Nothing to offer. Distinct from a notice, which means "cannot answer yet". */
export const noOptions: FieldOptionsPage = { items: [] };

/** Everything the loader reads from the editing session, and nothing else. */
export interface OptionsQuery {
  readonly workspaceId: string;
  readonly search?: string | undefined;
  readonly cursor?: string | undefined;
  /** Ids to describe rather than search for. */
  readonly values?: readonly string[] | undefined;
}

export function optionsQuery<TConfig>(
  ctx: FieldOptionsContext<TConfig, Record<string, unknown>, XyneCtx>,
): OptionsQuery {
  return {
    workspaceId: ctx.attributes.workspaceId ?? ctx.caller.workspaceId,
    search: ctx.search,
    cursor: ctx.cursor,
    values: ctx.values,
  };
}

const label = (r: { id: string; name: string }): FieldOption => ({ value: r.id, label: r.name, icon: 'columns' });

export async function boardOptions(q: OptionsQuery): Promise<FieldOptionsPage> {
  const select = { id: true, name: true };
  if (q.values?.length) {
    const rows = await db.board.findMany({
      where: { workspaceId: q.workspaceId, id: { in: [...q.values] } },
      select,
      orderBy: BY_NAME,
    });
    return { items: rows.map(label) };
  }
  const search = q.search?.trim();
  const [name, id] = (q.cursor !== undefined ? decodeSeek(q.cursor) : null) ?? [];
  const rows = await db.board.findMany({
    where: {
      AND: [
        { workspaceId: q.workspaceId },
        search ? { name: { contains: search, mode: 'insensitive' as const } } : {},
        name !== undefined && id !== undefined
          ? { OR: [{ name: { gt: name } }, { AND: [{ name }, { id: { gt: id } }] }] }
          : {},
      ],
    },
    select,
    orderBy: BY_NAME,
    take: PAGE + 1,
  });
  if (rows.length <= PAGE) return { items: rows.map(label) };
  const shown = rows.slice(0, PAGE);
  const last = shown[shown.length - 1]!;
  return { items: shown.map(label), nextCursor: encodeSeek([last.name, last.id]) };
}
