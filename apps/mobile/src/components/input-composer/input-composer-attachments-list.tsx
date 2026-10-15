import { Loader2, Video, X } from 'lucide-react-native';
import { memo, type ReactElement, useCallback, useEffect } from 'react';
import { Alert, ColorValue, FlatList, Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  FadeIn,
  FadeOut,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import type { ComposerAttachment } from './input-composer.types';
import { getFileTypeConfig } from '@/src/components/chat/file-attachment-card';
import { useChatInputActions, useChatInputComposerState } from './input-composer-context';
import { useDraftAttachments } from '@/src/hooks/useDraftAttachments';
import { useMtlsImage } from '@/src/hooks/useMtlsImage';
import { useMtlsThumbnail } from '@/src/hooks/useMtlsThumbnail';
import { useCSSVariable } from 'uniwind';

type AttachmentsListProps = {
  className?: string;
};

const THUMBNAIL_SIZE = 40;
const THUMBNAIL_BORDER = {
  width: THUMBNAIL_SIZE,
  height: THUMBNAIL_SIZE,
  borderRadius: 6,
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.15)',
} as const;

const isImageMime = (mime: string): boolean => mime.startsWith('image/');
const isVideoMime = (mime: string): boolean => mime.startsWith('video/');
const isUploadingStatus = (status: ComposerAttachment['status']): boolean =>
  status === 'uploading' || status === 'local';

type AttachmentItemProps = {
  attachment: ComposerAttachment;
  onRemove: () => void;
};

const AttachmentDeleteButton = ({ onPress }: { onPress: () => void }): ReactElement => {
  const attachmentRemoveIconColor = useCSSVariable(
    '--color-conversation-input-attachment-remove-icon',
  );
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      className='border-2 border-conversation-input-attachment-remove-icon absolute top-0 right-[-2px] z-10 h-4 w-4 items-center justify-center rounded-full bg-conversation-input-attachment-remove-bg'
    >
      <X size={8} color={attachmentRemoveIconColor as ColorValue} strokeWidth={3} />
    </Pressable>
  );
};

const UploadingOverlay = (): ReactElement => {
  const rotation = useSharedValue(0);

  useEffect(() => {
    rotation.value = withRepeat(withTiming(360, { duration: 1000 }), -1, false);
  }, [rotation]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <View
      className='absolute inset-0 z-20 items-center justify-center rounded-[6px] bg-black/50'
      style={{ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE }}
    >
      <Animated.View style={animatedStyle}>
        <Loader2 size={24} color='white' />
      </Animated.View>
    </View>
  );
};

const isLocalPreviewUri = (uri: string): boolean =>
  uri.startsWith('file://') ||
  uri.startsWith('content://') ||
  uri.startsWith('ph://') ||
  uri.startsWith('assets-library://');

const localPreviewUri = (attachment: ComposerAttachment): string | null => {
  if (isLocalPreviewUri(attachment.thumbnailUri ?? '')) return attachment.thumbnailUri ?? null;
  if (isLocalPreviewUri(attachment.localUri)) return attachment.localUri;
  return null;
};

const ImageAttachmentItem = ({ attachment, onRemove }: AttachmentItemProps): ReactElement => {
  const isUploading = isUploadingStatus(attachment.status);
  const localUri = localPreviewUri(attachment);
  const { uri: remoteUri, isLoading } = useMtlsImage(attachment.attachmentId, {
    enabled: !isUploading && localUri === null,
  });
  const uri = localUri ?? remoteUri;

  return (
    <Animated.View entering={FadeIn} exiting={FadeOut}>
      {!isUploading && <AttachmentDeleteButton onPress={onRemove} />}
      {uri ? (
        <Image source={{ uri }} style={THUMBNAIL_BORDER} contentFit='cover' />
      ) : (
        <View className='bg-neutral-700' style={THUMBNAIL_BORDER} />
      )}
      {(isUploading || (!uri && isLoading)) && <UploadingOverlay />}
    </Animated.View>
  );
};

const VideoAttachmentItem = ({ attachment, onRemove }: AttachmentItemProps): ReactElement => {
  const ext = attachment.originalFilename.split('.').pop()?.toUpperCase() ?? 'MP4';
  const isUploading = isUploadingStatus(attachment.status);
  const localUri = localPreviewUri(attachment);
  const { uri: remoteUri, isLoading } = useMtlsThumbnail(attachment.attachmentId, {
    enabled: !isUploading && localUri === null,
  });
  const uri = localUri ?? remoteUri;

  return (
    <Animated.View entering={FadeIn} exiting={FadeOut}>
      {!isUploading && <AttachmentDeleteButton onPress={onRemove} />}
      <View
        className='rounded-[6px] border border-white/15 overflow-hidden'
        style={{ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE }}
      >
        {uri ? (
          <Image
            source={{ uri }}
            style={{
              width: THUMBNAIL_SIZE,
              height: THUMBNAIL_SIZE,
            }}
            contentFit='cover'
          />
        ) : (
          <View
            className='items-center justify-center'
            style={{ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE, backgroundColor: '#faf5ff' }}
          >
            <Video size={28} color='#9333ea' />
          </View>
        )}
        {/* Video icon overlay - positioned at center without dark background */}
        <View className='absolute inset-0 items-center justify-center pointer-events-none'>
          <View className='rounded-full bg-black/40 p-1.5'>
            <Video size={20} color='white' />
          </View>
        </View>
        {/* Extension label */}
        <View
          className='absolute bottom-1 left-1 rounded px-1'
          style={{ backgroundColor: '#9333ea' }}
        >
          <Text className='text-[9px] font-bold text-white'>{ext}</Text>
        </View>
      </View>
      {(isUploading || (!uri && isLoading)) && <UploadingOverlay />}
    </Animated.View>
  );
};

const FileAttachmentItem = ({ attachment, onRemove }: AttachmentItemProps): ReactElement => {
  const ext = attachment.originalFilename.split('.').pop()?.toUpperCase() ?? '';
  const isUploading = isUploadingStatus(attachment.status);
  const config = getFileTypeConfig(attachment.mimetype, attachment.originalFilename);
  const Icon = config.icon;

  return (
    <Animated.View entering={FadeIn} exiting={FadeOut}>
      {!isUploading && <AttachmentDeleteButton onPress={onRemove} />}
      <View
        className='items-center justify-center rounded-[6px] border border-white/15 bg-neutral-700'
        style={{ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE, backgroundColor: config.color }}
      >
        <Icon size={28} color='white' />
        {ext ? (
          <View
            className='absolute bottom-1 left-1 rounded px-1'
            style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}
          >
            <Text className='text-[9px] font-bold text-white'>{ext}</Text>
          </View>
        ) : null}
      </View>
      {isUploading && <UploadingOverlay />}
    </Animated.View>
  );
};

const AttachmentItem = ({ attachment, onRemove }: AttachmentItemProps): ReactElement => {
  if (isImageMime(attachment.mimetype)) {
    return <ImageAttachmentItem attachment={attachment} onRemove={onRemove} />;
  }
  if (isVideoMime(attachment.mimetype)) {
    return <VideoAttachmentItem attachment={attachment} onRemove={onRemove} />;
  }
  return <FileAttachmentItem attachment={attachment} onRemove={onRemove} />;
};

const AttachmentsListComponent = ({ className }: AttachmentsListProps): ReactElement | null => {
  const { attachments } = useChatInputComposerState();
  const { setAttachments, beginAttachmentMutation, endAttachmentMutation } = useChatInputActions();
  const { removeAttachment: deleteDraftAttachment } = useDraftAttachments();

  const handleRemove = useCallback(
    (attachmentId: string): void => {
      const removedAttachment = attachments.find(item => item.attachmentId === attachmentId);
      if (!removedAttachment) return;

      setAttachments(prev => prev.filter(item => item.attachmentId !== attachmentId));
      beginAttachmentMutation();

      void (async (): Promise<void> => {
        try {
          const isDeleted = await deleteDraftAttachment(attachmentId);
          if (!isDeleted) {
            setAttachments(prev =>
              prev.some(item => item.attachmentId === removedAttachment.attachmentId)
                ? prev
                : [...prev, removedAttachment],
            );
            Alert.alert('Failed to remove attachment', 'Please try removing the attachment again.');
          }
        } finally {
          endAttachmentMutation();
        }
      })();
    },
    [
      attachments,
      beginAttachmentMutation,
      deleteDraftAttachment,
      endAttachmentMutation,
      setAttachments,
    ],
  );

  const renderItem = useCallback(
    ({ item }: { item: ComposerAttachment }): ReactElement => (
      <AttachmentItem attachment={item} onRemove={() => handleRemove(item.attachmentId)} />
    ),
    [handleRemove],
  );

  if (attachments.length === 0) return null;

  return (
    <Animated.View
      entering={FadeIn}
      exiting={FadeOut}
      {...(className !== undefined ? { className } : {})}
      style={{ height: THUMBNAIL_SIZE }}
    >
      <FlatList
        data={attachments}
        keyExtractor={item => item.attachmentId}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps='handled'
        renderItem={renderItem}
        contentContainerStyle={{ gap: 8, display: 'flex' }}
      />
    </Animated.View>
  );
};
const AttachmentsList = memo(AttachmentsListComponent);

AttachmentsList.displayName = 'ChatInput.AttachmentsList';

export { AttachmentsList };
