import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { SmilePlus } from 'lucide-react-native';
import {
  forwardRef,
  Fragment,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  BackHandler,
  Pressable,
  Text,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import { v4 as uuidv4 } from 'uuid';

import { useZero } from '@/src/hooks/useZero';
import { mutators } from '@/src/zero/mutators';
import { reactionsMdToRawReactions } from '@/src/utils/conversationMessageHelpers';
import { EmojiPickerPanel } from '@/src/components/emoji-picker';
import {
  getEmojiPickerPanelHeight,
  getEmojiPickerSheetHeight,
} from '@/src/components/emoji-picker/emoji-picker.constants';
import {
  createEmojiPickerTraceId,
  logEmojiPickerDiagnostic,
} from '@/src/components/emoji-picker/emoji-picker-diagnostics';
import type { EmojiPickerSelection } from '@/src/components/emoji-picker/emoji-picker.types';
import { ForwardMessageSheetView } from '@/src/components/chat/message-sheet/views/forward-message-sheet-view';
import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import { dismissKeyboardForSheet } from '@/src/utils/dismiss-keyboard-for-sheet';
import { cn } from '@/src/utils/cn';
import { usePendingByMessageId } from '@xyne/shared/messages';

import { QUICK_REACTIONS } from './message-actions.constants';
import {
  toForwardSheetTarget,
  type MessageAction,
  type MessageActionsTarget,
} from './message-actions-target';
import { messageActionsStyles as styles } from './message-actions.styles';

export type MessageActionsSheetHandle = {
  closeActionSheet: (afterDismiss?: () => void) => void;
  openForward: () => void;
};

export type MessageActionsSheetProps = {
  target: MessageActionsTarget | null;
  actions: MessageAction[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onDismiss?: (() => void) | undefined;
  currentUserId?: string | undefined;
  /** Observes emoji-driven reactions (the reaction mutation itself is handled internally). */
  onEmojiSelect?: ((selection: EmojiPickerSelection) => void) | undefined;
};

type ViewType = 'actions' | 'forward' | 'emoji';

type ReactionTarget = {
  messageId: string;
  reactionsMd: string | null | undefined;
};

type ActionButtonProps = {
  icon: ReactNode;
  label: string;
  variant?: 'default' | 'destructive' | undefined;
  onPress: () => void;
};

const ActionButton = ({
  icon,
  label,
  variant = 'default',
  onPress,
}: ActionButtonProps): ReactElement => (
  <Pressable
    accessibilityRole='button'
    accessibilityLabel={label}
    onPress={onPress}
    className={cn(
      'w-full flex-row items-center gap-4 px-5 py-4',
      variant === 'destructive' ? 'active:bg-red-50 dark:active:bg-red-900/10' : 'active:bg-accent',
    )}
  >
    <View className='h-6 w-6 shrink-0 items-center justify-center'>{icon}</View>
    <Text
      className={cn(
        'text-base font-normal',
        variant === 'destructive' ? 'text-red-600 dark:text-red-400' : 'text-foreground',
      )}
    >
      {label}
    </Text>
  </Pressable>
);

export const MessageActionsSheet = forwardRef<MessageActionsSheetHandle, MessageActionsSheetProps>(
  (
    { target, actions, isOpen, onOpenChange, onDismiss, currentUserId, onEmojiSelect },
    ref,
  ): ReactElement => {
    const emojiPickerTraceIdRef = useRef<string | null>(null);
    const reactionTargetRef = useRef<ReactionTarget | null>(null);
    const afterActionSheetDismissRef = useRef<(() => void) | null>(null);

    const foreground = useCSSVariable('--color-foreground') as string;
    const accent = useCSSVariable('--color-accent') as string;
    const border = useCSSVariable('--color-border') as string;
    const bottomSheetBg = useCSSVariable('--color-bottomsheet-bg') as string;
    const insets = useSafeAreaInsets();
    const { height: windowHeight } = useWindowDimensions();

    const zero = useZero();
    const [view, setView] = useState<ViewType>('actions');
    const [forwardTarget, setForwardTarget] = useState<ReturnType<
      typeof toForwardSheetTarget
    > | null>(null);
    const [sheetMounted, setSheetMounted] = useState(false);
    const [closingTarget, setClosingTarget] = useState<MessageActionsTarget | null>(null);
    const [closingActions, setClosingActions] = useState<MessageAction[] | null>(null);
    const sheetMountedRef = useRef(false);

    const renderTarget = isOpen ? target : (closingTarget ?? target);
    const renderActions = isOpen ? actions : (closingActions ?? actions);
    const message = renderTarget?.message ?? null;
    const reactionsMd = renderTarget?.reactionsMd ?? null;
    const latestTargetRef = useRef(target);
    latestTargetRef.current = target;

    const runAfterActionSheetDismiss = useCallback((): void => {
      const afterDismiss = afterActionSheetDismissRef.current;
      afterActionSheetDismissRef.current = null;
      afterDismiss?.();
    }, []);

    useLayoutEffect(() => {
      if (isOpen) {
        const nextTarget = latestTargetRef.current;
        if (!nextTarget) {
          onOpenChange(false);
          // No native sheet was mounted, so there will be no native dismiss
          // callback to release a parent list freeze.
          onDismiss?.();
          return undefined;
        }

        sheetMountedRef.current = true;
        setSheetMounted(true);
        setClosingTarget(null);
        setClosingActions(null);
        setView('actions');
        setForwardTarget(null);
        reactionTargetRef.current = null;
        afterActionSheetDismissRef.current = null;

        // Keyboard dismissal is preparatory only. Never hold the sheet closed
        // behind a native promise that can reject or remain pending.
        // No open haptic here — AppBottomSheet fires one for every sheet.
        void dismissKeyboardForSheet().catch(() => undefined);
        return undefined;
      }

      if (!sheetMountedRef.current) {
        setSheetMounted(false);
        runAfterActionSheetDismiss();
      }
      reactionTargetRef.current = null;
      return undefined;
    }, [isOpen, onDismiss, onOpenChange, runAfterActionSheetDismiss]);

    useEffect(
      () => (): void => {
        afterActionSheetDismissRef.current = null;
      },
      [],
    );

    const resetSheetState = useCallback(() => {
      setView('actions');
      setForwardTarget(null);
      reactionTargetRef.current = null;
    }, []);

    const requestClose = useCallback(
      (afterDismiss?: () => void): void => {
        const pendingBeforeClose = afterActionSheetDismissRef.current;
        if (renderTarget) {
          setClosingTarget(renderTarget);
          setClosingActions(renderActions);
        }
        // AppBottomSheet reports native dismissal through onOpenChange(false)
        // before it invokes onDismiss. That acknowledgement has no callback of
        // its own and must not cancel an action already waiting for onDismiss.
        afterActionSheetDismissRef.current = afterDismiss ?? pendingBeforeClose;
        onOpenChange(false);
      },
      [onOpenChange, renderActions, renderTarget],
    );

    const close = useCallback(() => {
      resetSheetState();
      requestClose();
    }, [requestClose, resetSheetState]);

    const closeActionSheet = useCallback(
      (afterDismiss?: () => void) => {
        requestClose(afterDismiss);
      },
      [requestClose],
    );

    const openForward = useCallback(() => {
      if (!renderTarget) return;
      setForwardTarget(
        toForwardSheetTarget(renderTarget.message, renderTarget.channelId, currentUserId),
      );
      setView('forward');
    }, [currentUserId, renderTarget]);

    useImperativeHandle(ref, () => ({ closeActionSheet, openForward }), [
      closeActionSheet,
      openForward,
    ]);

    const handleActionsSheetOpenChange = useCallback(
      (open: boolean): void => {
        if (open) return;
        requestClose();
      },
      [requestClose],
    );

    const handleModalDismiss = useCallback(() => {
      sheetMountedRef.current = false;
      setSheetMounted(false);
      setClosingTarget(null);
      setClosingActions(null);
      resetSheetState();
      onOpenChange(false);
      runAfterActionSheetDismiss();
      onDismiss?.();
    }, [onDismiss, onOpenChange, resetSheetState, runAfterActionSheetDismiss]);

    const handleOpenEmojiPicker = useCallback(() => {
      emojiPickerTraceIdRef.current = createEmojiPickerTraceId();
      logEmojiPickerDiagnostic(emojiPickerTraceIdRef.current, 'more_reactions_pressed');
      setForwardTarget(null);
      setView('emoji');
      afterActionSheetDismissRef.current = null;
      const messageId = message?.messageId;
      if (messageId) {
        reactionTargetRef.current = { messageId, reactionsMd };
      }
    }, [message?.messageId, reactionsMd]);

    const stopQuickReactionPress = useCallback((event: GestureResponderEvent): void => {
      event.stopPropagation();
    }, []);

    const handleBackFromForward = useCallback((): void => {
      setForwardTarget(null);
      setView('actions');
    }, []);

    const handleHardwareBackPress = useCallback((): boolean => {
      if (view === 'emoji') {
        closeActionSheet();
        return true;
      }
      if (isOpen && view === 'forward') {
        handleBackFromForward();
        return true;
      }
      if (isOpen) {
        closeActionSheet();
        return true;
      }
      return false;
    }, [closeActionSheet, handleBackFromForward, isOpen, view]);

    useEffect(() => {
      if (!isOpen) return;
      const subscription = BackHandler.addEventListener(
        'hardwareBackPress',
        handleHardwareBackPress,
      );
      return (): void => subscription.remove();
    }, [handleHardwareBackPress, isOpen]);

    const handleEmojiSelect = useCallback(
      (selection: EmojiPickerSelection) => {
        const pinnedTarget = reactionTargetRef.current;
        const messageId = pinnedTarget?.messageId ?? message?.messageId;
        const resolvedReactionsMd = pinnedTarget?.reactionsMd ?? reactionsMd;

        if (!messageId || !currentUserId) {
          reactionTargetRef.current = null;
          closeActionSheet();
          return;
        }

        const emojiValue =
          selection.type === 'custom'
            ? `custom:${selection.emojiId}:${selection.name}`
            : selection.value;
        const existing = reactionsMdToRawReactions(resolvedReactionsMd, messageId);
        const hasReacted = existing.some(
          r => r.emojiName === emojiValue && r.userId === currentUserId,
        );

        void zero.mutate(
          mutators.messages.react({
            messageId,
            emojiName: emojiValue,
            action: hasReacted ? 'remove' : 'add',
            timestamp: Date.now(),
            reactionId: hasReacted ? undefined : uuidv4(),
            countId: hasReacted ? undefined : uuidv4(),
          }),
        );

        reactionTargetRef.current = null;
        onEmojiSelect?.(selection);

        close();
      },
      [
        close,
        closeActionSheet,
        currentUserId,
        message?.messageId,
        onEmojiSelect,
        reactionsMd,
        zero,
      ],
    );

    const visibleActions = useMemo(
      () => renderActions.filter(action => action.visible),
      [renderActions],
    );

    // Unsent messages (pending or failed) have a pending entry; reactions make no
    // sense on a message the server hasn't accepted, so hide the quick-reaction rail.
    const pendingEntry = usePendingByMessageId(message?.messageId ?? '');

    const showReactionRail = !!message && !message.isDeleted && !pendingEntry;
    const maxSheetHeight = windowHeight - insets.top - insets.bottom;
    const emojiSheetHeight = Math.min(getEmojiPickerSheetHeight(windowHeight), maxSheetHeight);
    const emojiPanelHeight = Math.min(getEmojiPickerPanelHeight(windowHeight), emojiSheetHeight);
    const forwardPanelHeight = maxSheetHeight;

    return (
      <>
        {sheetMounted && view === 'actions' ? (
          <AppBottomSheet
            isOpen={isOpen}
            onOpenChange={handleActionsSheetOpenChange}
            onDismiss={handleModalDismiss}
            enableBlurKeyboardOnGesture={false}
            enableContentPanningGesture
            allowNativeCloseWhileOpening
            animationDuration={260}
            backdropOpacity={0.66}
            showHandleIndicator
            skipInitialImperativeSnap
            backgroundStyle={styles.transparentSheetBackground}
            mode='dynamic'
          >
            <BottomSheetScrollView contentContainerStyle={styles.floatingScrollContent}>
              <View style={styles.floatingContent}>
                {showReactionRail ? (
                  <View style={[styles.reactionRail, { backgroundColor: bottomSheetBg }]}>
                    {QUICK_REACTIONS.map(emoji => (
                      <Pressable
                        key={emoji}
                        accessibilityRole='button'
                        accessibilityLabel={`React ${emoji}`}
                        style={[styles.quickReactionButton, { backgroundColor: accent }]}
                        onPressIn={stopQuickReactionPress}
                        onPress={event => {
                          event.stopPropagation();
                          handleEmojiSelect({ type: 'emoji', value: emoji });
                        }}
                      >
                        <Text className='text-xl'>{emoji}</Text>
                      </Pressable>
                    ))}
                    <Pressable
                      accessibilityRole='button'
                      accessibilityLabel='More reactions'
                      style={[styles.quickReactionButton, { backgroundColor: accent }]}
                      onPressIn={stopQuickReactionPress}
                      onPress={event => {
                        event.stopPropagation();
                        handleOpenEmojiPicker();
                      }}
                    >
                      <SmilePlus size={20} color={foreground} />
                    </Pressable>
                  </View>
                ) : null}

                <View
                  style={[
                    styles.actionPanel,
                    { backgroundColor: bottomSheetBg, borderColor: border },
                  ]}
                >
                  {visibleActions.map(action => (
                    <Fragment key={action.id}>
                      {action.dividerBefore ? (
                        <View style={[styles.menuDivider, { backgroundColor: border }]} />
                      ) : null}
                      <ActionButton
                        icon={action.icon}
                        label={action.label}
                        variant={action.variant}
                        onPress={action.onPress}
                      />
                    </Fragment>
                  ))}
                </View>
              </View>
            </BottomSheetScrollView>
          </AppBottomSheet>
        ) : sheetMounted ? (
          <AppBottomSheet
            isOpen={isOpen}
            onOpenChange={handleActionsSheetOpenChange}
            onDismiss={handleModalDismiss}
            enableBlurKeyboardOnGesture={false}
            enableContentPanningGesture={view === 'forward'}
            allowNativeCloseWhileOpening
            animationDuration={260}
            backdropOpacity={0.4}
            showHandleIndicator
            skipInitialImperativeSnap
            mode='snap'
            snapPoints={[view === 'emoji' ? emojiSheetHeight : forwardPanelHeight]}
            index={0}
          >
            {view === 'forward' && forwardTarget ? (
              <View style={{ height: forwardPanelHeight }}>
                <ForwardMessageSheetView
                  target={forwardTarget}
                  onClose={closeActionSheet}
                  onBack={handleBackFromForward}
                  zero={zero}
                />
              </View>
            ) : (
              <View style={{ height: emojiPanelHeight }}>
                <EmojiPickerPanel
                  onSelect={handleEmojiSelect}
                  height={emojiPanelHeight}
                  isOpen={isOpen}
                  traceId={emojiPickerTraceIdRef.current ?? 'unknown-emoji-picker'}
                />
              </View>
            )}
          </AppBottomSheet>
        ) : null}
      </>
    );
  },
);

MessageActionsSheet.displayName = 'MessageActionsSheet';
