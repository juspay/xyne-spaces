import { Camera, FileText, Images, type LucideIcon } from 'lucide-react-native';
import { memo, type ReactElement, useCallback, useContext, useMemo, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { KeyboardController } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as VideoThumbnails from 'expo-video-thumbnails';

import {
  useChatInputActions,
  useChatInputComposerState,
  useChatInputConversation,
  useChatInputHandlers,
  useChatInputPanelState,
} from './input-composer-context';
import type { ComposerAttachment } from './input-composer.types';
import {
  pickFromCamera,
  pickFromFiles,
  pickFromGallery,
} from './utils/composer-attachments-picker';
import { BottomSheet } from '@/src/components/ui/bottom-sheet';
import { SheetOverlayPortalContext } from '@/src/components/ui/app-bottom-sheet';
import { useDraftAttachments } from '@/src/hooks/useDraftAttachments';
import { ATTACHMENT_PICKER_FILE_TYPES } from './utils/attachments';
import { ingestComposerAttachments } from './utils/pasteComposerAttachments';
import {
  getAttachmentCountLimitError,
  getRemainingAttachmentSlots,
} from './utils/attachmentPolicy';

const VIDEO_THUMBNAIL_TIME_MS = 1000; // 1 second

const isVideoMime = (mime: string): boolean => mime.startsWith('video/');
const isValidImageThumbnailUri = (uri: string): boolean => !isVideoUri(uri);

/**
 * Generate a thumbnail from a video file using expo-video-thumbnails
 */
async function generateVideoThumbnail(
  uri: string,
): Promise<{ uri: string; width: number; height: number } | null> {
  try {
    const result = await VideoThumbnails.getThumbnailAsync(uri, {
      time: VIDEO_THUMBNAIL_TIME_MS,
    });
    return {
      uri: result.uri,
      width: result.width,
      height: result.height,
    };
  } catch {
    return null;
  }
}

/**
 * Check if a URI is a video file (not an image thumbnail)
 */
const isVideoUri = (uri: string): boolean => {
  const lowerUri = uri.toLowerCase();
  return (
    lowerUri.endsWith('.mp4') ||
    lowerUri.endsWith('.mov') ||
    lowerUri.endsWith('.avi') ||
    lowerUri.endsWith('.mkv')
  );
};

/**
 * Process attachments to generate thumbnails for videos before adding to state
 */
async function processAttachmentsWithThumbnails(
  attachments: ComposerAttachment[],
): Promise<ComposerAttachment[]> {
  const needsThumbnailGeneration = attachments.some(
    attachment =>
      isVideoMime(attachment.mimetype) &&
      (!attachment.thumbnailUri || !isValidImageThumbnailUri(attachment.thumbnailUri)),
  );

  if (!needsThumbnailGeneration) {
    return attachments;
  }

  return Promise.all(
    attachments.map(async attachment => {
      const isVideo = isVideoMime(attachment.mimetype);
      const hasValidThumbnail =
        typeof attachment.thumbnailUri === 'string' &&
        isValidImageThumbnailUri(attachment.thumbnailUri);

      if (isVideo && !hasValidThumbnail) {
        const thumbnail = await generateVideoThumbnail(attachment.localUri);
        if (thumbnail) {
          return {
            ...attachment,
            thumbnailUri: thumbnail.uri,
            width: attachment.width ?? thumbnail.width,
            height: attachment.height ?? thumbnail.height,
          };
        }
      }
      return attachment;
    }),
  );
}

const ATTACHMENT_ICON_SIZE = 54;

type AttachmentOptionConfig = {
  key: string;
  label: string;
  iconBg: string;
  iconColor: string;
  Icon: LucideIcon;
  picker: (fileTypes: string[], remainingSlots?: number) => Promise<ComposerAttachment[]>;
};

type AttachmentOptionButtonProps = {
  option: AttachmentOptionConfig;
  disabled: boolean;
  onPress: () => void;
};

const AttachmentOptionButton = ({
  option,
  disabled,
  onPress,
}: AttachmentOptionButtonProps): ReactElement => {
  const { Icon, label, iconBg, iconColor } = option;

  return (
    <Pressable
      className='flex-1 items-center gap-2 py-3 active:opacity-70'
      disabled={disabled}
      accessibilityRole='button'
      accessibilityLabel={label}
      onPress={onPress}
    >
      <View
        className='items-center justify-center rounded-full'
        style={{
          width: ATTACHMENT_ICON_SIZE,
          height: ATTACHMENT_ICON_SIZE,
          backgroundColor: iconBg,
        }}
      >
        <Icon size={24} color={iconColor} strokeWidth={2} />
      </View>
      <Text className='text-center text-[13px] text-secondary-foreground' numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
};

const OpenAttachmentsSheet = ({ isOpen }: { isOpen: boolean }): ReactElement => {
  const { conversationId, threadId } = useChatInputConversation();
  const { attachments } = useChatInputComposerState();
  const { setAttachments, setIsAttachSheetOpenState } = useChatInputActions();
  const { inputRef } = useChatInputHandlers();
  const { addAttachments: uploadDraftAttachments } = useDraftAttachments();
  const insets = useSafeAreaInsets();
  const overlayHostName = useContext(SheetOverlayPortalContext);
  const [isPickingAttachments, setIsPickingAttachments] = useState(false);
  const remainingAttachmentSlots = getRemainingAttachmentSlots(attachments.length);

  const closeSheetAndDismissKeyboard = async (): Promise<void> => {
    setIsAttachSheetOpenState(false);
    await KeyboardController.dismiss();
  };

  const handleAttachmentsAdded = useCallback(
    async (newAttachments: ComposerAttachment[]): Promise<void> => {
      if (newAttachments.length === 0) return;

      const processedAttachments = await processAttachmentsWithThumbnails(newAttachments);

      const ingestPromise = ingestComposerAttachments({
        newAttachments: processedAttachments,
        existingAttachments: attachments,
        setAttachments,
        uploadDraftAttachments,
        conversationId,
        threadId: threadId ?? null,
      });
      // Let the attachment row commit before reopening the keyboard; otherwise
      // the sticky composer animates against its old height.
      const focusPromise = new Promise<void>(resolve => {
        requestAnimationFrame(() => {
          inputRef.current?.focus();
          resolve();
        });
      });
      await Promise.all([ingestPromise, focusPromise]);
    },
    [attachments, conversationId, inputRef, setAttachments, threadId, uploadDraftAttachments],
  );

  const pickAndHandleAttachments = async (
    picker: (fileTypes: string[], remainingSlots?: number) => Promise<ComposerAttachment[]>,
  ): Promise<void> => {
    if (isPickingAttachments) return;
    if (remainingAttachmentSlots === 0) {
      Alert.alert('Attachment limit reached', getAttachmentCountLimitError());
      return;
    }

    setIsPickingAttachments(true);
    await closeSheetAndDismissKeyboard();
    try {
      const picked = await picker([...ATTACHMENT_PICKER_FILE_TYPES], remainingAttachmentSlots);
      await handleAttachmentsAdded(picked);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to add attachment';
      Alert.alert('Attachment unavailable', message);
    } finally {
      setIsPickingAttachments(false);
    }
  };

  const attachmentOptions = useMemo<AttachmentOptionConfig[]>(
    () => [
      {
        key: 'gallery',
        label: 'Gallery',
        iconBg: '#7F66FF',
        iconColor: '#FFFFFF',
        Icon: Images,
        picker: pickFromGallery,
      },
      {
        key: 'camera',
        label: 'Camera',
        iconBg: '#D4D4D8',
        iconColor: '#52525B',
        Icon: Camera,
        picker: pickFromCamera,
      },
      {
        key: 'document',
        label: 'Document',
        iconBg: '#5B7FD6',
        iconColor: '#FFFFFF',
        Icon: FileText,
        picker: pickFromFiles,
      },
    ],
    [],
  );

  return (
    <BottomSheet isOpen={isOpen} onOpenChange={open => !open && setIsAttachSheetOpenState(false)}>
      <BottomSheet.Portal
        {...(overlayHostName ? { hostName: overlayHostName, disableFullWindowOverlay: true } : {})}
      >
        <BottomSheet.Overlay className='bg-black/40' />
        <BottomSheet.Content
          snapPoints={['24%']}
          index={0}
          backgroundClassName='bg-card rounded-t-3xl'
          handleIndicatorClassName='bg-muted w-10 h-1 rounded-full'
          style={{ paddingBottom: insets.bottom }}
          enablePanDownToClose
          keyboardBehavior='interactive'
          keyboardBlurBehavior='restore'
        >
          <View className='px-3 pt-3 pb-4'>
            <View className='flex-row'>
              {attachmentOptions.map(option => (
                <AttachmentOptionButton
                  key={option.key}
                  option={option}
                  disabled={isPickingAttachments || remainingAttachmentSlots === 0}
                  onPress={() => void pickAndHandleAttachments(option.picker)}
                />
              ))}
            </View>
          </View>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  );
};

const AttachmentsSheetComponent = (): ReactElement => {
  const { isAttachSheetOpen } = useChatInputPanelState();
  return <OpenAttachmentsSheet isOpen={isAttachSheetOpen} />;
};
const AttachmentsSheet = memo(AttachmentsSheetComponent);

AttachmentsSheet.displayName = 'ChatInput.AttachmentsSheet';

export { AttachmentsSheet };
