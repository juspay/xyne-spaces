import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBottomSheet, type AppBottomSheetRef } from '@/src/components/ui/app-bottom-sheet';

export type TicketMetaPickerSheetApi = {
  dismiss: () => void;
};

type TicketMetaPickerSheetProps = {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  children: (api: TicketMetaPickerSheetApi) => ReactNode;
  /**
   * Optional header override (e.g. Cancel / Done action bar).
   * Receives the same dismiss API as children. Defaults to a title-only row.
   */
  renderHeader?: (api: TicketMetaPickerSheetApi) => ReactNode;
};

/**
 * Shared ticket-details meta picker shell: mount gate, fullscreen AppBottomSheet, header.
 */
export function TicketMetaPickerSheet({
  isOpen,
  title,
  onClose,
  children,
  renderHeader,
}: TicketMetaPickerSheetProps): ReactElement | null {
  const [shouldRender, setShouldRender] = useState(isOpen);

  useEffect(() => {
    if (isOpen) setShouldRender(true);
  }, [isOpen]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose],
  );

  const handleDismiss = useCallback(() => {
    setShouldRender(false);
  }, []);

  if (!shouldRender) return null;

  return (
    <TicketMetaPickerSheetContent
      isOpen={isOpen}
      title={title}
      onOpenChange={handleOpenChange}
      onDismiss={handleDismiss}
      {...(renderHeader ? { renderHeader } : {})}
    >
      {children}
    </TicketMetaPickerSheetContent>
  );
}

function TicketMetaPickerSheetContent({
  isOpen,
  title,
  onOpenChange,
  onDismiss,
  children,
  renderHeader,
}: {
  isOpen: boolean;
  title: string;
  onOpenChange: (open: boolean) => void;
  onDismiss: () => void;
  children: (api: TicketMetaPickerSheetApi) => ReactNode;
  renderHeader?: (api: TicketMetaPickerSheetApi) => ReactNode;
}): ReactElement {
  const sheetRef = useRef<AppBottomSheetRef>(null);
  const insets = useSafeAreaInsets();

  const dismiss = useCallback(() => {
    sheetRef.current?.dismiss();
  }, []);

  const api = useMemo<TicketMetaPickerSheetApi>(() => ({ dismiss }), [dismiss]);

  return (
    <AppBottomSheet
      ref={sheetRef}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      onDismiss={onDismiss}
      mode='fullscreen'
      keyboardBehavior='extend'
      backdropOpacity={0.4}
    >
      <View className='flex-1 bg-card' style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
        {renderHeader ? (
          renderHeader(api)
        ) : (
          <View className='h-12 flex-row items-center px-5'>
            <Text className='flex-1 text-[17px] font-semibold text-foreground'>{title}</Text>
          </View>
        )}
        {children(api)}
      </View>
    </AppBottomSheet>
  );
}
