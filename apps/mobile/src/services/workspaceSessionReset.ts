import { dropAllDatabases } from '@rocicorp/zero';
import {
  flushQueryCachePersistence,
  queryCacheActor,
  stateMachineActor,
} from '@xyne/shared/machines';
import { clearDismissedTwinDrafts } from '@/src/features/drafts-sent/twin-draft-dismissed';
import { mmkvStorageAdapter } from './mmkvStorageAdapter';

type WorkspaceSwitchLifecycle = {
  onBeforeWorkspaceSwitch?: () => void;
};

let workspaceSwitchLifecycle: WorkspaceSwitchLifecycle = {};

/** Blocks stale delta/initial-load handlers on the dying shell during switch. */
let workspaceSwitchInProgress = false;

/** When true, the next Zero init should drop local SQLite before connecting. */
let dropDatabasesOnNextZeroInit = false;

export function beginWorkspaceSwitch(): void {
  workspaceSwitchInProgress = true;
  dropDatabasesOnNextZeroInit = true;
}

export function endWorkspaceSwitch(): void {
  if (!workspaceSwitchInProgress) {
    return;
  }
  workspaceSwitchInProgress = false;
}

export function isWorkspaceSwitchInProgress(): boolean {
  return workspaceSwitchInProgress;
}

/** One-shot: consumed by ZeroProvider before creating a new Zero client. */
export function consumeDropDatabasesOnZeroInit(): boolean {
  if (!dropDatabasesOnNextZeroInit) {
    return false;
  }
  dropDatabasesOnNextZeroInit = false;
  return true;
}

/** Register hooks that must run before a workspace switch (e.g. startup phase reset). */
export function registerWorkspaceSwitchLifecycle(handlers: WorkspaceSwitchLifecycle): () => void {
  workspaceSwitchLifecycle = { ...workspaceSwitchLifecycle, ...handlers };
  return () => {
    if (workspaceSwitchLifecycle.onBeforeWorkspaceSwitch === handlers.onBeforeWorkspaceSwitch) {
      delete workspaceSwitchLifecycle.onBeforeWorkspaceSwitch;
    }
  };
}

function notifyBeforeWorkspaceSwitch(): void {
  workspaceSwitchLifecycle.onBeforeWorkspaceSwitch?.();
}

function clearQueryCacheSessionState(): void {
  queryCacheActor.send({ type: 'HYDRATE_CACHE', cacheData: {} });
  queryCacheActor.send({ type: 'HYDRATE_CONVERSATIONS', conversationsData: {} });
  queryCacheActor.send({ type: 'HYDRATE_THREAD_CONVERSATIONS', threadConversationsData: {} });
  queryCacheActor.send({ type: 'HYDRATE_CALL_HISTORY', data: { calls: [], hasMore: true } });
  queryCacheActor.send({
    type: 'HYDRATE_RECORDINGS',
    data: { recordings: [], hasMore: true },
  });
}

function closeWorkspaceCachePersistence(): void {
  // Persist the outgoing actor snapshot while its adapter scope is still
  // active. Closing first prevents the actor reset below from being observed
  // as a request to delete every outgoing workspace entity.
  flushQueryCachePersistence();
  mmkvStorageAdapter.flushPendingQueryCacheWrites();
  mmkvStorageAdapter.close();
}

/** Clears in-memory actors without tearing down Zero DB (safe before shell remount). */
export function syncResetWorkspaceSessionState(): void {
  notifyBeforeWorkspaceSwitch();
  closeWorkspaceCachePersistence();
  stateMachineActor.send({ type: 'RESET_WORKSPACE_SESSION' });
  clearQueryCacheSessionState();
  // Twin hide-set is session-scoped; clear so handled ids do not leak across
  // workspace switches (or grow for the whole JS process). Keep intact across
  // in-session Zero reloads — those do not call this reset.
  clearDismissedTwinDrafts();
}

export async function dropWorkspaceDatabases(): Promise<void> {
  try {
    await dropAllDatabases();
  } catch {
    // ignore — DB may already be closed or absent during teardown
  }
}

/**
 * Clears in-memory workspace session state so a workspace switch can cold-start
 * like a fresh login (users, channels, query cache, local Zero DB).
 */
export async function resetWorkspaceSessionState(): Promise<void> {
  if (!workspaceSwitchInProgress) {
    beginWorkspaceSwitch();
  }
  syncResetWorkspaceSessionState();
  await dropWorkspaceDatabases();
}
