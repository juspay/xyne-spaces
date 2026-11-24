import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { KeyboardController } from 'react-native-keyboard-controller';

import {
  ScheduleMessageSheet,
  type ScheduleMessageSheetProps,
} from '@/src/features/drafts-sent/schedule-message-sheet';
import { formatScheduledToast } from '@/src/features/drafts-sent/schedule-message-utils';
import { showMessageToast } from '@/src/utils/toast';
import { cn } from '@/src/utils/cn';

import { useChatInputConversation, useChatInputHandlers } from './input-composer-context';
import {
  UpcomingScheduledBanner,
  useUpcomingScheduledBannerVisible,
  type ScheduledBannerViewProps,
} from './upcoming-scheduled-banner';

const ComposerScheduleStripContext = createContext(false);

/** True when the schedule info strip is painted above Twin / the composer field. */
export const useComposerScheduleStripVisible = (): boolean =>
  useContext(ComposerScheduleStripContext);

type ComposerScheduleHostProps = {
  /** Composer field(s) that share the same rounded chrome as the schedule strip. */
  children: ReactNode;
  /** Merged after the default chrome, for composers that restyle the field. */
  className?: string;
  /** Applied over the chrome's classes, for metrics a composer keeps as numbers (its radius). */
  style?: StyleProp<ViewStyle>;
  /** Draws the schedule picker instead of the classic bottom sheet, with the sheet's own props. */
  SchedulePicker?: ComponentType<ScheduleMessageSheetProps> | undefined;
  /**
   * Draws the upcoming banner above the field's chrome instead of the strip
   * glued inside it; the field then keeps its rounded top.
   */
  ScheduledBannerView?: ComponentType<ScheduledBannerViewProps> | undefined;
};

/**
 * Owns the schedule sheet + upcoming banner for a mounted composer.
 * Send long-press calls `openSchedule` from handlers, which opens this sheet.
 * Wraps children so the schedule strip sits inside the same input bubble.
 */
export function ComposerScheduleHost({
  children,
  className,
  style,
  ...seams
}: ComposerScheduleHostProps): ReactElement {
  const SchedulePicker = seams.SchedulePicker ?? ScheduleMessageSheet;
  const ScheduledBannerView = seams.ScheduledBannerView;
  const { conversationId, threadId, isEditing, isTwinEditing } = useChatInputConversation();
  const { registerOpenSchedule, confirmSchedule, inputRef } = useChatInputHandlers();
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [recentScheduledFor, setRecentScheduledFor] = useState<number | null>(null);

  useEffect(() => {
    setRecentScheduledFor(null);
  }, [conversationId, threadId]);

  const openScheduleSheet = useCallback((): void => {
    // Fire IME dismiss in parallel — awaiting hide delayed the sheet ~250–400ms.
    // The sheet portals above the sticky composer, so both can animate together.
    inputRef.current?.blur();
    if (KeyboardController.isVisible()) {
      void KeyboardController.dismiss();
    }
    setIsSheetOpen(true);
  }, [inputRef]);

  useEffect(() => {
    if (isEditing || isTwinEditing) {
      registerOpenSchedule(null);
      return (): void => registerOpenSchedule(null);
    }
    registerOpenSchedule(openScheduleSheet);
    return (): void => registerOpenSchedule(null);
  }, [isEditing, isTwinEditing, openScheduleSheet, registerOpenSchedule]);

  const clearRecentScheduledFor = useCallback((): void => {
    setRecentScheduledFor(null);
  }, []);

  const handleConfirm = useCallback(
    async (scheduledFor: number): Promise<void> => {
      await confirmSchedule(scheduledFor);
      setRecentScheduledFor(scheduledFor);
      showMessageToast(formatScheduledToast(scheduledFor), 'success');
    },
    [confirmSchedule],
  );

  const hasUpcomingBanner = useUpcomingScheduledBannerVisible(
    conversationId,
    threadId || null,
    recentScheduledFor,
  );
  const showScheduleStrip =
    hasUpcomingBanner && !isEditing && !isTwinEditing && ScheduledBannerView === undefined;
  const banner =
    !isEditing && !isTwinEditing ? (
      <UpcomingScheduledBanner
        channelId={conversationId}
        conversationId={threadId || null}
        recentScheduledFor={recentScheduledFor}
        onRecentScheduledForExpire={clearRecentScheduledFor}
        View={ScheduledBannerView}
      />
    ) : null;

  return (
    <ComposerScheduleStripContext.Provider value={showScheduleStrip}>
      {ScheduledBannerView === undefined ? null : banner}
      <View
        className={cn(
          'w-full self-stretch rounded-[20px] bg-conversation-input-bg',
          isTwinEditing ? '' : 'shadow-xs',
          className,
        )}
        style={style}
      >
        {ScheduledBannerView === undefined ? banner : null}
        {children}
      </View>
      <SchedulePicker
        isOpen={isSheetOpen}
        mode='create'
        onOpenChange={setIsSheetOpen}
        onConfirm={handleConfirm}
      />
    </ComposerScheduleStripContext.Provider>
  );
}
