import { useEffect, useState, type ReactElement } from 'react';
import { useNavigate } from '../../hooks/useWorkspaceNavigate';
import { useShortcutById } from '../../shortcuts';
import { usePlatform } from '../../hooks/usePlatform';
import { usePrefersPlainOverlays } from './environment';
import { FloatingWidget } from './FloatingWidget';
import { OverlayConfirm, OverlayControl } from './OverlayControls';
import { OverlayLayer } from './OverlayLayer';
import { setSurfaceNavigator } from './surfaceRegistry';
import { libraryAppPath } from '../ArtifactApp/appSurfaces';
import {
  shownOverlayAppId,
  toggleOverlaySuppressed,
  useSurfaces,
  widgetLayoutFor,
} from './surfacesStore';

/** Fallback when the browser has no idle callback (Safari). */
const IDLE_FALLBACK_MS = 1500;

/** True once the browser is idle after first paint, so apps never slow start-up. */
const useAfterIdle = (): boolean => {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(() => setReady(true), { timeout: 4000 });
      return (): void => window.cancelIdleCallback(id);
    }
    const timer = window.setTimeout(() => setReady(true), IDLE_FALLBACK_MS);
    return (): void => window.clearTimeout(timer);
  }, []);
  return ready;
};

/**
 * The viewer's overlay and widgets, mounted once beside the routes so they keep
 * running — and keep their state — as the viewer moves between pages.
 *
 * Also where the shell's side of the surface bridge lives: the router an app's
 * `navigateTo` uses, and the shortcut that hides the overlay.
 */
export const ArtifactSurfacesHost = (): ReactElement | null => {
  const navigate = useNavigate();
  const surfaces = useSurfaces();
  const plain = usePrefersPlainOverlays();
  const idle = useAfterIdle();
  // Desktop only, like the setting: a phone has no room beside the page.
  const { isMobile } = usePlatform();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setSurfaceNavigator(target => {
      if (target.kind === 'channel') void navigate(`/chat/dir/${target.channelId}`);
      // Bar apps open on the toolbar route, which itself points any app that
      // doesn't open there to its Agent Hub page.
      else if (target.kind === 'app') void navigate(`/app/${target.appId}`);
      else if (target.kind === 'libraryApp') void navigate(libraryAppPath(target.appId));
      else void navigate(`/ai/chat/${target.sessionId}`);
    });
    return (): void => setSurfaceNavigator(null);
  }, [navigate]);

  useShortcutById('global.toggleOverlays', () => toggleOverlaySuppressed());

  // Bring a paused overlay back when its pause ends.
  const { pausedUntil } = surfaces.overlay;
  useEffect(() => {
    setNow(Date.now());
    if (pausedUntil === null) return;
    const wait = pausedUntil - Date.now();
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setNow(Date.now()), wait + 50);
    return (): void => window.clearTimeout(timer);
  }, [pausedUntil]);

  if (!idle || isMobile) return null;

  const overlayAppId = plain ? null : shownOverlayAppId(surfaces, now);
  const keptOverlay = surfaces.overlay.appId;

  return (
    <>
      {overlayAppId && <OverlayLayer key={overlayAppId} appId={overlayAppId} />}
      {/* Shown even when overlays are not drawn (reduced motion), so a preview
          always resolves and an overlay can always be switched off. */}
      {surfaces.pending && <OverlayConfirm appId={surfaces.pending.appId} />}
      {keptOverlay && !surfaces.pending && (
        <OverlayControl appId={keptOverlay} running={overlayAppId === keptOverlay} />
      )}
      {surfaces.widgets.map(appId => (
        <FloatingWidget key={appId} appId={appId} layout={widgetLayoutFor(surfaces, appId)} />
      ))}
    </>
  );
};
