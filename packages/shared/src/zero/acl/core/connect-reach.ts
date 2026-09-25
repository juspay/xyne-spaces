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
 * The workspace-truth predicate. A row is reachable when its `connectId` belongs to a
 * `connect_group` the caller's workspace participates in (host OR invited, ACTIVE); a row with
 * no `connectId` falls back to `legacy` (default: `workspaceId = ctx.workspaceId`).
 *
 * This is the per-row realization of "connectId present → connect_group truth, else current".
 * No env flag — the ACL always honors connect_group when a connectId is set. Requires a
 * `connectGroup` relationship (sourceField `connectId`) on the table.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function connectReach(ctx: Context, legacy?: (helpers: any) => any) {
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
      and(cmp('connectId', 'IS', null), fallback),
    );
  };
}
