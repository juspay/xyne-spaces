import type { Action } from '@xyne/workflow-sdk';
import { canPerform } from '../../utils/permissions.js';
import type { BrowserEntry } from './types.js';

/**
 * Row-action policy, expressed once so grid and list gate identically. A file
 * entry is a workflow, a folder entry is a folder; the operation maps to that
 * resource's action (`rename`/`move` → `*:update`, `delete` → `*:delete`,
 * `share` → `*:share`). `canPerform` returns true when a row has no
 * `permittedActions` (optimistic; the backend still enforces).
 */
export type RowOp = 'update' | 'delete' | 'share';

export function entryCan(entry: BrowserEntry, op: RowOp): boolean {
  const resource = entry.kind === 'file' ? 'workflow' : 'folder';
  return canPerform(entry.permittedActions, `${resource}:${op}` as Action);
}
