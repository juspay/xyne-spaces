/**
 * MediaListModal Component for Lotus
 *
 * Vertically scrollable list of all media in a message.
 * Opens when tapping grid items (4+ media). Tapping any item opens the viewer.
 */

import { memo, useCallback } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { X, Play } from 'lucide-react-native';
import { isVideoFile, getFileExtension } from '../message-attachments.utils';
import { API_BASE_URL } from '@/src/config';
import type { MessageAttachment } from '../message-attachments.utils';

// const SCREEN_WIDTH = Dimensions.get('window').width;
const ITEM_HEIGHT = 120;
const ITEM_GAP = 8;

interface MediaListModalProps {
  attachments: MessageAttachment[];
  onItemPress: (index: number) => void;
  onClose: () => void;
}

export const MediaListModal = memo(function MediaListModal({
  attachments,
  onItemPress,
  onClose,
}: MediaListModalProps) {
  const renderItem = useCallback(
    ({ item, index }: { item: MessageAttachment; index: number }) => {
      const isVideo = isVideoFile(item.mimetype);
      const extension = getFileExtension(item.mimetype, item.originalFilename);
      const imageUrl = `${API_BASE_URL}/attachments/${encodeURIComponent(item.id)}/download`;

      return (
        <Pressable
          onPress={() => onItemPress(index)}
          style={styles.itemContainer}
          className='flex-row items-center gap-3 bg-black/90'
        >
          {/* Thumbnail */}
          <View style={styles.thumbnailContainer}>
            <Image
              source={{ uri: item.thumbnailUrl || imageUrl }}
              style={styles.thumbnail}
              contentFit='cover'
              transition={150}
              cachePolicy='memory-disk'
              recyclingKey={item.id}
            />
            {isVideo && (
              <View style={styles.playOverlay}>
                <Play size={20} color='white' fill='white' />
              </View>
            )}
          </View>

          {/* File info */}
          <View className='flex-1 min-w-0'>
            <Text className='text-white text-sm font-medium' numberOfLines={1}>
              {item.originalFilename}
            </Text>
            <Text className='text-white/60 text-xs mt-0.5'>{extension}</Text>
          </View>
        </Pressable>
      );
    },
    [onItemPress],
  );

  const keyExtractor = useCallback((item: MessageAttachment) => item.id, []);

  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: ITEM_HEIGHT + ITEM_GAP,
      offset: (ITEM_HEIGHT + ITEM_GAP) * index,
      index,
    }),
    [],
  );

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(150)}
      style={StyleSheet.absoluteFill}
      className='bg-black/95'
    >
      {/* Header */}
      <Animated.View
        entering={SlideInDown.duration(200)}
        exiting={SlideOutDown.duration(150)}
        style={styles.header}
        className='flex-row items-center justify-between px-4'
      >
        <Text className='text-white text-lg font-semibold'>{attachments.length} attachments</Text>
        <Pressable onPress={onClose} className='p-2'>
          <X size={24} color='white' />
        </Pressable>
      </Animated.View>

      {/* List */}
      <Animated.View entering={SlideInDown.delay(50).duration(200)} style={styles.listContainer}>
        <FlatList
          data={attachments}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          getItemLayout={getItemLayout}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={{ height: ITEM_GAP }} />}
        />
      </Animated.View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  header: {
    paddingTop: 56,
    paddingBottom: 16,
  },
  listContainer: {
    flex: 1,
    paddingHorizontal: 16,
  },
  listContent: {
    paddingBottom: 40,
  },
  itemContainer: {
    height: ITEM_HEIGHT,
    borderRadius: 8,
    overflow: 'hidden',
  },
  thumbnailContainer: {
    width: 100,
    height: ITEM_HEIGHT - 16,
    borderRadius: 4,
    overflow: 'hidden',
    position: 'relative',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  playOverlay: {
    position: 'absolute',
    inset: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
});

export default MediaListModal;
