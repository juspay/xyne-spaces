import { useEffect, useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, Platform, Text, View, useWindowDimensions } from 'react-native';
import { useEvent, useEventListener } from 'expo';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { useMtlsThumbnail } from '@/src/hooks/useMtlsThumbnail';
import { useMtlsVideoStream } from '@/src/hooks/useMtlsVideoStream';
import type { AttachmentsViewerItem } from '@/src/machines/attachmentsMachine';
import { safePlay } from '@/src/utils/safeVideoPlayer';

type VideoPageProps = {
  attachment: AttachmentsViewerItem;
  isActive?: boolean;
};

const SPRING_CONFIG = { damping: 20, stiffness: 200, mass: 0.8 };
const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;

const VideoPage = ({ attachment, isActive = true }: VideoPageProps): ReactElement => {
  const { uri: thumbUri } = useMtlsThumbnail(attachment.id);
  const {
    streamUrl,
    isLoading: isStreamLoading,
    error: streamError,
  } = useMtlsVideoStream(attachment.id, { enabled: isActive });
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const clampValue = (value: number, min: number, max: number): number => {
    'worklet';
    return Math.max(min, Math.min(max, value));
  };

  const clampTranslate = (value: number, size: number, currentScale: number): number => {
    'worklet';
    if (currentScale <= MIN_SCALE) return 0;
    const maxTranslate = (size * currentScale - size) / 2;
    return clampValue(value, -maxTranslate, maxTranslate);
  };

  const player = useVideoPlayer(
    isActive && streamUrl ? { uri: streamUrl, contentType: 'progressive' } : null,
    p => {
      p.loop = false;
      p.muted = false;
    },
  );
  const playerRef = useRef(player);
  playerRef.current = player;

  const statusEvent = useEvent(player, 'statusChange');
  const playerStatus = statusEvent?.status ?? player.status;
  const playerErrorMessage = statusEvent?.error?.message;

  useEffect(() => {
    setHasLoaded(false);
    setLoadError(null);
  }, [streamUrl, attachment.id]);

  useEventListener(player, 'statusChange', payload => {
    if (payload.status === 'readyToPlay') {
      setHasLoaded(true);
      if (isActiveRef.current) {
        safePlay(playerRef.current);
      }
    }
    if (payload.status === 'error') {
      setLoadError(payload.error?.message ?? 'Failed to load video');
    }
  });

  const pinchGesture = Gesture.Pinch()
    .onUpdate(event => {
      'worklet';
      const nextScale = clampValue(savedScale.value * event.scale, MIN_SCALE, MAX_SCALE);
      const scaleFactor = nextScale / scale.value;
      const focalX = event.focalX - viewportWidth / 2;
      const focalY = event.focalY - viewportHeight / 2;

      const nextTranslateX = focalX * (1 - scaleFactor) + translateX.value * scaleFactor;
      const nextTranslateY = focalY * (1 - scaleFactor) + translateY.value * scaleFactor;

      translateX.value = clampTranslate(nextTranslateX, viewportWidth, nextScale);
      translateY.value = clampTranslate(nextTranslateY, viewportHeight, nextScale);
      scale.value = nextScale;
    })
    .onEnd(() => {
      'worklet';
      if (scale.value <= MIN_SCALE + 0.001) {
        scale.value = withSpring(MIN_SCALE, SPRING_CONFIG);
        savedScale.value = MIN_SCALE;
        translateX.value = withSpring(0, SPRING_CONFIG);
        translateY.value = withSpring(0, SPRING_CONFIG);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
        return;
      }

      const clampedX = clampTranslate(translateX.value, viewportWidth, scale.value);
      const clampedY = clampTranslate(translateY.value, viewportHeight, scale.value);
      translateX.value = withSpring(clampedX, SPRING_CONFIG);
      translateY.value = withSpring(clampedY, SPRING_CONFIG);
      savedTranslateX.value = clampedX;
      savedTranslateY.value = clampedY;
      savedScale.value = scale.value;
    });

  const panGesture = Gesture.Pan()
    .manualActivation(true)
    .onTouchesMove((_event, state) => {
      'worklet';
      if (scale.value > 1.05) {
        state.activate();
      } else {
        state.fail();
      }
    })
    .onBegin(() => {
      'worklet';
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    })
    .onUpdate(event => {
      'worklet';
      const nextX = savedTranslateX.value + event.translationX;
      const nextY = savedTranslateY.value + event.translationY;
      translateX.value = clampTranslate(nextX, viewportWidth, scale.value);
      translateY.value = clampTranslate(nextY, viewportHeight, scale.value);
    })
    .onEnd(() => {
      'worklet';
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(event => {
      'worklet';
      if (scale.value > 1.05) {
        scale.value = withSpring(MIN_SCALE, SPRING_CONFIG);
        savedScale.value = MIN_SCALE;
        translateX.value = withSpring(0, SPRING_CONFIG);
        translateY.value = withSpring(0, SPRING_CONFIG);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      } else {
        const focalX = event.x - viewportWidth / 2;
        const focalY = event.y - viewportHeight / 2;
        const targetTranslateX = clampTranslate(
          -focalX * (DOUBLE_TAP_SCALE - MIN_SCALE),
          viewportWidth,
          DOUBLE_TAP_SCALE,
        );
        const targetTranslateY = clampTranslate(
          -focalY * (DOUBLE_TAP_SCALE - MIN_SCALE),
          viewportHeight,
          DOUBLE_TAP_SCALE,
        );

        scale.value = withSpring(DOUBLE_TAP_SCALE, SPRING_CONFIG);
        savedScale.value = DOUBLE_TAP_SCALE;
        translateX.value = withSpring(targetTranslateX, SPRING_CONFIG);
        translateY.value = withSpring(targetTranslateY, SPRING_CONFIG);
        savedTranslateX.value = targetTranslateX;
        savedTranslateY.value = targetTranslateY;
      }
    });

  const composedGesture = Gesture.Simultaneous(
    doubleTapGesture,
    Gesture.Simultaneous(pinchGesture, panGesture),
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const isInitialLoading =
    isStreamLoading || (Boolean(streamUrl) && !hasLoaded && playerStatus !== 'error');
  const showThumbnailOverlay = isActive && isInitialLoading && !streamError && !playerErrorMessage;
  const showSpinner = isActive && isInitialLoading && !streamError;
  const errorMessage = streamError?.message ?? loadError ?? playerErrorMessage ?? null;

  if (!isActive) {
    return (
      <View className='flex-1 items-center justify-center bg-black'>
        {thumbUri ? (
          <Image
            source={{ uri: thumbUri }}
            style={{ width: '100%', height: '100%' }}
            cachePolicy='memory-disk'
            recyclingKey={attachment.id}
            contentFit='contain'
          />
        ) : null}
      </View>
    );
  }

  const videoView = (
    <VideoView
      player={player}
      style={{ width: '100%', height: '100%' }}
      contentFit='contain'
      fullscreenOptions={{ enable: true }}
      allowsPictureInPicture
      nativeControls
      {...(Platform.OS === 'android' ? { surfaceType: 'textureView' as const } : {})}
    />
  );

  const overlays = (
    <>
      {showThumbnailOverlay && thumbUri ? (
        <Image
          source={{ uri: thumbUri }}
          style={{ position: 'absolute', width: '100%', height: '100%' }}
          cachePolicy='memory-disk'
          recyclingKey={attachment.id}
          contentFit='contain'
        />
      ) : null}

      {showSpinner ? (
        <View className='absolute inset-0 items-center justify-center'>
          <View className='w-16 h-16 rounded-full bg-black/50 items-center justify-center'>
            <ActivityIndicator size='large' color='#fff' />
          </View>
        </View>
      ) : null}

      {errorMessage ? (
        <View className='absolute inset-0 items-center justify-center bg-black/80 px-6'>
          <Text className='text-center text-sm text-white'>Failed to load video</Text>
          <Text className='mt-2 text-center text-xs text-white/70'>{errorMessage}</Text>
        </View>
      ) : null}
    </>
  );

  // Android: keep VideoView out of transformed / hardware-textured parents.
  // SurfaceView inside a paging FlatList + GestureDetector is a black screen, and
  // the gesture wrapper also steals native control taps.
  if (Platform.OS === 'android') {
    return (
      <View className='flex-1 bg-black items-center justify-center'>
        {videoView}
        {overlays}
      </View>
    );
  }

  return (
    <GestureDetector gesture={composedGesture}>
      <Animated.View
        className='flex-1 bg-black items-center justify-center'
        style={animatedStyle}
        shouldRasterizeIOS
      >
        {videoView}
        {overlays}
      </Animated.View>
    </GestureDetector>
  );
};

export { VideoPage };
