import { useEffect, useState, type ReactElement } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { FileText, Play, Headphones, X } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';
import { Image } from 'expo-image';
import { File, Paths } from 'expo-file-system';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import FileViewer from 'react-native-file-viewer';
import { v4 as uuid } from 'uuid';
import { API_BASE_URL } from '@/src/config';
import { cacheMtlsRemoteFile, discardCachedFile } from '@/src/utils/mtlsDiskCache';
import { getAuthSessionGeneration } from '@/src/services/authSessionLifecycle';
import { feedError, feedPath } from './api';
import type { FeedMedia } from './types';

function Video({ uri }: { uri: string }): ReactElement {
  const player = useVideoPlayer(uri);
  return (
    <VideoView
      player={player}
      style={{ width: '100%', height: 280 }}
      nativeControls
      contentFit='contain'
    />
  );
}
function Audio({ uri }: { uri: string }): ReactElement {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  return (
    <Pressable
      accessibilityRole='button'
      onPress={() => {
        if (status.playing) player.pause();
        else player.play();
      }}
      className='p-4'
    >
      <Text className='text-foreground'>{status.playing ? 'Pause audio' : 'Play audio'}</Text>
    </Pressable>
  );
}
function MediaItem({
  media,
  workspaceId,
  source,
  width,
}: {
  media: FeedMedia;
  workspaceId: string;
  source: boolean;
  width: number;
}): ReactElement {
  const color = useCSSVariable('--color-foreground') as string;
  const image = media.mimetype.startsWith('image/');
  const [requested, setRequested] = useState(image);
  const [retry, setRetry] = useState(0);
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  useEffect((): (() => void) | undefined => {
    if (!requested) return;
    let cancelled = false;
    const generation = getAuthSessionGeneration();
    const extension = media.filename.match(/\.[a-zA-Z0-9]{1,8}$/)?.[0] ?? '';
    const file = new File(Paths.cache, 'feed-preview', `${uuid()}${extension}`);
    const path = source
      ? `/attachments/${encodeURIComponent(media.id)}/download`
      : feedPath(workspaceId, `/media/${encodeURIComponent(media.id)}`);
    setError(null);
    void cacheMtlsRemoteFile({ url: `${API_BASE_URL}${path}`, localPath: file.uri })
      .then(value => {
        if (cancelled || generation !== getAuthSessionGeneration()) {
          discardCachedFile(value);
          return;
        }
        setUri(value);
      })
      .catch(reason => {
        if (!cancelled) setError(feedError(reason));
      });
    return () => {
      cancelled = true;
      discardCachedFile(file.uri);
    };
  }, [media.id, media.filename, workspaceId, source, requested, retry]);
  const open = (): void => {
    if (uri)
      void FileViewer.open(uri, { showOpenWithDialog: true }).catch(reason =>
        Alert.alert('Cannot open file', feedError(reason)),
      );
  };
  return (
    <View
      className='overflow-hidden bg-secondary'
      style={{ width, minHeight: image || media.mimetype.startsWith('video/') ? width : 100 }}
    >
      {error ? (
        <Pressable
          accessibilityRole='button'
          onPress={() => setRetry(value => value + 1)}
          className='p-5'
        >
          <Text className='text-foreground'>Could not load {media.filename}. Tap to retry.</Text>
        </Pressable>
      ) : !requested ? (
        <Pressable
          accessibilityRole='button'
          onPress={() => setRequested(true)}
          className='flex-1 items-center justify-center gap-3 p-6'
        >
          <View className='h-14 w-14 items-center justify-center rounded-full bg-card'>
            {media.mimetype.startsWith('video/') ? (
              <Play size={24} color={color} />
            ) : media.mimetype.startsWith('audio/') ? (
              <Headphones size={24} color={color} />
            ) : (
              <FileText size={24} color={color} />
            )}
          </View>
          <Text className='font-semibold text-foreground'>
            {media.mimetype.startsWith('video/')
              ? 'Play video'
              : media.mimetype.startsWith('audio/')
                ? 'Listen to audio'
                : 'Open attachment'}
          </Text>
          <Text className='text-center text-xs text-secondary-foreground'>
            {media.filename} · {(media.size / 1024 / 1024).toFixed(1)} MB
          </Text>
        </Pressable>
      ) : !uri ? (
        <View
          style={{ minHeight: image ? width : 100, alignItems: 'center', justifyContent: 'center' }}
        >
          <ActivityIndicator color={color} />
        </View>
      ) : image ? (
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={`Open ${media.filename}`}
          onPress={() => setFull(true)}
        >
          <Image
            source={{ uri }}
            style={{ width, height: width }}
            contentFit='contain'
            accessibilityLabel={media.filename}
          />
        </Pressable>
      ) : media.mimetype.startsWith('video/') ? (
        <Video uri={uri} />
      ) : media.mimetype.startsWith('audio/') ? (
        <Audio uri={uri} />
      ) : (
        <Pressable accessibilityRole='button' onPress={open} className='p-5'>
          <Text className='text-foreground'>Open {media.filename}</Text>
        </Pressable>
      )}
      <Modal visible={full} onRequestClose={() => setFull(false)} animationType='fade'>
        <View style={{ flex: 1, backgroundColor: '#000', paddingTop: 60, paddingBottom: 40 }}>
          <Pressable
            accessibilityRole='button'
            onPress={() => setFull(false)}
            accessibilityLabel='Close image'
            style={{ padding: 20 }}
          >
            <X color='white' size={24} />
          </Pressable>
          <ScrollView
            maximumZoomScale={4}
            minimumZoomScale={1}
            contentContainerStyle={{ flexGrow: 1 }}
          >
            <Image
              source={{ uri: uri ?? '' }}
              style={{ flex: 1, minHeight: 450 }}
              contentFit='contain'
            />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}
export function FeedMediaStrip({
  media,
  workspaceId,
  source = false,
}: {
  media: FeedMedia[];
  workspaceId: string;
  source?: boolean;
}): ReactElement | null {
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState(0);
  if (!media.length) return null;
  return (
    <View className='mb-3' onLayout={event => setWidth(event.nativeEvent.layout.width)}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        pagingEnabled
        onMomentumScrollEnd={event => {
          if (width) setActive(Math.round(event.nativeEvent.contentOffset.x / width));
        }}
        snapToInterval={width || undefined}
        decelerationRate='fast'
      >
        {width > 0 &&
          media.map(item => (
            <MediaItem
              key={item.id}
              media={item}
              workspaceId={workspaceId}
              source={source}
              width={width}
            />
          ))}
      </ScrollView>
      {media.length > 1 ? (
        <View
          className='mt-3 flex-row items-center justify-center gap-1.5'
          accessibilityLabel={`Attachment ${Math.min(active + 1, media.length)} of ${media.length}`}
        >
          {media.map((item, index) => (
            <View
              key={item.id}
              className={
                index === active
                  ? 'h-1.5 w-4 rounded-full bg-brand'
                  : 'h-1.5 w-1.5 rounded-full bg-border'
              }
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
