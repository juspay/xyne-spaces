import { useEffect, useId, type ReactElement } from 'react';
import { BackHandler, Modal, Platform } from 'react-native';

import { FullWindowOverlay } from '@/src/components/full-window-overlay';
import { Portal } from '@/src/components/primitives/portal';

/**
 * How an overlay draws on Android, which has no separate overlay window:
 * - `inline`: in place, for one already drawn above what it covers;
 * - `portal`: in the app's root portal host, above every screen and the thread
 *   card. It never takes window focus, so the keyboard and the chat list that
 *   follows it are left alone;
 * - `modal`: in a transparent modal, which takes window focus while it shows.
 */
export type AndroidOverlayLayer = 'inline' | 'portal' | 'modal';

type ConversationOverlayLayerProps = {
  android: AndroidOverlayLayer;
  /**
   * Android's back button (and a modal's hardware Escape). Omitted, back is
   * left to the screen: for a layer that stays up while the screen is used
   * (the parked-thread bubbles).
   */
  onRequestClose?: () => void;
  children: ReactElement;
};

/**
 * Where the conversation's overlays (the hold menu, the "+" tray) draw: a
 * separate window on iOS, so they sit above the composer dock, the headers
 * that carry their own z-index and the thread card's modal; its origin is the
 * window's. On Android, see `AndroidOverlayLayer`.
 */
export function ConversationOverlayLayer({
  android,
  onRequestClose,
  children,
}: ConversationOverlayLayerProps): ReactElement {
  const portalName = `conversation-overlay-${useId()}`;
  const handlesBack = Platform.OS === 'android' && android === 'portal';

  useEffect(() => {
    if (!handlesBack || onRequestClose === undefined) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onRequestClose();
      return true;
    });
    return (): void => subscription.remove();
  }, [handlesBack, onRequestClose]);

  if (Platform.OS === 'android') {
    if (android === 'portal') return <Portal name={portalName}>{children}</Portal>;
    if (android === 'modal') {
      return (
        <Modal
          transparent
          visible
          animationType='none'
          statusBarTranslucent
          navigationBarTranslucent
          onRequestClose={onRequestClose}
        >
          {children}
        </Modal>
      );
    }
  }
  return <FullWindowOverlay disableFullWindowOverlay={false}>{children}</FullWindowOverlay>;
}
