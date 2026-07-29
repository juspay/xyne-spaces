import { useEffect, useRef } from 'react';
import {
  NativeInboundMessageType,
  NativeOutboundMessageType,
  reactNativeBridge,
} from '../utils/reactNativeBridge';

export interface UseNativeDrawerBridgeOptions {
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
}

/**
 * Bridges a controlled drawer's open state with the React Native shell so the
 * device hard back button closes the drawer on its first press (instead of
 * navigating away from the screen).
 *
 * The shell tracks drawer state via DRAWER_OPENED / DRAWER_CLOSED and sends
 * CLOSE_DRAWER when the user presses back.
 *
 * No-op for uncontrolled drawers or when not hosted inside the RN shell.
 */
export const useNativeDrawerBridge = ({
  open,
  onOpenChange,
}: UseNativeDrawerBridgeOptions): void => {
  const announcedOpenRef = useRef(false);

  useEffect(() => {
    if (open === undefined) return;
    if (!reactNativeBridge.isAvailable()) return;

    if (!open) {
      if (announcedOpenRef.current) {
        announcedOpenRef.current = false;
        reactNativeBridge.send(NativeOutboundMessageType.DRAWER_CLOSED);
      }
      return;
    }

    if (!announcedOpenRef.current) {
      announcedOpenRef.current = true;
      reactNativeBridge.send(NativeOutboundMessageType.DRAWER_OPENED);
    }

    const unsubscribe = reactNativeBridge.on(NativeInboundMessageType.CLOSE_DRAWER, () => {
      onOpenChange?.(false);
    });

    return unsubscribe;
  }, [open, onOpenChange]);
};
