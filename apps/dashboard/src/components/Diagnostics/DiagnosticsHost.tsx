import { useCallback, useEffect, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { useShortcutById } from '../../shortcuts/hooks';
import { usePlatform } from '../../hooks/usePlatform';
import { useIsInPanelWebview } from '../../hooks/useIsInPanelWebview';
import { useDiagnosticsPanelStore } from '../../store/useDiagnosticsPanelStore';

/**
 * Owns the diagnostics shortcut, and renders the panel only on mobile.
 *
 * On desktop the panel is a real member of AppRoot's resizable group (see
 * `app-root-diagnostics`) so it can be resized and sits beside the app rather
 * than on top of it. This component lives above the router, which is why the
 * shortcut is registered here while the desktop panel renders there — the two
 * are joined by `useDiagnosticsPanelStore`.
 *
 * Mobile has no right-panel tier at all (every one of them is gated `!isMobile`),
 * and the embedded webview lane renders no right panels either, so both fall
 * back to a full-screen overlay.
 */
export function DiagnosticsHost(): ReactElement | null {
  const { isMobile } = usePlatform();
  const isInPanelWebview = useIsInPanelWebview();
  // Mirrors AppRoot's `showDiagnosticsPanel`: wherever the docked panel cannot
  // render, this overlay takes over so the shortcut always shows something.
  const useOverlay = isMobile || isInPanelWebview;
  const open = useDiagnosticsPanelStore(state => state.open);
  const toggle = useDiagnosticsPanelStore(state => state.toggle);
  const hide = useDiagnosticsPanelStore(state => state.hide);

  const close = useCallback(() => hide(), [hide]);

  useShortcutById('global.openDiagnostics', () => toggle());

  useEffect(() => {
    if (!open || !useOverlay) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, useOverlay, close]);

  if (!open || !useOverlay) return null;

  return createPortal(
    <div
      className='fixed inset-0 z-[9999] bg-background'
      role='dialog'
      aria-modal='true'
      aria-label='Performance diagnostics'
    >
      <DiagnosticsPanel onClose={close} />
    </div>,
    document.body,
  );
}
