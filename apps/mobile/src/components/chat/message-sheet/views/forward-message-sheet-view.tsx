import { LegendList } from '@legendapp/list/react-native';
import { Check, Hash, Image as ImageIcon, Lock, Play, Video, X } from 'lucide-react-native';
import { memo, useCallback, useEffect, useRef, type ReactElement } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
  Platform,
} from 'react-native';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { useCSSVariable, useUniwind } from 'uniwind';
import type { Zero } from '@rocicorp/zero';
import { useGenericKeyboardHandler } from 'react-native-keyboard-controller';
import { runOnJS, useSharedValue } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';

import { openAttachmentsViewer } from '@/src/components/attachments-viewer/utils/openAttachmentsViewer';
import { getFileTypeConfig } from '@/src/components/chat/file-attachment-card';
import {
  formatFileSize,
  truncateFileName,
} from '@/src/components/chat/message/message-attachments.utils';
import Avatar from '@/src/components/ui/avatar';
import { cn } from '@/src/utils/cn';
import { Popover, type PopoverTriggerRef } from '@/src/components/ui/popover';
import { useMtlsImage } from '@/src/hooks/useMtlsImage';
import { useMtlsThumbnail } from '@/src/hooks/useMtlsThumbnail';
import type { AttachmentsViewerItem } from '@/src/machines/attachmentsMachine';

import {
  useForwardMessageViewModel,
  type ForwardSearchListItem,
  type ForwardMessageSheetTarget,
  type ForwardMessagePreviewAttachment,
} from './forward-message-view-model';
import InputV2 from '@/src/components/ui/input-v2';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';

// ─── Native glass availability ────────────────────────────────────────────────
const NATIVE_GLASS = ((): boolean => {
  try {
    return Platform.OS === 'ios' && isGlassEffectAPIAvailable();
  } catch {
    return false;
  }
})();
const IS_ANDROID = Platform.OS === 'android';
const PREVIEW_ATTACHMENT_MEDIA_SIZE = 64;
const PREVIEW_ATTACHMENT_FILE_WIDTH = 176;
const PREVIEW_ATTACHMENT_LIST_HEIGHT = 72;
const PREVIEW_ATTACHMENT_ESTIMATED_SIZE = 120;

// ─── GlassButton ──────────────────────────────────────────────────────────────

interface GlassButtonProps {
  /** Solid fill, overriding the glass tint. Used for brand CTAs. */
  fillColor?: string;
  onPress: () => void;
  disabled?: boolean;
  size?: number;
  height?: number;
  borderRadius?: number;
  isDark: boolean;
  className?: string;
  children: React.ReactNode;
}

const GlassButton = ({
  onPress,
  disabled = false,
  size,
  height = 36,
  borderRadius = 12,
  isDark,
  className,
  fillColor,
  children,
}: GlassButtonProps): ReactElement => {
  const accentBg = useCSSVariable('--color-accent') as string;
  const borderCol = useCSSVariable('--color-border') as string;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={({ pressed }) => ({
        opacity: pressed ? 0.58 : disabled ? 0.35 : 1,
      })}
    >
      {NATIVE_GLASS ? (
        <GlassView
          isInteractive
          colorScheme={isDark ? 'dark' : 'light'}
          style={[styles.glassBase, { width: size, height, borderRadius }]}
        >
          {(className || fillColor) && (
            <View
              className={className ?? ''}
              style={[
                StyleSheet.absoluteFill,
                { borderRadius, ...(fillColor ? { backgroundColor: fillColor } : {}) },
              ]}
            />
          )}
          {children}
        </GlassView>
      ) : (
        <View
          className={className ?? ''}
          style={[
            styles.fallbackBase,
            {
              width: size,
              height,
              borderRadius,
              ...(fillColor
                ? { backgroundColor: fillColor }
                : !className && {
                    backgroundColor: accentBg,
                    borderColor: borderCol,
                  }),
            },
          ]}
        >
          {children}
        </View>
      )}
    </Pressable>
  );
};

// ─── ActionBar ────────────────────────────────────────────────────────────────

const ActionBar = ({
  onCancel,
  onSubmit,
  canSubmit,
  isSubmitting,
}: {
  onCancel: () => void;
  onSubmit: () => void;
  canSubmit: boolean;
  isSubmitting: boolean;
}): ReactElement => {
  const { theme } = useUniwind();
  const isDark = theme === 'dark';
  const { accentBg: ctaBg } = useBubbleAccent();

  const primaryTextColor = useCSSVariable('--color-primary-bg') as string;
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const mutedTextColor = useCSSVariable('--color-chat-card-muted') as string;
  const borderColor = useCSSVariable('--color-border') as string;
  const headerColor = useCSSVariable('--color-bottomsheet-text-header') as string;

  if (Platform.OS === 'ios') {
    return (
      <View style={[styles.actionBarRow, { borderBottomColor: borderColor }]}>
        <GlassButton onPress={onCancel} size={44} height={44} borderRadius={30} isDark={isDark}>
          <X size={24} strokeWidth={2.2} color={foregroundColor} />
        </GlassButton>
        <Text className='text-base font-semibold text-foreground'>Forward Message</Text>
        <GlassButton
          onPress={onSubmit}
          disabled={!canSubmit}
          size={44}
          height={44}
          borderRadius={30}
          isDark={isDark}
          fillColor={ctaBg}
        >
          <Check
            size={22}
            color={canSubmit && !isSubmitting ? primaryTextColor : mutedTextColor}
            strokeWidth={2.5}
          />
        </GlassButton>
      </View>
    );
  }

  return (
    <View className='flex-row items-center justify-between px-3'>
      <Pressable
        accessibilityRole='button'
        accessibilityLabel='Back'
        onPress={onCancel}
        hitSlop={8}
        className='rounded-full p-3 bg-bottomsheet-container-bg'
      >
        <X size={22} color={headerColor} />
      </Pressable>

      <Text className='text-[17px] font-semibold text-bottomsheet-text-header'>
        Forward Message
      </Text>

      <Pressable
        accessibilityRole='button'
        onPress={onSubmit}
        disabled={!canSubmit}
        className={cn(
          'items-center rounded-full p-3',
          canSubmit ? 'active:opacity-90' : 'opacity-50',
          isSubmitting ? 'opacity-50' : '',
        )}
      >
        <Check size={22} color='#fff' />
      </Pressable>
    </View>
  );
};

type ForwardTargetRowProps = {
  item: ForwardSearchListItem;
  foreground: string;
  onSelect: (item: ForwardSearchListItem) => void;
};

const ForwardTargetRow = memo(function ForwardTargetRow({
  item,
  foreground,
  onSelect,
}: ForwardTargetRowProps): ReactElement {
  const handlePress = useCallback(() => onSelect(item), [item, onSelect]);

  return (
    <Pressable
      onPress={handlePress}
      className='flex-row items-center gap-3 px-4 py-3 active:bg-accent'
    >
      {item.type === 'channel' ? (
        <View className='size-7 items-center justify-center rounded-md'>
          {item.isPrivate ? (
            <Lock size={15} color={foreground} />
          ) : (
            <Hash size={15} color={foreground} />
          )}
        </View>
      ) : (
        <Avatar userIds={[item.id]} size={32} />
      )}
      <View className='min-w-0 flex-1'>
        <Text className='font-medium text-bottomsheet-container-foreground' numberOfLines={1}>
          {item.name}
        </Text>
        {item.description ? (
          <Text className='text-xs text-bottomsheet-container-text-secondary' numberOfLines={1}>
            {item.description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});

type ForwardTargetsPopoverProps = {
  isOpen: boolean;
  items: ForwardSearchListItem[];
  foreground: string;
  onSelect: (item: ForwardSearchListItem) => void;
  onOpenChange: (isOpen: boolean) => void;
  onInteractionStart: () => void;
  children: React.ReactNode;
};

const ForwardTargetsPopover = ({
  isOpen,
  items,
  foreground,
  onSelect,
  onOpenChange,
  onInteractionStart,
  children,
}: ForwardTargetsPopoverProps): ReactElement => {
  const triggerRef = useRef<PopoverTriggerRef>(null);
  const syncFrameRef = useRef<number | null>(null);
  const isOpenRef = useRef(isOpen);
  const schedulePopoverPositionSyncRef = useRef<() => void>(() => undefined);
  const isOpenShared = useSharedValue(IS_ANDROID && isOpen ? 1 : 0);

  isOpenRef.current = isOpen;

  useEffect(() => {
    isOpenShared.value = IS_ANDROID && isOpen ? 1 : 0;
  }, [isOpen, isOpenShared]);

  const syncPopoverPosition = useCallback(() => {
    if (!isOpenRef.current) return;
    triggerRef.current?.open();
  }, []);

  const schedulePopoverPositionSync = useCallback(() => {
    if (!isOpenRef.current || syncFrameRef.current !== null) return;

    syncFrameRef.current = requestAnimationFrame(() => {
      syncFrameRef.current = null;
      syncPopoverPosition();
    });
  }, [syncPopoverPosition]);
  schedulePopoverPositionSyncRef.current = schedulePopoverPositionSync;

  const schedulePopoverPositionSyncFromKeyboard = useCallback(() => {
    schedulePopoverPositionSyncRef.current();
  }, []);

  const handleKeyboardFrameSync = useCallback(() => {
    'worklet';
    if (isOpenShared.value) {
      runOnJS(schedulePopoverPositionSyncFromKeyboard)();
    }
  }, [isOpenShared, schedulePopoverPositionSyncFromKeyboard]);

  useEffect(() => {
    return (): void => {
      if (syncFrameRef.current !== null) {
        cancelAnimationFrame(syncFrameRef.current);
      }
    };
  }, []);

  useGenericKeyboardHandler(
    {
      onMove: handleKeyboardFrameSync,
      onEnd: handleKeyboardFrameSync,
    },
    [handleKeyboardFrameSync],
  );

  useEffect(() => {
    if (!isOpen) return;

    const syncOnKeyboardChange = IS_ANDROID ? schedulePopoverPositionSync : syncPopoverPosition;
    const showSubscription = Keyboard.addListener('keyboardDidShow', syncOnKeyboardChange);
    const hideSubscription = Keyboard.addListener('keyboardDidHide', syncOnKeyboardChange);

    return (): void => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [isOpen, schedulePopoverPositionSync, syncPopoverPosition]);

  const renderItem = useCallback(
    ({ item }: { item: ForwardSearchListItem }): ReactElement => (
      <ForwardTargetRow item={item} foreground={foreground} onSelect={onSelect} />
    ),
    [foreground, onSelect],
  );

  const handleContentResponderCapture = useCallback(() => {
    onInteractionStart();
    return false;
  }, [onInteractionStart]);

  return (
    <Popover isOpen={isOpen} onOpenChange={onOpenChange} presentation='popover' asChild>
      <View>
        <Popover.Trigger
          ref={triggerRef}
          isDisabled
          onLayout={IS_ANDROID ? schedulePopoverPositionSync : syncPopoverPosition}
        >
          {children}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Overlay />
          <Popover.Content
            presentation='popover'
            placement='bottom'
            align='start'
            width={300}
            offset={Platform.OS !== 'ios' ? 50 : 0}
            className='overflow-hidden rounded-[18px] bg-bottomsheet-container-bg p-0'
            onStartShouldSetResponderCapture={handleContentResponderCapture}
          >
            <LegendList
              style={{ maxHeight: 200 }}
              data={items}
              keyExtractor={item => `${item.type}-${item.id}`}
              keyboardShouldPersistTaps='handled'
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
              renderItem={renderItem}
              ListEmptyComponent={
                <View className='px-4 py-6'>
                  <Text className='text-center text-sm text-secondary-foreground'>
                    No results found
                  </Text>
                </View>
              }
            />
          </Popover.Content>
        </Popover.Portal>
      </View>
    </Popover>
  );
};

type ForwardPreviewAttachmentOpen = (attachmentId: string) => void;

type ForwardPreviewAttachmentItemProps = {
  attachment: ForwardMessagePreviewAttachment;
  onOpen: ForwardPreviewAttachmentOpen;
};

type ForwardPreviewAttachmentPressProps = {
  attachment: ForwardMessagePreviewAttachment;
  onPress: () => void;
};

const ForwardPreviewMediaAttachment = memo(function ForwardPreviewMediaAttachment({
  attachment,
  onPress,
}: ForwardPreviewAttachmentPressProps): ReactElement {
  const isImage = attachment.mimetype.startsWith('image/');
  const isVideo = attachment.mimetype.startsWith('video/');
  const mutedColor = useCSSVariable('--color-bottomsheet-container-text-secondary') as string;
  const borderColor = useCSSVariable('--color-border') as string;

  const {
    uri: imageUri,
    isLoading: isImageLoading,
    error: imageError,
  } = useMtlsImage(isImage ? attachment.id : undefined, { enabled: isImage });
  const {
    uri: thumbnailUri,
    isLoading: isThumbnailLoading,
    error: thumbnailError,
  } = useMtlsThumbnail(isVideo ? attachment.id : undefined, { enabled: isVideo });

  const uri = isImage ? imageUri : thumbnailUri;
  const isLoading = isImage ? isImageLoading : isThumbnailLoading;
  const hasError = isImage ? !!imageError : !!thumbnailError;

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={`Open ${attachment.originalFilename}`}
      onPress={onPress}
      className='bg-bottomsheet-container-bg-secondary'
      style={({ pressed }) => [
        styles.previewAttachmentMedia,
        { borderColor },
        pressed ? { opacity: 0.85 } : null,
      ]}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          cachePolicy='memory-disk'
          recyclingKey={attachment.id}
          contentFit='cover'
        />
      ) : (
        <View className='absolute inset-0 items-center justify-center'>
          {isLoading && !hasError ? (
            <ActivityIndicator size='small' color={mutedColor} />
          ) : isVideo ? (
            <Video size={24} color={mutedColor} strokeWidth={1.7} />
          ) : (
            <ImageIcon size={24} color={mutedColor} strokeWidth={1.7} />
          )}
        </View>
      )}

      {isVideo ? (
        <View pointerEvents='none' className='absolute inset-0 items-center justify-center'>
          <View className='size-8 items-center justify-center rounded-full bg-black/55'>
            <Play size={15} color='#fff' fill='#fff' />
          </View>
        </View>
      ) : null}
    </Pressable>
  );
});

const ForwardPreviewFileAttachment = memo(function ForwardPreviewFileAttachment({
  attachment,
  onPress,
}: ForwardPreviewAttachmentPressProps): ReactElement {
  const borderColor = useCSSVariable('--color-border') as string;
  const config = getFileTypeConfig(attachment.mimetype, attachment.originalFilename);
  const Icon = config.icon;
  const fileName = truncateFileName(attachment.originalFilename, 24);
  const fileSize = formatFileSize(attachment.size);

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={`Open ${attachment.originalFilename}`}
      onPress={onPress}
      className='bg-bottomsheet-container-bg-secondary'
      style={({ pressed }) => [
        styles.previewAttachmentFile,
        { borderColor },
        pressed ? { opacity: 0.85 } : null,
      ]}
    >
      <View
        className='items-center justify-center rounded-lg'
        style={{ width: 38, height: 38, backgroundColor: config.color }}
      >
        <Icon size={20} color='#fff' strokeWidth={2.1} />
      </View>
      <View className='min-w-0 flex-1'>
        <Text
          className='text-xs font-semibold text-bottomsheet-container-foreground'
          numberOfLines={2}
        >
          {fileName}
        </Text>
        <Text
          className='mt-1 text-[10px] text-bottomsheet-container-text-secondary'
          numberOfLines={1}
        >
          {config.label} - {fileSize}
        </Text>
      </View>
    </Pressable>
  );
});

const ForwardPreviewAttachmentItem = memo(function ForwardPreviewAttachmentItem({
  attachment,
  onOpen,
}: ForwardPreviewAttachmentItemProps): ReactElement {
  const handlePress = useCallback(() => onOpen(attachment.id), [attachment.id, onOpen]);
  const isMedia =
    attachment.mimetype.startsWith('image/') || attachment.mimetype.startsWith('video/');

  if (isMedia) {
    return <ForwardPreviewMediaAttachment attachment={attachment} onPress={handlePress} />;
  }

  return <ForwardPreviewFileAttachment attachment={attachment} onPress={handlePress} />;
});

type ForwardPreviewAttachmentStripProps = {
  attachments: readonly ForwardMessagePreviewAttachment[];
  viewerItems: AttachmentsViewerItem[];
  sourceMessageId: string | undefined;
  onClose: () => void;
};

const ForwardPreviewAttachmentStrip = memo(function ForwardPreviewAttachmentStrip({
  attachments,
  viewerItems,
  sourceMessageId,
  onClose,
}: ForwardPreviewAttachmentStripProps): ReactElement | null {
  const router = useRouter();

  const handleOpenAttachment = useCallback(
    (attachmentId: string) => {
      const index = viewerItems.findIndex(attachment => attachment.id === attachmentId);
      if (index < 0) return;

      openAttachmentsViewer(router, {
        attachments: viewerItems,
        initialIndex: index,
        ...(sourceMessageId ? { source: { kind: 'message' as const, id: sourceMessageId } } : {}),
      });
      onClose();
    },
    [onClose, router, sourceMessageId, viewerItems],
  );

  const renderItem = useCallback(
    ({ item }: { item: ForwardMessagePreviewAttachment }): ReactElement => (
      <ForwardPreviewAttachmentItem attachment={item} onOpen={handleOpenAttachment} />
    ),
    [handleOpenAttachment],
  );

  if (attachments.length === 0) return null;

  return (
    <LegendList
      horizontal
      data={attachments}
      keyExtractor={item => item.id}
      renderItem={renderItem}
      estimatedItemSize={PREVIEW_ATTACHMENT_ESTIMATED_SIZE}
      recycleItems
      nestedScrollEnabled
      showsHorizontalScrollIndicator={false}
      style={styles.previewAttachmentList}
      contentContainerStyle={styles.previewAttachmentListContent}
      keyboardShouldPersistTaps='handled'
    />
  );
});

type ForwardMessageSheetViewProps = {
  target: ForwardMessageSheetTarget;
  onClose: (afterDismiss?: () => void) => void;
  onBack: () => void;
  zero: Zero | null;
};

export const ForwardMessageSheetView = ({
  target,
  onClose,
  onBack,
  zero,
}: ForwardMessageSheetViewProps): ReactElement => {
  const foreground = useCSSVariable('--color-foreground') as string;
  const containerTextSecondary = useCSSVariable(
    '--color-bottomsheet-container-text-secondary',
  ) as string;

  const vm = useForwardMessageViewModel({ target, onClose, zero });
  const { closeTargetsPopover, handleSelectItem, inputRef } = vm;

  const showList =
    vm.isInputFocused && (vm.searchQuery.trim().length > 0 || vm.selectionMode === 'none');

  const handleSelectTarget = useCallback(
    (item: ForwardSearchListItem) => {
      handleSelectItem(item);
      inputRef.current?.focus();
    },
    [handleSelectItem, inputRef],
  );

  const handleTargetsPopoverOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        closeTargetsPopover();
      }
    },
    [closeTargetsPopover],
  );

  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingBottom: 32,
        flex: 1,
        gap: 16,
      }}
    >
      <ActionBar
        onCancel={onBack}
        onSubmit={() => void vm.handleForward()}
        canSubmit={vm.canSubmit}
        isSubmitting={vm.isSubmitting}
      />

      {vm.selectedTargets.length > 0 ? (
        <View className='flex-row flex-wrap gap-2 mx-2'>
          {vm.selectedTargets.map(t => (
            <View
              key={t.id}
              className='flex-row items-center gap-1.5 rounded-full bg-bottomsheet-container-bg-secondary px-3 py-1.5'
            >
              {t.type === 'channel' ? <Hash size={14} color={containerTextSecondary} /> : null}
              <Text className='text-sm font-medium text-bottomsheet-container-text-secondary'>
                {t.name}
              </Text>
              <Pressable
                accessibilityRole='button'
                accessibilityLabel={`Remove ${t.name}`}
                onPress={() => vm.handleRemoveTarget(t.id)}
                className='rounded-full p-0.5 active:bg-secondary/60'
              >
                <X size={14} color={containerTextSecondary} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <ForwardTargetsPopover
        isOpen={showList}
        items={vm.filteredItems}
        foreground={foreground}
        onSelect={handleSelectTarget}
        onOpenChange={handleTargetsPopoverOpenChange}
        onInteractionStart={vm.deferTargetsPopoverClose}
      >
        <InputV2
          variant='bottomsheet'
          inputRef={vm.inputRef}
          value={vm.searchQuery}
          onChangeText={vm.setSearchQuery}
          onFocus={vm.handleInputFocus}
          onBlur={vm.handleInputBlur}
          placeholder={
            vm.selectionMode === 'channel'
              ? 'Search channels…'
              : vm.selectionMode === 'users'
                ? 'Add more users…'
                : 'Forward to…'
          }
          placeholderTextColor={containerTextSecondary}
          withContainer={false}
          inputClassName='border-b-[0.5px] border-border px-3 py-3 text-base text-bottomsheet-container-foreground'
        />
      </ForwardTargetsPopover>

      <InputV2
        variant='bottomsheet'
        value={vm.optionalMessage}
        onChangeText={vm.setOptionalMessage}
        placeholder='Add a note to the forwarded message…'
        placeholderTextColor={containerTextSecondary}
        multiline
        numberOfLines={3}
        withContainer={false}
        inputClassName='border-b-[0.5px] border-border px-3 py-3 text-base text-bottomsheet-container-foreground'
        inputStyle={{ textAlignVertical: 'top' }}
      />

      <View className='rounded-xl border-[0.5px] border-border bg-bottomsheet-container-bg dark:bg-bottomsheet-container-bg-secondary p-3 mx-4'>
        <View className='flex-row gap-3'>
          <View className='min-w-0 flex-1'>
            <View className='mb-1 flex-row flex-wrap items-baseline gap-2'>
              <Text className='text-xs font-semibold text-settings-icon-blue'>
                {vm.sender?.name ?? 'User'}
              </Text>
            </View>
            {vm.previewText ? (
              <Text className='text-sm text-bottomsheet-container-text-secondary' numberOfLines={5}>
                {vm.previewText}
              </Text>
            ) : null}
            <ForwardPreviewAttachmentStrip
              attachments={vm.previewAttachments}
              viewerItems={vm.previewAttachmentViewerItems}
              sourceMessageId={vm.previewSourceMessageId}
              onClose={onClose}
            />
            {vm.previewAttachments.length > 0 ? (
              <Text className='text-bottomsheet-container-text-secondary text-[11px] font-semibold'>
                {vm.previewAttachmentViewerItems.length} attachments will be forwarded
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  glassBase: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackBase: {
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
  },
  actionBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  previewAttachmentList: {
    height: PREVIEW_ATTACHMENT_LIST_HEIGHT,
    marginTop: 10,
  },
  previewAttachmentListContent: {
    paddingRight: 4,
  },
  previewAttachmentMedia: {
    width: PREVIEW_ATTACHMENT_MEDIA_SIZE,
    height: PREVIEW_ATTACHMENT_MEDIA_SIZE,
    marginRight: 8,
    overflow: 'hidden',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  previewAttachmentFile: {
    width: PREVIEW_ATTACHMENT_FILE_WIDTH,
    height: PREVIEW_ATTACHMENT_MEDIA_SIZE,
    marginRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    overflow: 'hidden',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
  },
});
