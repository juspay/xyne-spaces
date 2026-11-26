import { memo, useCallback, useMemo, type ReactElement } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableStateCallbackType,
  type ViewStyle,
} from 'react-native';
import { Image } from 'expo-image';
import { Image as ImageIcon, Play, Video } from 'lucide-react-native';

import { formatAttachmentDuration } from '@/src/features/chat/v2/components/conversation-composer/attachment-layout';
import {
  invalidateMediaPreview,
  useMediaPreviewUri,
} from '@/src/features/chat/v2/media/mediaPreviewCache';
import { useMtlsImage } from '@/src/hooks/useMtlsImage';
import { useMtlsThumbnail } from '@/src/hooks/useMtlsThumbnail';

import {
  PHOTO_CELL_EDGE_OPACITY,
  PHOTO_GRID_RADIUS,
  PHOTO_LENGTH_INSET,
  PHOTO_LENGTH_PADDING_X,
  PHOTO_LENGTH_PADDING_Y,
  PHOTO_LENGTH_RADIUS,
  PHOTO_OVERFLOW_FONT_SIZE,
  PHOTO_PLACEHOLDER_ICON_SIZE,
  PHOTO_PLAY_ICON_SIZE,
  PHOTO_PLAY_SIZE,
  PRESSED_OPACITY,
  SCRIM_COLOR,
} from '../constants';
import { mediaMetadata, photoGridLayout, type PhotoCell } from '../model/photo-grid';
import { useConversationPalette } from './conversation-palette';

/** One photo or video of a message, as the grid needs it. */
export type PhotoGridItem = {
  id: string;
  kind: 'image' | 'video';
  metadata: unknown;
};

type PhotoGridProps = {
  items: readonly PhotoGridItem[];
  /** The flat body's width; the grid never draws wider than it. */
  bodyWidth: number;
  /** False on a lite row: cells show only what is already cached, at their final size. */
  hydrate: boolean;
  /** Called with the tapped item's id, so the viewer opens on it. */
  onOpen: (attachmentId: string) => void;
};

const styles = StyleSheet.create({
  edge: {
    ...StyleSheet.absoluteFill,
    borderWidth: 1,
    opacity: PHOTO_CELL_EDGE_OPACITY,
  },
  wash: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SCRIM_COLOR,
  },
  centre: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  play: {
    width: PHOTO_PLAY_SIZE,
    height: PHOTO_PLAY_SIZE,
    borderRadius: PHOTO_PLAY_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SCRIM_COLOR,
  },
  length: {
    position: 'absolute',
    left: PHOTO_LENGTH_INSET,
    bottom: PHOTO_LENGTH_INSET,
    borderRadius: PHOTO_LENGTH_RADIUS,
    paddingHorizontal: PHOTO_LENGTH_PADDING_X,
    paddingVertical: PHOTO_LENGTH_PADDING_Y,
    backgroundColor: SCRIM_COLOR,
  },
  overflow: { fontSize: PHOTO_OVERFLOW_FONT_SIZE },
  image: { width: '100%', height: '100%' },
});

/**
 * The photos and videos of a message as one flat grid (Figma "Photos in a
 * message"). Its size comes from the layout maths alone, never from the loaded
 * pictures, so a lite row and its hydrated row are the same height.
 */
export const PhotoGrid = memo(function PhotoGrid({
  items,
  bodyWidth,
  hydrate,
  onOpen,
}: PhotoGridProps): ReactElement | null {
  const firstAspect = items[0] ? mediaMetadata(items[0].metadata).aspectRatio : null;
  const layout = useMemo(
    () => photoGridLayout(items.length, firstAspect, bodyWidth),
    [items.length, firstAspect, bodyWidth],
  );
  const frame = useMemo<ViewStyle>(
    () => ({
      width: layout.width,
      height: layout.height,
      borderRadius: PHOTO_GRID_RADIUS,
      overflow: 'hidden',
    }),
    [layout.width, layout.height],
  );

  if (layout.cells.length === 0) return null;

  return (
    <View style={frame}>
      {layout.cells.map((cell, index) => {
        const item = items[index]!;
        const isLast = index === layout.cells.length - 1;
        return (
          <PhotoGridCell
            key={item.id}
            item={item}
            cell={cell}
            position={index + 1}
            total={items.length}
            overflowCount={isLast ? layout.overflowCount : 0}
            cropFromTop={layout.cropFromTop}
            hydrate={hydrate}
            onOpen={onOpen}
          />
        );
      })}
    </View>
  );
});

type PhotoGridCellProps = {
  item: PhotoGridItem;
  cell: PhotoCell;
  position: number;
  total: number;
  overflowCount: number;
  cropFromTop: boolean;
  hydrate: boolean;
  onOpen: (attachmentId: string) => void;
};

/**
 * One photo: the full picture once the row may hydrate, before that (and while
 * it loads) the cached preview or the message's own thumbnail on the surface.
 * A video shows its poster under a play button, with its length when known.
 */
const PhotoGridCell = memo(function PhotoGridCell({
  item,
  cell,
  position,
  total,
  overflowCount,
  cropFromTop,
  hydrate,
  onOpen,
}: PhotoGridCellProps): ReactElement {
  const { muted, accentForeground: onMedia } = useConversationPalette();
  const isVideo = item.kind === 'video';
  const { uri: imageUri, error: imageError } = useMtlsImage(isVideo ? undefined : item.id, {
    enabled: hydrate,
  });
  const { uri: posterUri, error: posterError } = useMtlsThumbnail(isVideo ? item.id : undefined, {
    enabled: hydrate,
  });
  const previewUri = useMediaPreviewUri(item.id, item.kind);
  const { durationSeconds, thumbUri } = mediaMetadata(item.metadata);
  const uri = (isVideo ? posterUri : imageUri) ?? previewUri ?? thumbUri;
  const hasFailed = !uri && !!(isVideo ? posterError : imageError);

  const handlePress = useCallback((): void => onOpen(item.id), [item.id, onOpen]);
  const handleError = useCallback((): void => {
    if (previewUri && uri === previewUri) invalidateMediaPreview(item.id, item.kind, previewUri);
  }, [item.id, item.kind, previewUri, uri]);

  const cellStyle = useMemo(() => {
    const base: ViewStyle = {
      position: 'absolute',
      left: cell.left,
      top: cell.top,
      width: cell.width,
      height: cell.height,
    };
    const pressed: ViewStyle = { ...base, opacity: PRESSED_OPACITY };
    return ({ pressed: isPressed }: PressableStateCallbackType): ViewStyle =>
      isPressed ? pressed : base;
  }, [cell.left, cell.top, cell.width, cell.height]);
  const length = isVideo && durationSeconds ? formatAttachmentDuration(durationSeconds) : null;
  const noun = isVideo ? 'video' : 'photo';
  const label =
    (total > 1 ? `Open ${noun} ${position} of ${total}` : `Open ${noun}`) +
    (length ? `, ${length}` : '') +
    (overflowCount > 0 ? `, and ${overflowCount} more` : '');

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={label}
      onPress={handlePress}
      className='bg-spaces-surface'
      style={cellStyle}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={styles.image}
          contentFit='cover'
          contentPosition={cropFromTop && !isVideo ? 'top' : 'center'}
          cachePolicy='memory-disk'
          recyclingKey={item.id}
          onError={handleError}
        />
      ) : hasFailed ? (
        <View style={styles.centre}>
          {isVideo ? (
            <Video size={PHOTO_PLACEHOLDER_ICON_SIZE} color={muted} strokeWidth={1.5} />
          ) : (
            <ImageIcon size={PHOTO_PLACEHOLDER_ICON_SIZE} color={muted} strokeWidth={1.5} />
          )}
        </View>
      ) : null}
      <View pointerEvents='none' className='border-spaces-foreground' style={styles.edge} />
      {isVideo && overflowCount === 0 ? (
        <View pointerEvents='none' style={styles.centre}>
          <View style={styles.play}>
            <Play size={PHOTO_PLAY_ICON_SIZE} color={onMedia} fill={onMedia} />
          </View>
        </View>
      ) : null}
      {length && overflowCount === 0 ? (
        <View pointerEvents='none' style={styles.length}>
          <Text className='text-[13px] font-medium text-spaces-accent-foreground'>{length}</Text>
        </View>
      ) : null}
      {overflowCount > 0 ? (
        <View pointerEvents='none' style={styles.wash}>
          <Text className='font-medium text-spaces-accent-foreground' style={styles.overflow}>
            +{overflowCount}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
});
