import * as React from 'react';
import type { RunChangeEvent, WorkflowChangeEvent } from '@xyne/workflow-sdk';
import type { WorkflowClient } from '@xyne/workflow-sdk/client';
import {
  LiveContext,
  topicKey,
  type LiveContextValue,
  type LiveListener,
  type LiveTopic,
} from './live-context.js';

/**
 * How long the watched set must hold still before the connection is rebuilt.
 *
 * Mounting a screen registers several watchers in the same tick, and navigation
 * unregisters a batch and registers another. Reconnecting on each would open and
 * discard a connection per component; waiting for the set to settle opens one.
 */
const RECONCILE_DELAY_MS = 150;

/**
 * Owns the single change-notification connection for everything below it.
 *
 * One connection, not one per component. Browsers cap concurrent connections per
 * origin (six, on HTTP/1.1), and a screen showing a list, a builder and a run
 * would spend most of that budget on streams that could share one.
 *
 * Membership is reconciled from a registry rather than driven by props: watchers
 * come and go with navigation, and the connection should follow them without any
 * component having to know about the others.
 */
export function LiveEventsProvider({
  client,
  children,
}: {
  client: WorkflowClient;
  children: React.ReactNode;
}) {
  const registry = React.useRef(new Map<string, Set<LiveListener>>());
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Sorted, comma-joined: a stable string, so an unchanged set cannot
  // re-subscribe just because a new array was allocated.
  const [watchedSet, setWatchedSet] = React.useState('');
  const [connected, setConnected] = React.useState(false);

  const reconcile = React.useCallback(() => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const next = [...registry.current.keys()].sort().join(',');
      setWatchedSet((prev) => (prev === next ? prev : next));
    }, RECONCILE_DELAY_MS);
  }, []);

  const watch = React.useCallback(
    (topic: LiveTopic, listener: LiveListener) => {
      const key = topicKey(topic);
      let listeners = registry.current.get(key);
      if (!listeners) {
        listeners = new Set();
        registry.current.set(key, listeners);
      }
      const own = listeners;
      own.add(listener);
      reconcile();

      return () => {
        // Identity guard: this handle may outlive the entry it created, and must
        // not evict whatever replaced it.
        if (registry.current.get(key) !== own) return;
        own.delete(listener);
        if (own.size === 0) registry.current.delete(key);
        reconcile();
      };
    },
    [reconcile],
  );

  /**
   * Notify everyone watching a workflow, directly and via any folder topic.
   *
   * A frame names its workflow, never its folder, so folder watchers are
   * broadcast to — there are only ever the few on screen, and the alternative
   * is a workflow→folder map that goes stale the moment a workflow moves.
   */
  const emit = React.useCallback((workflowId: string, change: Parameters<LiveListener>[0]) => {
    const notify = (key: string): void => {
      const listeners = registry.current.get(key);
      if (!listeners) return;
      // Snapshot: a listener may unregister itself while being notified.
      for (const listener of [...listeners]) listener(change);
    };

    notify(topicKey({ kind: 'workflow', id: workflowId }));
    for (const key of registry.current.keys()) {
      // A folder frame names its workflow, not its folder; the root feed names
      // neither to a watcher. Both are broadcast to on every run change — there
      // are only ever the few on screen.
      if (key.startsWith('folder:') || key.startsWith('root:')) notify(key);
    }
  }, []);

  React.useEffect(() => {
    if (watchedSet === '') {
      setConnected(false);
      return;
    }
    // Registry keys are `<kind>:<id>`; split them back into families.
    const workflows: string[] = [];
    const folders: string[] = [];
    let root = false;
    for (const key of watchedSet.split(',')) {
      const [kind, ...rest] = key.split(':');
      const id = rest.join(':');
      if (kind === 'folder') folders.push(id);
      else if (kind === 'root') root = true;
      else workflows.push(id);
    }

    const stop = client.events.subscribe(
      { workflows, folders, root },
      {
        onEvent: (event) => {
          if (event.event === 'run_changed') {
            const { data } = event as RunChangeEvent;
            emit(data.workflowId, {
              workflowId: data.workflowId,
              reason: 'run',
              executionId: data.executionId,
              status: data.status,
              // Enrichment the workspace feed carries on a newly-created run, so the
              // unscoped list can render the row without a refetch. Absent elsewhere.
              ...(data.workflowName !== undefined ? { workflowName: data.workflowName } : {}),
              ...(data.createdAt !== undefined ? { createdAt: data.createdAt } : {}),
            });
            return;
          }

          if (event.event !== 'workflow_changed') return;
          const { data } = event as WorkflowChangeEvent;

          // Drop the echo of our own write. Suppressed here, once, rather than in
          // every consumer: an editor that cannot tell its own save from someone
          // else's reports the user's own work as a conflict.
          if (data.origin && data.origin === client.origin) return;

          emit(data.workflowId, {
            workflowId: data.workflowId,
            reason: 'changed',
            change: data.change,
          });
        },
        onOpen: ({ reconnected }) => {
          setConnected(true);
          if (!reconnected) return;
          // Nothing was buffered while we were away, so every watcher re-reads.
          for (const key of [...registry.current.keys()]) {
            const listeners = registry.current.get(key);
            if (!listeners) continue;
            const id = key.slice(key.indexOf(':') + 1);
            const change =
              key.startsWith('folder:') || key.startsWith('root:')
                ? ({ reason: 'resync' } as const)
                : ({ workflowId: id, reason: 'resync' } as const);
            for (const listener of [...listeners]) listener(change);
          }
        },
        onError: () => {
          setConnected(false);
        },
      },
    );

    return () => {
      stop();
      setConnected(false);
    };
  }, [client, watchedSet, emit]);

  React.useEffect(
    () => () => {
      if (timer.current !== undefined) clearTimeout(timer.current);
    },
    [],
  );

  const value = React.useMemo<LiveContextValue>(
    () => ({ watch, connected }),
    [watch, connected],
  );

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}
