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
import { usePinnedArtifactApps } from '../../../hooks/usePinnedArtifactApps';
import {
  getArtifactApp,
  restoreArtifactAppVersion,
  updateArtifactAppIcon,
  type ArtifactAppDetail,
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
  /** The saved row itself — owner, visibility, timestamps. Carried whole rather
   *  than unpacked field by field: Settings reads most of it, and every added
   *  column would otherwise mean another member here. Null until the app loads. */
  app: ArtifactAppDetail | null;
  title: string | null;
  /** The app's icon id, or null for the fallback mark. */
  icon: string | null;
  /** Whether the viewer may change the icon (and restore). */
  isOwner: boolean;
  /** Owner-only. Durable: the session path never overwrites a set icon. */
  setIcon: (icon: string | null) => void;
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

  // Whether the mode SHOULD be on, independent of whether the URL says so yet.
  //
  // Entry used to be a single `setMode(true)`, and it was order-dependent. The
  // artifact lands at stream completion — the same instant the draft acquires
  // its server id — so two URL writers fired in one commit: this hook adding
  // `?mode=create-app`, and AIScreen navigating to `/chat/<id>` carrying the
  // *rendered* `location.search`, which did not have the param yet. Both built
  // on a stale location; whichever landed second could drop the other's write.
  // Entry worked or did not depending on effect order.
  //
  // So entry is now an intent that is re-asserted until the URL agrees. If a
  // racing navigate strips the param, the effect below sees `modeOn` false with
  // the intent still set and writes it again — onto the pathname that has now
  // settled. It converges in one extra render regardless of who wrote last.
  const wantMode = useRef(false);
  useEffect(() => {
    if (wantMode.current && !modeOn && conversationId) setMode(true);
  }, [modeOn, conversationId, setMode]);

  // Leaving a thread drops everything thread-specific. Without this the pane
  // keeps showing the previous chat's app and a pinned version leaks across.
  const lastConversation = useRef<string | null>(conversationId);
  useEffect(() => {
    if (lastConversation.current === conversationId) return;
    lastConversation.current = conversationId;
    wantMode.current = false;
    setPinnedVersionId(null);
  }, [conversationId]);

  // A new chat is a blank slate: no conversation, no app, nothing for the mode
  // to describe. Strip ?mode=create-app rather than letting it ride along — a
  // lingering param kept mode-derived layout (the collapsed sidebar) armed on
  // /ai/chat/new. The next thread that generates an app re-enters on its own.
  useEffect(() => {
    if (!conversationId && modeOn) {
      wantMode.current = false;
      setMode(false);
    }
  }, [conversationId, modeOn, setMode]);

  // Entry itself is driven by the artifact cards: each one, on mount, asks for
  // the mode via `enterForApp` (see appCreationModeContext). A card mounts
  // exactly when a build appears in the thread — on history load, and on every
  // new generation — which is precisely the set of moments the mode should
  // open. The card mounts once, so an explicit close sticks until the NEXT
  // build lands, at which point the new card asks again.

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

  const { updatePinnedApp } = usePinnedArtifactApps();
  const iconMutation = useMutation({
    mutationFn: (icon: string | null) => updateArtifactAppIcon(appId as string, icon),
    onSuccess: (_result, icon) => {
      void queryClient.invalidateQueries({ queryKey: ['artifact-app', appId] });
      // The library lists render from their own cache, and the sidebar from a
      // localStorage snapshot — both must learn the new mark or the pane shows
      // one icon while the rail shows another.
      void queryClient.invalidateQueries({ queryKey: ['artifact-apps'] });
      if (appId) updatePinnedApp(appId, { icon });
    },
  });
  const setIcon = useCallback(
    (icon: string | null) => {
      if (!appId) return;
      iconMutation.mutate(icon);
    },
    [appId, iconMutation],
  );

  const open = useCallback(() => {
    wantMode.current = true;
    setMode(true);
  }, [setMode]);
  const exit = useCallback(() => {
    // Dropping the intent is what makes a close stick: nothing re-asserts the
    // param until a new build's card asks for the mode again.
    wantMode.current = false;
    setMode(false);
  }, [setMode]);
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
  const app = data?.app ?? null;
  const title = data?.app.title ?? null;
  const icon = data?.app.icon ?? null;
  const isOwner = data?.app.isOwner ?? false;
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
      app,
      title,
      icon,
      isOwner,
      setIcon,
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
      app,
      title,
      icon,
      isOwner,
      setIcon,
      viewVersion,
      restoreVersion,
      restore.isPending,
      restore.error,
      open,
      exit,
    ],
  );
}
