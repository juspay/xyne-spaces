import { createContext, useContext } from 'react';
import type { WorkflowChangeKind } from '@xyne/workflow-sdk';

/**
 * A workflow topic carries that definition's changes and its runs; a folder
 * topic carries the runs of every workflow inside it. Lists watch the folder —
 * subscribing per row would rebuild the connection on every page. A `root` topic
 * carries every run under the caller's own root scope — the feed behind the
 * unscoped Executions list, which has no workflow or folder to scope to; its id
 * is a constant, because the server derives the real root id from the session.
 */
export interface LiveTopic {
  kind: 'workflow' | 'folder' | 'root';
  id: string;
}

/** `workflow:wf_1` — the registry key, and what the provider sends upstream. */
export const topicKey = (topic: LiveTopic): string => `${topic.kind}:${topic.id}`;

/**
 * Why a subscriber is being told to look again.
 *
 * - `changed` — the workflow definition changed, and `change` says how.
 * - `run` — a run under this topic appeared or changed status; `executionId`
 *   and `status` say which and to what. A list re-reads its page; a list that
 *   does not care about that status can ignore it.
 * - `resync` — the connection came back after a drop. The stream cannot replay,
 *   so anything published while it was down is gone: re-read regardless of
 *   whether a change was actually missed. The recovery path and the happy path
 *   then run the same code, which is the only way the rare one stays correct.
 */
export interface LiveChange {
  /** The workflow the change concerns. Present for every reason but `resync`. */
  workflowId?: string;
  reason: 'changed' | 'run' | 'resync';
  change?: WorkflowChangeKind;
  executionId?: string;
  status?: string;
  /**
   * Carried only on the root feed, and only when a run is created, so the
   * unscoped list can render a brand-new row in place without an authorized GET.
   * Absent on workflow/folder topics and on status-only updates.
   */
  workflowName?: string;
  /** Epoch ms creation time of the run — present with `workflowName` on a new row. */
  createdAt?: number;
}

export type LiveListener = (change: LiveChange) => void;

export interface LiveContextValue {
  /**
   * Register interest in a topic. Returns a cleanup that deregisters it.
   *
   * Registering is not the same as connecting: the provider pools every watcher
   * into one connection and reopens it when the set settles.
   */
  watch: (topic: LiveTopic, listener: LiveListener) => () => void;
  /** False while no connection is open — nothing is watched, or it is retrying. */
  connected: boolean;
}

/**
 * Null when the host has not mounted the live layer. Every consumer degrades to
 * "no live updates" rather than throwing, so a host can leave it off.
 */
export const LiveContext = createContext<LiveContextValue | null>(null);

export function useLiveContext(): LiveContextValue | null {
  return useContext(LiveContext);
}
