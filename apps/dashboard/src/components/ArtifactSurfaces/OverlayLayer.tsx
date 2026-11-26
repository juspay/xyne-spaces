import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ReactArtifactView } from '../AIScreen/ReactArtifact';
import type { XyneAppContext } from '../AIScreen/ReactArtifact';
import { reportSurfaceFailure, reportSurfaceReady } from './surfacesStore';
import { useSurfaceApp } from './useSurfaceApp';
import { useDeclaredSurface } from './useDeclaredSurface';

/**
 * Most a viewer sees of an overlay, whatever it paints. A fully opaque overlay
 * still lets Spaces show through, so the real interface is never hidden.
 */
export const OVERLAY_MAX_OPACITY = 0.85;

/** Wait before mounting an overlay again after it failed. */
const RETRY_DELAY_MS = 3000;

/**
 * The overlay: one app, drawn over the whole window and under dialogs, menus
 * and the shell's own controls.
 *
 * It can never take input. `pointer-events: none` sends every click to Spaces
 * underneath, `inert` keeps it out of the tab order, and `aria-hidden` keeps it
 * from screen readers — it is decoration. An app that wants the pointer asks
 * for it (`onPointerMove`) and the host forwards positions.
 *
 * A failure is retried a few times; then the store switches the overlay off
 * and the viewer is told why.
 */
export const OverlayLayer = ({ appId }: { appId: string }): ReactElement | null => {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const { app, artifact, isError } = useSurfaceApp(appId);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const retryTimer = useRef<number | null>(null);
  const title = app?.title ?? 'This overlay';
  const allowed = useDeclaredSurface(appId, 'overlay', artifact, title);

  const fail = useCallback((): void => {
    setFailed(true);
    const disabled = reportSurfaceFailure('overlay', appId);
    if (disabled) {
      toast.error(`${title} was turned off`, {
        description: 'The overlay kept failing to load. You can turn it on again in Preferences.',
      });
      return;
    }
    if (retryTimer.current) window.clearTimeout(retryTimer.current);
    retryTimer.current = window.setTimeout(() => {
      setFailed(false);
      setAttempt(n => n + 1);
    }, RETRY_DELAY_MS);
  }, [appId, title]);

  // No access, archived or deleted: a failure like any other, so it is retried
  // and then switched off rather than left silently doing nothing.
  useEffect(() => {
    if (isError) fail();
    // Only on the transition into an error; `fail` changes with the title.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isError]);

  useEffect(
    () => (): void => {
      if (retryTimer.current) window.clearTimeout(retryTimer.current);
    },
    [],
  );

  const onHealth = useCallback(
    (state: 'ready' | 'failed'): void => {
      if (state === 'ready') reportSurfaceReady('overlay', appId);
      else fail();
    },
    [appId, fail],
  );

  const hostContext = useMemo(
    (): XyneAppContext => ({
      v: 1,
      appId,
      surface: 'overlay',
      layout: 'overlay',
      ...(workspaceId ? { workspaceId } : {}),
    }),
    [appId, workspaceId],
  );

  if (!artifact || failed || !allowed) return null;

  return (
    <div
      className='pointer-events-none fixed inset-0 z-[45] overflow-hidden'
      style={{ opacity: OVERLAY_MAX_OPACITY }}
      aria-hidden='true'
      inert
      data-testid='artifact-overlay'
    >
      <ReactArtifactView
        key={attempt}
        artifact={artifact}
        hostContext={hostContext}
        surfaceMode='overlay'
        onSurfaceHealth={onHealth}
      />
    </div>
  );
};
