import type { Context } from '../../schema';

/**
 * Slack Connect — tables whose tenancy is resolved via `connect_group` (they carry a
 * `connectId` and a `connectGroup` relationship on it). Channels are added in Step 6.
 */
export const CONNECT_SCOPED_TABLES = new Set<string>([
  'canvases',
  'canvas_versions',
  'canvas_participants',
  'canvas_user_status',
  'canvas_comment_threads',
  'canvas_comments',
]);

/**
 * Canvas CHILD tables carry the parent canvas's connect handle in a column named `canvasConnectId`
 * (the parent `canvases` and `connect_group` keep `connectId`). The null-fallback check below must
 * reference the row's own column, so callers resolve it per table via `connectColumnForTable`.
 */
const CANVAS_CHILD_CONNECT_TABLES = new Set<string>([
  'canvas_versions',
  'canvas_participants',
  'canvas_user_status',
  'canvas_comment_threads',
  'canvas_comments',
]);

/** The connect-handle column for a connect-scoped table: canvas children use `canvasConnectId`. */
export function connectColumnForTable(table: string): string {
  return CANVAS_CHILD_CONNECT_TABLES.has(table) ? 'canvasConnectId' : 'connectId';
}

/**
 * The workspace-truth predicate. A row is reachable when its connect handle belongs to a
 * `connect_group` the caller's workspace participates in (host OR invited, ACTIVE); a row with no
 * connect handle falls back to `legacy` (default: `workspaceId = ctx.workspaceId`).
 *
 * This is the per-row realization of "connect handle present → connect_group truth, else current".
 * No env flag — the ACL always honors connect_group when the handle is set. Requires a `connectGroup`
 * relationship on the table. `connectColumn` is the row's own handle column — `connectId` for the
 * parent entity, `canvasConnectId` for canvas children (pass `connectColumnForTable(table)`).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function connectReach(ctx: Context, legacy?: (helpers: any) => any, connectColumn = 'connectId') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (helpers: any) => {
    const { or, and, cmp, exists } = helpers;
    const fallback = legacy ? legacy(helpers) : cmp('workspaceId', ctx.workspaceId);
    return or(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      exists('connectGroup', (g: any) =>
        g
          .where('status', 'ACTIVE')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .where(({ or: o, cmp: c }: any) =>
            o(c('hostWorkspaceId', ctx.workspaceId), c('invitedWorkspaceId', ctx.workspaceId)),
          ),
      ),
      and(cmp(connectColumn, 'IS', null), fallback),
    );
  };
}
