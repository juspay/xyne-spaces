import type { ReactElement } from 'react';

import { ForwardMessageSheetView } from '@/src/components/chat/message-sheet/views/forward-message-sheet-view';
import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import { useZero } from '@/src/hooks/useZero';
import type { MessageActionsTarget } from './MessageActionsHost';
import { forwardSheetTargetFor } from './forwardTarget';

export type ForwardHostProps = {
  target: MessageActionsTarget | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onBack: () => void;
  currentUserId: string | undefined;
};

export function ForwardHost({
  target,
  isOpen,
  onOpenChange,
  onBack,
  currentUserId,
}: ForwardHostProps): ReactElement | null {
  const zero = useZero();
  const sheetTarget = target ? forwardSheetTargetFor(target, currentUserId) : null;
  if (!sheetTarget) {
    return null;
  }
  return (
    <AppBottomSheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      mode='fullscreen'
      enableBlurKeyboardOnGesture={false}
      backdropOpacity={0.4}
    >
      <ForwardMessageSheetView
        target={sheetTarget}
        onClose={(afterDismiss?: () => void): void => {
          onOpenChange(false);
          afterDismiss?.();
        }}
        onBack={onBack}
        zero={zero}
      />
    </AppBottomSheet>
  );
}
