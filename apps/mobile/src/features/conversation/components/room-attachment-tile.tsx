import { File, Play, RotateCw, X } from 'lucide-react-native';
import { memo, useCallback, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Animated from 'react-native-reanimated';
import { useCSSVariable } from 'uniwind';

import { getFileTypeConfig } from '@/src/components/chat/file-attachment-card';
import { localPreviewUri } from '@/src/components/input-composer/input-composer-attachment-helpers';
import type { ComposerAttachment } from '@/src/components/input-composer/input-composer.types';
import { useMtlsImage } from '@/src/hooks/useMtlsImage';
import { useMtlsThumbnail } from '@/src/hooks/useMtlsThumbnail';
import { haptics } from '@/src/utils/haptics';

import {
  TYPING_BAR_ATTACHMENT_PENDING_OPACITY,
  TYPING_BAR_ATTACHMENT_PLAY_ICON_SIZE,
  TYPING_BAR_ATTACHMENT_PLAY_INSET,
  TYPING_BAR_ATTACHMENT_PLAY_SIZE,
  TYPING_BAR_ATTACHMENT_RADIUS,
  TYPING_BAR_ATTACHMENT_REMOVE_HIT_SLOP,
  TYPING_BAR_ATTACHMENT_REMOVE_ICON_SIZE,
  TYPING_BAR_ATTACHMENT_REMOVE_OFFSET,
  TYPING_BAR_ATTACHMENT_REMOVE_RING,
  TYPING_BAR_ATTACHMENT_REMOVE_SIZE,
  TYPING_BAR_ATTACHMENT_RETRY_HIT_SLOP,
  TYPING_BAR_ATTACHMENT_RETRY_ICON_SIZE,
  TYPING_BAR_ATTACHMENT_RETRY_SIZE,
  TYPING_BAR_ATTACHMENT_SIZE,
  TYPING_BAR_FILE_CHIP_GAP,
  TYPING_BAR_FILE_CHIP_ICON_SIZE,
  TYPING_BAR_FILE_CHIP_NAME_MAX_WIDTH,
  TYPING_BAR_FILE_CHIP_PADDING_X,
  TYPING_BAR_FILE_CHIP_PADDING_Y,
  TYPING_BAR_STRIP_ENTER_MS,
  TYPING_BAR_STRIP_EXIT_MS,
  TYPING_BAR_STRIP_SCALE,
} from '../constants';
import {
  composerAttachmentKind,
  composerAttachmentLabel,
  composerAttachmentPhase,
  type ComposerAttachmentKind,
  type ComposerAttachmentPhase,
} from '../model/composer-attachments';
import { fadeScaleTransition } from '../model/fade-scale-transition';
import { fileCardSubtitle } from '../model/file-card';
import { colorOf } from '../model/token-color';

const MEDIA_STYLE = {
  width: TYPING_BAR_ATTACHMENT_SIZE,
  height: TYPING_BAR_ATTACHMENT_SIZE,
  borderRadius: TYPING_BAR_ATTACHMENT_RADIUS,
} as const;
const FILE_STYLE = {
  height: TYPING_BAR_ATTACHMENT_SIZE,
  borderRadius: TYPING_BAR_ATTACHMENT_RADIUS,
  paddingVertical: TYPING_BAR_FILE_CHIP_PADDING_Y,
  paddingHorizontal: TYPING_BAR_FILE_CHIP_PADDING_X,
  gap: TYPING_BAR_FILE_CHIP_GAP,
} as const;
const FILE_TEXT_STYLE = { maxWidth: TYPING_BAR_FILE_CHIP_NAME_MAX_WIDTH } as const;
const PLAY_STYLE = {
  left: TYPING_BAR_ATTACHMENT_PLAY_INSET,
  bottom: TYPING_BAR_ATTACHMENT_PLAY_INSET,
  width: TYPING_BAR_ATTACHMENT_PLAY_SIZE,
  height: TYPING_BAR_ATTACHMENT_PLAY_SIZE,
  borderRadius: TYPING_BAR_ATTACHMENT_PLAY_SIZE / 2,
} as const;
/**
 * Remove hangs past the tile's corner. Android only lets a child take touches
 * inside its parent, so the tile makes room for it rather than letting it
 * overflow; the strip takes the same amount off its gap and padding.
 */
const TILE_STYLE = {
  paddingTop: TYPING_BAR_ATTACHMENT_REMOVE_OFFSET,
  paddingRight: TYPING_BAR_ATTACHMENT_REMOVE_OFFSET,
} as const;
const REMOVE_STYLE = {
  top: 0,
  right: 0,
  width: TYPING_BAR_ATTACHMENT_REMOVE_SIZE,
  height: TYPING_BAR_ATTACHMENT_REMOVE_SIZE,
  borderRadius: TYPING_BAR_ATTACHMENT_REMOVE_SIZE / 2,
  borderWidth: TYPING_BAR_ATTACHMENT_REMOVE_RING,
} as const;
const RETRY_STYLE = {
  width: TYPING_BAR_ATTACHMENT_RETRY_SIZE,
  height: TYPING_BAR_ATTACHMENT_RETRY_SIZE,
  borderRadius: TYPING_BAR_ATTACHMENT_RETRY_SIZE / 2,
} as const;
const DIMMED_STYLE = { opacity: TYPING_BAR_ATTACHMENT_PENDING_OPACITY } as const;

const { entering, exiting } = fadeScaleTransition({
  enterMs: TYPING_BAR_STRIP_ENTER_MS,
  exitMs: TYPING_BAR_STRIP_EXIT_MS,
  scale: TYPING_BAR_STRIP_SCALE,
});

type PreviewProps = {
  attachment: ComposerAttachment;
  kind: ComposerAttachmentKind;
  phase: ComposerAttachmentPhase;
};

/**
 * A picture or video tile: the on-device picture while it uploads, else the
 * uploaded one, as the classic chips load them. A video adds a play badge.
 */
function MediaPreview({ attachment, kind, phase }: PreviewProps): ReactElement {
  const playColor = colorOf(useCSSVariable('--color-spaces-accent-foreground'));
  const subtle = colorOf(useCSSVariable('--color-spaces-subtle'));
  const localUri = localPreviewUri(attachment);
  const fetchRemote = phase === 'ready' && localUri === null;
  const image = useMtlsImage(attachment.attachmentId, {
    enabled: fetchRemote && kind === 'image',
  });
  const thumbnail = useMtlsThumbnail(attachment.attachmentId, {
    enabled: fetchRemote && kind === 'video',
  });
  const remote = kind === 'video' ? thumbnail : image;
  const uri = localUri ?? remote.uri;

  return (
    <View className='overflow-hidden bg-spaces-background' style={MEDIA_STYLE}>
      {uri ? (
        <Image source={{ uri }} style={MEDIA_STYLE} contentFit='cover' />
      ) : remote.isLoading ? (
        <View className='flex-1 items-center justify-center'>
          <ActivityIndicator size='small' color={subtle} />
        </View>
      ) : null}
      {kind === 'video' ? (
        <View className='absolute items-center justify-center bg-black/50' style={PLAY_STYLE}>
          <Play size={TYPING_BAR_ATTACHMENT_PLAY_ICON_SIZE} color={playColor} fill={playColor} />
        </View>
      ) : null}
    </View>
  );
}

/** A file's chip: the room file card's icon and "PDF · 1.2 MB" under the name. */
function FilePreview({ attachment }: { attachment: ComposerAttachment }): ReactElement {
  const muted = colorOf(useCSSVariable('--color-spaces-muted'));
  const typeLabel = getFileTypeConfig(attachment.mimetype, attachment.originalFilename).label;

  return (
    <View
      className='flex-row items-center border border-spaces-outline bg-spaces-background'
      style={FILE_STYLE}
    >
      <File size={TYPING_BAR_FILE_CHIP_ICON_SIZE} color={muted} />
      <View style={FILE_TEXT_STYLE}>
        <Text
          className='text-[14px] font-medium leading-[18px] tracking-[-0.14px] text-spaces-foreground'
          numberOfLines={1}
          ellipsizeMode='middle'
        >
          {attachment.originalFilename}
        </Text>
        <Text className='text-[12px] leading-4 text-spaces-subtle' numberOfLines={1}>
          {fileCardSubtitle(typeLabel, attachment.size, '')}
        </Text>
      </View>
    </View>
  );
}

type RoomAttachmentTileProps = {
  attachment: ComposerAttachment;
  /** Called with `attachmentId`: the composer's stable action, shared by every tile. */
  onRemove: (attachmentId: string) => void;
  onRetry: (attachmentId: string) => void;
};

/**
 * One draft attachment over the field. Uploading, it shows through at half
 * strength under a spinner (the upload reports no progress to the composer);
 * failed, a retry button sits over it. Remove hides while it uploads, as the
 * classic chip's does, so a half-sent file is never dropped mid-flight.
 */
function RoomAttachmentTileComponent({
  attachment,
  onRemove,
  onRetry,
}: RoomAttachmentTileProps): ReactElement {
  const [backgroundToken, subtleToken, accentForegroundToken] = useCSSVariable([
    '--color-spaces-background',
    '--color-spaces-subtle',
    '--color-spaces-accent-foreground',
  ]);
  const background = colorOf(backgroundToken);
  const subtle = colorOf(subtleToken);
  const retryColor = colorOf(accentForegroundToken);
  const { attachmentId, originalFilename: name } = attachment;
  const kind = composerAttachmentKind(attachment.mimetype);
  const phase = composerAttachmentPhase(attachment.status);

  const handleRemove = useCallback((): void => onRemove(attachmentId), [attachmentId, onRemove]);
  const handleRetry = useCallback((): void => onRetry(attachmentId), [attachmentId, onRetry]);

  return (
    <Animated.View entering={entering} exiting={exiting} style={TILE_STYLE}>
      <View>
        {/* Only the preview is one element: the retry and remove buttons stay reachable on their own. */}
        <View
          accessible
          accessibilityLabel={composerAttachmentLabel(kind, phase, name)}
          style={phase === 'ready' ? undefined : DIMMED_STYLE}
        >
          {kind === 'file' ? (
            <FilePreview attachment={attachment} />
          ) : (
            <MediaPreview attachment={attachment} kind={kind} phase={phase} />
          )}
        </View>
        {phase === 'uploading' ? (
          <View pointerEvents='none' className='absolute inset-0 items-center justify-center'>
            <ActivityIndicator
              size='small'
              color={subtle}
              accessibilityLabel={`Uploading ${name}`}
            />
          </View>
        ) : null}
        {phase === 'failed' ? (
          <View pointerEvents='box-none' className='absolute inset-0 items-center justify-center'>
            <Pressable
              accessibilityRole='button'
              accessibilityLabel={`Retry upload ${name}`}
              hitSlop={TYPING_BAR_ATTACHMENT_RETRY_HIT_SLOP}
              onPressIn={() => void haptics.buttonTap()}
              onPress={handleRetry}
              className='items-center justify-center bg-spaces-negative active:opacity-60'
              style={RETRY_STYLE}
            >
              <RotateCw size={TYPING_BAR_ATTACHMENT_RETRY_ICON_SIZE} color={retryColor} />
            </Pressable>
          </View>
        ) : null}
      </View>
      {phase === 'uploading' ? null : (
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={`Remove ${name}`}
          hitSlop={TYPING_BAR_ATTACHMENT_REMOVE_HIT_SLOP}
          onPressIn={() => void haptics.buttonTap()}
          onPress={handleRemove}
          className='absolute items-center justify-center border-spaces-surface bg-spaces-foreground active:opacity-60'
          style={REMOVE_STYLE}
        >
          <X size={TYPING_BAR_ATTACHMENT_REMOVE_ICON_SIZE} color={background} />
        </Pressable>
      )}
    </Animated.View>
  );
}

export const RoomAttachmentTile = memo(RoomAttachmentTileComponent);
RoomAttachmentTile.displayName = 'RoomAttachmentTile';
