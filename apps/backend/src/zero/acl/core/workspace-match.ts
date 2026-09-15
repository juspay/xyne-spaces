import { MutationACLError, type QueryContext } from './types';

/**
 * Throws if the supplied workspaceId does not match the caller's workspace.
 * Used by mutation ACLs to enforce tenant isolation on insert/update/delete.
 */
export function assertWorkspaceMatch(
  ctx: QueryContext,
  workspaceId: string | null | undefined,
  tableName: string,
): void {
  if (!workspaceId || workspaceId !== ctx.workspaceId) {
    throw new MutationACLError(
      `${tableName} operation failed: workspace ID mismatch`,
      tableName,
    );
  }
}
