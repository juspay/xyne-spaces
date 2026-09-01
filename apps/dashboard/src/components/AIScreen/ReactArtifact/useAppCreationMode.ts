/**
 * App Creation mode — which app a chat thread is building, whether the split
 * view is open, and which version the pane is showing.
 *
 * Step 1 made a conversation own exactly ONE app, which is what lets a single
 * persistent pane be unambiguous: there is never a question of *which* artifact
 * the right-hand side means.
 *
 * The open/closed state lives in the URL (`?mode=create-app`) rather than in
 * component state, so a reload — or a link pasted to a teammate — comes back to
 * the same layout instead of silently reverting to plain chat.
 *
 * Everything else here is keyed to the CONVERSATION. The pane must never carry
 * over to another thread: switching to a chat with no app has to close it, and
 * a version pinned in one thread is meaningless in another.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getArtifactApp,
  restoreArtifactAppVersion,
  type ArtifactAppRestoreEvent,
  type ArtifactAppVersionSummary,
} from '../../../services/claw/artifactAppsService';

export const APP_MODE_PARAM = 'mode';
export const APP_MODE_VALUE = 'create-app';

export interface AppCreationMode {
  /** True when the split view should render: the mode is on AND there is an app. */
  active: boolean;
  /** True when this thread has an app at all — drives the reopen affordance. */
  hasApp: boolean;
  appId: string | null;
  /** The version the pane is showing: an explicit pick, else head. */
  viewingVersionId: string | null;
  /** That version's row, so the pane has its manifest without refetching. */
  viewing: ArtifactAppVersionSummary | null;
  /** Every version, newest first. Empty until the app loads. */
  versions: ArtifactAppVersionSummary[];
  /** Recorded head-moved-backward events, oldest first. The transcript merges
   *  these in by time so a rollback stays readable long after it happened. */
  restores: ArtifactAppRestoreEvent[];
  headVersionId: string | null;
  title: string | null;
  /** View an older build. A VIEW, not a restore — head does not move. */
  viewVersion: (versionId: string | null) => void;
  /** Make a version current: moves HEAD on the server. Unlike `viewVersion`
   *  this is durable and is what the agent's next update builds on. */
  restoreVersion: (versionId: string) => void;
  /** True while a restore is in flight, so the menu can disable itself. */
  restoring: boolean;
  restoreError: string | null;
  /** Open the pane (also used by the reopen affordance). */
  open: () => void;
  /** Close the pane; inline cards go live again. */
  exit: () => void;
}

export function useAppCreationMode(
  appId: string | null,
  conversationId: string | null,
  /** The build the thread's newest artifact carries — the freshness signal. */
  latestVersionId: string | null,
): AppCreationMode {
  const [searchParams, setSearchParams] = useSearchParams();
  const modeOn = searchParams.get(APP_MODE_PARAM) === APP_MODE_VALUE;

  // An explicit pick pins the pane to one build. Null means "follow head", so a
  // new generation moves the pane forward on its own — which is what you want
  // while iterating, and the reason this is not seeded to head.
  const [pinnedVersionId, setPinnedVersionId] = useState<string | null>(null);

  const setMode = useCallback(
    (on: boolean) => {
      setSearchParams(
        prev => {
          const next = new URLSearchParams(prev);
          if (on) next.set(APP_MODE_PARAM, APP_MODE_VALUE);
          else next.delete(APP_MODE_PARAM);
          return next;
        },
        // Toggling a panel is not a navigation: it must not stack history
        // entries that Back then has to walk back through.
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Leaving a thread drops everything thread-specific. Without this the pane
  // keeps showing the previous chat's app and a pinned version leaks across.
  const lastConversation = useRef<string | null>(conversationId);
  const autoEnteredFor = useRef<string | null>(null);
  useEffect(() => {
    if (lastConversation.current === conversationId) return;
    lastConversation.current = conversationId;
    autoEnteredFor.current = null;
    setPinnedVersionId(null);
  }, [conversationId]);

  // A new chat is a blank slate: no conversation, no app, nothing for the mode
  // to describe. Strip ?mode=create-app rather than letting it ride along — a
  // lingering param kept mode-derived layout (the collapsed sidebar) armed on
  // /ai/chat/new. The next thread that generates an app re-enters on its own.
  useEffect(() => {
    if (!conversationId && modeOn) setMode(false);
  }, [conversationId, modeOn, setMode]);

  // Auto-enter ONCE per conversation. Tracking it per conversation is what lets
  // an explicit close stick: closing marks this thread handled, so a later
  // generation reopens nothing, while switching threads starts fresh.
  useEffect(() => {
    if (!appId) return;
    // Wait for the conversation to be named. `autoEnteredFor` starts as null and
    // a fresh chat's conversationId is also null, so acting here would compare
    // null === null and mark the thread handled before it even has an identity.
    if (!conversationId) return;
    if (autoEnteredFor.current === conversationId) return;
    autoEnteredFor.current = conversationId;
    if (!modeOn) setMode(true);
  }, [appId, conversationId, modeOn, setMode]);

  const { data } = useQuery({
    queryKey: ['artifact-app', appId],
    queryFn: () => getArtifactApp(appId as string),
    enabled: Boolean(appId),
    staleTime: 30_000,
  });

  // A generation just landed: the thread shows a versionId the cached app does
  // not contain, so the pane would keep rendering the old head until a refocus
  // refetched it. Invalidate once per new version — guarded by a ref, not by
  // the versions array alone, so a version the server has not surfaced yet
  // cannot put refetching in a loop.
  const queryClient = useQueryClient();
  const invalidatedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!appId || !latestVersionId) return;
    if (invalidatedFor.current === latestVersionId) return;
    invalidatedFor.current = latestVersionId;
    const known = queryClient
      .getQueryData<{ versions: ArtifactAppVersionSummary[] }>(['artifact-app', appId])
      ?.versions.some(v => v.id === latestVersionId);
    if (!known) void queryClient.invalidateQueries({ queryKey: ['artifact-app', appId] });
  }, [appId, latestVersionId, queryClient]);

  const restore = useMutation({
    mutationFn: (versionId: string) => restoreArtifactAppVersion(appId as string, versionId),
    onSuccess: () => {
      // Head moved on the server. Drop the local pin so the pane follows the new
      // head rather than staying stuck on whatever was being previewed, and
      // refetch so every consumer of this key — the pane, the Saved chip, the
      // "Newer version" chips — re-evaluates against the new head at once.
      setPinnedVersionId(null);
      void queryClient.invalidateQueries({ queryKey: ['artifact-app', appId] });
    },
  });
  const restoreVersion = useCallback(
    (versionId: string) => {
      if (!appId) return;
      restore.mutate(versionId);
    },
    [appId, restore],
  );

  const open = useCallback(() => setMode(true), [setMode]);
  const exit = useCallback(() => {
    // Mark handled so the next generation does not reopen what was just closed.
    autoEnteredFor.current = conversationId;
    setMode(false);
  }, [setMode, conversationId]);
  const headVersionId = data?.app.headVersionId ?? null;

  const viewVersion = useCallback(
    (versionId: string | null) => {
      // Selecting the CURRENT version clears the pin rather than pinning to it,
      // so the pane resumes following head and the next generation moves it
      // forward on its own. Pinning here would silently freeze the pane on the
      // build that happened to be current when you clicked.
      setPinnedVersionId(versionId === headVersionId ? null : versionId);
    },
    [headVersionId],
  );
  const versions = useMemo(() => data?.versions ?? [], [data]);
  const restores = useMemo(() => data?.restores ?? [], [data]);

  /** The build the pane should render — the manifest comes from here, so the
   *  pane never needs a second fetch to know what it is showing. */
  const viewing = useMemo(() => {
    const id = pinnedVersionId ?? headVersionId;
    return versions.find(v => v.id === id) ?? versions[0] ?? null;
  }, [versions, pinnedVersionId, headVersionId]);

  // Memoized: this object is a prop to the pane and is read by the context
  // provider, so a fresh identity every render re-renders the pane (and through
  // it the Sandpack) for no reason.
  const title = data?.app.title ?? null;
  const hasApp = Boolean(appId);
  const active = hasApp && modeOn;

  return useMemo(
    () => ({
      active,
      hasApp,
      appId,
      viewingVersionId: viewing?.id ?? null,
      viewing,
      versions,
      restores,
      headVersionId,
      title,
      viewVersion,
      restoreVersion,
      restoring: restore.isPending,
      restoreError: restore.error ? String(restore.error) : null,
      open,
      exit,
    }),
    [
      active,
      hasApp,
      appId,
      viewing,
      versions,
      restores,
      headVersionId,
      title,
      viewVersion,
      restoreVersion,
      restore.isPending,
      restore.error,
      open,
      exit,
    ],
  );
}
