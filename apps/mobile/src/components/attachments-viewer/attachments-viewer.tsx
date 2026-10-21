import { useCallback, useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StatusBar,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Download, RotateCwSquare } from 'lucide-react-native';
import { useRawSafeAreaInsets } from '@/src/hooks/useRawSafeAreaInsets';
import { useSelector } from '@xstate/react';

import { attachmentsActor, type AttachmentsViewerItem } from '@/src/machines/attachmentsMachine';
import { ImagePage } from './pages/image-page';
import { VideoPage } from './pages/video-page';
import { FilePage } from './pages/file-page';
import { getAttachmentFileCategory, type AttachmentFileCategory } from './utils/file-viewer';
import { usePersistentAttachmentDownload } from '@/src/hooks/usePersistentAttachmentDownload';
import { formatFileSize } from '@/src/components/chat/message/message-attachments.utils';
import { cn } from '@/src/utils/cn';
import { useAttachmentsViewerOrientation } from './useAttachmentsViewerOrientation';
import { HeaderBackButton, HeaderIconButton } from '@/src/components/ui/header-icon-button';

type AttachmentsViewerProps = {
  onClose: () => void;
};

const HEADER_CONTENT_HEIGHT = 56;

const isFileCategory = (category: AttachmentFileCategory): boolean =>
  category !== 'image' && category !== 'video';

const categoryLabel = (category: AttachmentFileCategory): string =>
  category === 'pdf' ? 'PDF' : category.toUpperCase();

const ViewerIconButton = ({
  onPress,
  busy = false,
  accessibilityLabel,
  children,
}: {
  onPress: () => void;
  busy?: boolean;
  accessibilityLabel: string;
  children: ReactNode;
}): ReactElement => (
  <HeaderIconButton
    liquidGlass
    onPress={onPress}
    disabled={busy}
    accessibilityLabel={accessibilityLabel}
  >
    {busy ? <ActivityIndicator size='small' color='#fff' /> : children}
  </HeaderIconButton>
);

const AttachmentsViewer = ({ onClose }: AttachmentsViewerProps): ReactElement => {
  const insets = useRawSafeAreaInsets();
  const { width } = useWindowDimensions();
  const flatListRef = useRef<FlatList<AttachmentsViewerItem>>(null);
  const { download: startPersistentDownload, isStarting: isDownloading } =
    usePersistentAttachmentDownload();

  const { toggleOrientation } = useAttachmentsViewerOrientation();

  const attachments = useSelector(attachmentsActor, state => state.context.attachments);
  const currentIndex = useSelector(attachmentsActor, state => state.context.currentIndex);
  const currentIndexRef = useRef(currentIndex);
  currentIndexRef.current = currentIndex;

  const currentAttachment = attachments[currentIndex];
  const currentCategory = currentAttachment
    ? getAttachmentFileCategory(currentAttachment.mimetype, currentAttachment.originalFilename)
    : 'unsupported';

  const downloadCurrent = useCallback(async (): Promise<void> => {
    if (!currentAttachment || isDownloading) return;
    await startPersistentDownload(
      currentAttachment.id,
      currentAttachment.originalFilename,
      currentAttachment.mimetype,
    );
  }, [currentAttachment, isDownloading, startPersistentDownload]);

  useEffect(() => {
    flatListRef.current?.scrollToOffset({
      offset: width * currentIndexRef.current,
      animated: false,
    });
  }, [width]);

  const onMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(e.nativeEvent.contentOffset.x / width);
      if (next !== currentIndex) {
        attachmentsActor.send({ type: 'SET_INDEX', index: next });
      }
    },
    [width, currentIndex],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: AttachmentsViewerItem; index: number }): ReactElement => {
      const category = getAttachmentFileCategory(item.mimetype, item.originalFilename);
      const isActive = index === currentIndex;
      // File pages sit below the solid header; media stays edge-to-edge.
      const paddingTop = isFileCategory(category) ? insets.top + HEADER_CONTENT_HEIGHT : 0;
      return (
        <View style={{ width, paddingTop }}>
          {category === 'image' ? (
            <ImagePage attachment={item} />
          ) : category === 'video' ? (
            <VideoPage attachment={item} isActive={isActive} />
          ) : (
            <FilePage attachment={item} />
          )}
        </View>
      );
    },
    [width, insets.top, currentIndex],
  );

  const keyExtractor = useCallback((item: AttachmentsViewerItem) => item.id, []);

  const isFile = isFileCategory(currentCategory);
  const sizeLabel = currentAttachment?.size ? formatFileSize(currentAttachment.size) : '';

  return (
    <View className='flex-1 bg-black'>
      {/* Dark surface in both themes (standard for media/PDF), so pin light
          status-bar icons; RN's StatusBar reverts to the app theme on unmount. */}
      <StatusBar barStyle='light-content' />

      <FlatList
        ref={flatListRef}
        data={attachments}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={currentIndex}
        extraData={currentIndex}
        windowSize={3}
        maxToRenderPerBatch={1}
        getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        onMomentumScrollEnd={onMomentumScrollEnd}
      />

      <View
        className={cn(
          'absolute left-0 right-0 flex-row items-center gap-2 px-3',
          isFile && 'border-b border-white/10 bg-black/95',
        )}
        style={{ paddingTop: insets.top + 6, paddingBottom: 10 }}
      >
        <HeaderBackButton
          liquidGlass
          onPress={onClose}
          accessibilityLabel='Close'
          iconColor='#fff'
        />

        <View className='min-w-0 flex-1'>
          {isFile ? (
            <>
              <Text className='text-[15px] font-semibold text-white' numberOfLines={1}>
                {currentAttachment?.originalFilename ?? 'Attachment'}
              </Text>
              <Text className='text-xs text-white/55' numberOfLines={1}>
                {[categoryLabel(currentCategory), sizeLabel].filter(Boolean).join(' · ')}
              </Text>
            </>
          ) : attachments.length > 1 ? (
            <Text className='text-center text-xs font-medium text-white'>
              {currentIndex + 1} / {attachments.length}
            </Text>
          ) : null}
        </View>

        {!isFile ? (
          <ViewerIconButton onPress={toggleOrientation} accessibilityLabel='Rotate screen'>
            <RotateCwSquare size={20} color='#fff' />
          </ViewerIconButton>
        ) : null}

        <ViewerIconButton
          onPress={() => void downloadCurrent()}
          busy={isDownloading}
          accessibilityLabel='Save to device'
        >
          <Download size={20} color='#fff' />
        </ViewerIconButton>
      </View>
    </View>
  );
};

export { AttachmentsViewer };
