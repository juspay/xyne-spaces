/**
 * ImageViewerModal Component for Lotus
 *
 * Full-screen modal for viewing images with carousel navigation,
 * header info, download, and n-of-m indicator.
 */

import { memo, useCallback, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { X, Download, ChevronLeft, ChevronRight, Play } from 'lucide-react-native';
import { useAttachmentViewer } from './attachment-viewer-context';
import { ImageViewerPage } from './image-viewer-page';
import { VideoViewerPage } from './video-viewer-page';
import { getFileExtension, formatFileSize, isVideoFile } from '../message-attachments.utils';
import { useImageDownload } from '@/src/hooks/useImageDownload';
import { useMtlsThumbnail } from '@/src/hooks/useMtlsThumbnail';
import type { MessageAttachment } from '../message-attachments.utils';
import { GlassSurface } from '@/src/components/ui/glass-surface';

const SCREEN_WIDTH = Dimensions.get('window').width;

const VideoSlidePlaceholder = memo(function VideoSlidePlaceholder({
  attachment,
}: {
  attachment: MessageAttachment;
}) {
  const { uri: thumbUri } = useMtlsThumbnail(attachment.id);

  return (
    <View style={styles.page} className='items-center justify-center bg-black'>
      {thumbUri ? (
        <Image
          source={{ uri: thumbUri }}
          style={StyleSheet.absoluteFill}
          cachePolicy='memory-disk'
          recyclingKey={attachment.id}
          contentFit='contain'
        />
      ) : (
        <ActivityIndicator size='large' color='#fff' />
      )}
      <View className='absolute inset-0 items-center justify-center bg-black/30'>
        <View className='h-16 w-16 items-center justify-center rounded-full bg-white/80'>
          <Play size={28} color='#000' fill='#000' />
        </View>
      </View>
    </View>
  );
});

export const ImageViewerModal = memo(function ImageViewerModal() {
  const { isOpen, attachments, currentIndex, close, goToIndex } = useAttachmentViewer();
  const { download, isDownloading } = useImageDownload();
  const scrollViewRef = useRef<ScrollView>(null);

  const current = attachments[currentIndex];

  // Scroll to current index when it changes
  useEffect(() => {
    if (isOpen && scrollViewRef.current) {
      scrollViewRef.current.scrollTo({ x: currentIndex * SCREEN_WIDTH, animated: true });
    }
  }, [currentIndex, isOpen]);

  // Hide/show status bar
  useEffect(() => {
    if (isOpen) {
      StatusBar.setHidden(true);
    } else {
      StatusBar.setHidden(false);
    }
    return () => {
      StatusBar.setHidden(false);
    };
  }, [isOpen]);

  const handleScrollEnd = useCallback(
    (event: { nativeEvent: { contentOffset: { x: number } } }) => {
      const newIndex = Math.round(event.nativeEvent.contentOffset.x / SCREEN_WIDTH);
      if (newIndex !== currentIndex && newIndex >= 0 && newIndex < attachments.length) {
        goToIndex(newIndex);
      }
    },
    [currentIndex, attachments.length, goToIndex],
  );

  const handleDownload = useCallback(() => {
    if (!current) return;
    void download(current.id, {
      filename: current.originalFilename,
      mimetype: current.mimetype,
    });
  }, [current, download]);

  if (!isOpen || attachments.length === 0) return null;

  const extension = current ? getFileExtension(current.mimetype, current.originalFilename) : '';
  const fileSize = current ? formatFileSize(current.size) : '';

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(150)}
      style={StyleSheet.absoluteFill}
      className='bg-black'
    >
      {/* Header */}
      <View style={styles.header} className='flex-row items-center justify-between px-4'>
        <View className='flex-1 min-w-0'>
          <Text className='text-white text-sm font-medium' numberOfLines={1}>
            {current?.originalFilename}
          </Text>
          <Text className='text-white/60 text-xs'>
            {extension} • {fileSize}
          </Text>
        </View>

        <View className='flex-row items-center gap-3'>
          <Pressable
            onPress={handleDownload}
            disabled={isDownloading}
            className='w-9 h-9 rounded-full bg-white items-center justify-center'
          >
            {isDownloading ? (
              <ActivityIndicator size='small' color='black' />
            ) : (
              <Download size={18} color='black' />
            )}
          </Pressable>
          <Pressable onPress={close} className='p-2'>
            <X size={22} color='white' />
          </Pressable>
        </View>
      </View>

      {/* Image carousel */}
      <View style={styles.carouselContainer}>
        <ScrollView
          ref={scrollViewRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={handleScrollEnd}
          contentContainerStyle={styles.scrollContent}
          scrollEnabled={!isVideoFile(current?.mimetype || '')} // Disable scroll for video pages
        >
          {attachments.map((attachment, index) => {
            const isVideo = isVideoFile(attachment.mimetype);
            const isSlideActive = index === currentIndex;
            return (
              <View key={attachment.id} style={styles.page}>
                {isVideo ? (
                  isSlideActive ? (
                    <VideoViewerPage attachment={attachment} isActive />
                  ) : (
                    <VideoSlidePlaceholder attachment={attachment} />
                  )
                ) : (
                  <ImageViewerPage attachment={attachment} onSwipeDown={close} />
                )}
              </View>
            );
          })}
        </ScrollView>

        {/* Navigation arrows (when multiple) */}
        {attachments.length > 1 && (
          <>
            {currentIndex > 0 && (
              <Pressable onPress={() => goToIndex(currentIndex - 1)} style={styles.navLeft}>
                <GlassSurface fallbackColor='rgba(0,0,0,0.4)' style={styles.navButton}>
                  <ChevronLeft size={28} color='white' />
                </GlassSurface>
              </Pressable>
            )}
            {currentIndex < attachments.length - 1 && (
              <Pressable onPress={() => goToIndex(currentIndex + 1)} style={styles.navRight}>
                <GlassSurface fallbackColor='rgba(0,0,0,0.4)' style={styles.navButton}>
                  <ChevronRight size={28} color='white' />
                </GlassSurface>
              </Pressable>
            )}
          </>
        )}
      </View>

      {/* Footer - n of m indicator */}
      {attachments.length > 1 && (
        <View style={styles.footer} className='items-center'>
          <Text className='text-white/70 text-sm'>
            {currentIndex + 1} of {attachments.length}
          </Text>
        </View>
      )}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  header: {
    paddingTop: 56, // Safe area + padding
    paddingBottom: 12,
  },
  carouselContainer: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  page: {
    width: SCREEN_WIDTH,
    flex: 1,
  },
  navButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navLeft: {
    position: 'absolute',
    top: '50%',
    marginTop: -24,
    left: 8,
  },
  navRight: {
    position: 'absolute',
    top: '50%',
    marginTop: -24,
    right: 8,
  },
  footer: {
    paddingBottom: 40, // Safe area + padding
    paddingTop: 12,
  },
});

export default ImageViewerModal;
