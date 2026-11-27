import { useEffect, type MutableRefObject } from 'react';
import {
  ARTIFACT_DATA_PROTOCOL_VERSION,
  isAppArtifactMessage,
  type HostPointerMessage,
  type XyneAppContext,
} from './artifactData.constants';
import type { PreviewClientRef } from './useArtifactDataBridge';
import {
  navigateFromApp,
  registerRunningApp,
  relayBroadcast,
} from '../../ArtifactSurfaces/surfaceRegistry';
import {
  previewOverlay,
  resizeWidget,
  turnOffOverlayFor,
} from '../../ArtifactSurfaces/surfacesStore';

interface BridgeArgs {
  previewRef: MutableRefObject<PreviewClientRef | null>;
  /** Read at the moment a message arrives: the surface decides what is allowed. */
  contextRef: MutableRefObject<XyneAppContext | null>;
  appId?: string;
}

/**
 * What an app may ask of the shell beyond data: a widget's size, opening a
 * channel / app / AI chat, its own overlay on or off, the pointer for an
 * overlay, and messages to its other running copies.
 *
 * Each request is checked against where the app is running and which app it
 * is. A widget can only resize itself; an app can only switch its own overlay;
 * navigation takes ids, never URLs. None of it grants data access — every call
 * the app makes is still authorized as the viewer.
 */
export function useArtifactSurfaceBridge({ previewRef, contextRef, appId }: BridgeArgs): void {
  useEffect(() => {
    const appWindow = (): Window | null =>
      previewRef.current?.getClient()?.iframe?.contentWindow ?? null;

    const unregister = appId ? registerRunningApp(appId, appWindow) : null;

    let pointerFrame = 0;
    let pointer: { x: number; y: number } | null = null;
    const sendPointer = (): void => {
      pointerFrame = 0;
      const target = appWindow();
      if (!target || !pointer) return;
      const message: HostPointerMessage = {
        source: 'xyne-artifact-host',
        v: ARTIFACT_DATA_PROTOCOL_VERSION,
        type: 'pointer',
        x: pointer.x,
        y: pointer.y,
      };
      try {
        target.postMessage(message, '*');
      } catch {
        // Reloading; the next move gets through.
      }
    };
    const onPointerMove = (event: PointerEvent): void => {
      pointer = { x: event.clientX, y: event.clientY };
      if (!pointerFrame) pointerFrame = requestAnimationFrame(sendPointer);
    };
    let following = false;
    const followPointer = (enabled: boolean): void => {
      if (enabled === following) return;
      following = enabled;
      if (enabled) window.addEventListener('pointermove', onPointerMove, { passive: true });
      else window.removeEventListener('pointermove', onPointerMove);
    };

    const onMessage = (event: MessageEvent): void => {
      const source = appWindow();
      if (!source || event.source !== source) return;
      if (!isAppArtifactMessage(event.data)) return;
      const message = event.data;
      const surface = contextRef.current?.surface;

      switch (message.type) {
        case 'surface-resize':
          if (surface === 'widget' && appId) {
            resizeWidget(appId, message.width ?? 0, message.height ?? 0);
          }
          return;
        case 'navigate':
          // Nobody can click an overlay, so a navigation from one is never the
          // viewer's; it would only move the page out from under them.
          if (surface !== 'overlay' && message.target) navigateFromApp(message.target);
          return;
        case 'overlay-set':
          // An unsaved artifact has no id to run as an overlay.
          if (!appId) return;
          if (message.enabled) previewOverlay(appId);
          else turnOffOverlayFor(appId);
          return;
        case 'pointer-subscribe':
          followPointer(surface === 'overlay' && message.enabled === true);
          return;
        case 'broadcast':
          if (appId) relayBroadcast(appId, source, message.payload);
          return;
        default:
          return;
      }
    };

    window.addEventListener('message', onMessage);
    return (): void => {
      window.removeEventListener('message', onMessage);
      followPointer(false);
      if (pointerFrame) cancelAnimationFrame(pointerFrame);
      unregister?.();
    };
  }, [previewRef, contextRef, appId]);
}
