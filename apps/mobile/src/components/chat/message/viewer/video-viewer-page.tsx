import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useEvent, useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Pause, Play } from 'lucide-react-native';

import { GlassSurface } from '@/src/components/ui/glass-surface';

import type { MessageAttachment } from '../message-attachments.utils';
import { useMtlsVideoStream } from '@/src/hooks/useMtlsVideoStream';
import { safePlay } from '@/src/utils/safeVideoPlayer';

interface VideoViewerPageProps {
  attachment: MessageAttachment;
  isActive?: boolean;
}

const SCRUBBER_HEIGHT = 4;
const SCRUBBER_THUMB_SIZE = 16;
const SPRING_CONFIG = { damping: 20, stiffness: 200, mass: 0.8 };
const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;

function formatTime(milliseconds: number): string {
  const safeMs = Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export const VideoViewerPage = memo(function VideoViewerPage({
  attachment,
  isActive = true,
}: VideoViewerPageProps) {
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const {
    streamUrl,
    isReady: proxyReady,
    isLoading: isStreamLoading,
    error: streamError,
  } = useMtlsVideoStream(attachment.id, { enabled: isActive });

  const [showControls, setShowControls] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [durationMs, setDurationMs] = useState(0);
  const [positionOverrideMs, setPositionOverrideMs] = useState<number | null>(null);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldAutoPlayRef = useRef(false);
  const loadedStreamUrlRef = useRef<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

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

  useEffect(() => {
    if (streamError) {
      setErrorMessage(streamError.message);
    }
  }, [streamError]);

  useEffect(
    (): (() => void) => () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    },
    [],
  );

  const player = useVideoPlayer(null, p => {
    p.loop = false;
    p.muted = false;
    p.timeUpdateEventInterval = 0.2;
  });
  const playerRef = useRef(player);
  playerRef.current = player;

  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const statusEvent = useEvent(player, 'statusChange');
  const playerStatus = statusEvent?.status ?? player.status;
  const playerErrorMessage = statusEvent?.error?.message;
  const { currentTime } = useEvent(player, 'timeUpdate', {
    currentTime: player.currentTime,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
    bufferedPosition: 0,
  });

  useEventListener(player, 'sourceLoad', payload => {
    setDurationMs(Math.max(0, Math.round(payload.duration * 1000)));
  });

  useEventListener(player, 'statusChange', payload => {
    if (payload.status === 'readyToPlay') {
      setHasLoaded(true);
    }
    if (payload.status === 'readyToPlay' && isActive && shouldAutoPlayRef.current) {
      shouldAutoPlayRef.current = false;
      safePlay(playerRef.current);
    }
  });

  useEffect(() => {
    if (playerStatus === 'error') {
      setErrorMessage(playerErrorMessage || 'Failed to load video');
      return;
    }
    if (playerStatus === 'readyToPlay') {
      setErrorMessage('');
    }
  }, [playerErrorMessage, playerStatus]);

  useEffect(() => {
    let cancelled = false;

    if (!streamUrl || !isActive) {
      shouldAutoPlayRef.current = false;
      loadedStreamUrlRef.current = null;
      setHasLoaded(false);
      return;
    }

    if (loadedStreamUrlRef.current === streamUrl) {
      return;
    }

    setErrorMessage('');
    setPositionOverrideMs(null);
    setDurationMs(0);
    loadedStreamUrlRef.current = streamUrl;
    shouldAutoPlayRef.current = true;

    void playerRef.current
      .replaceAsync({ uri: streamUrl, contentType: 'progressive' })
      .then(() => {
        if (cancelled) return;
        if (playerRef.current.status === 'readyToPlay') {
          shouldAutoPlayRef.current = false;
          safePlay(playerRef.current);
        }
      })
      .catch(err => {
        if (cancelled) return;
        shouldAutoPlayRef.current = false;
        loadedStreamUrlRef.current = null;
        setErrorMessage(err instanceof Error ? err.message : 'Failed to load video');
      });

    return (): void => {
      cancelled = true;
      shouldAutoPlayRef.current = false;
    };
  }, [streamUrl, isActive, attachment.id]);

  const hideControlsAfterDelay = useCallback((): void => {
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      if (player.playing) {
        setShowControls(false);
      }
    }, 3000);
  }, [player]);

  useEffect(() => {
    if (isPlaying) {
      hideControlsAfterDelay();
    } else if (!isPlaying && hasLoaded) {
      setShowControls(true);
    }
  }, [hideControlsAfterDelay, isPlaying, hasLoaded]);

  const toggleControls = useCallback((): void => {
    setShowControls(prev => {
      const next = !prev;
      if (next) hideControlsAfterDelay();
      return next;
    });
  }, [hideControlsAfterDelay]);

  const togglePlayPause = useCallback((): void => {
    if (player.playing) {
      player.pause();
      return;
    }
    const atEnd =
      durationMs > 0 &&
      (positionOverrideMs ?? Math.round(player.currentTime * 1000)) >= durationMs - 500;
    if (atEnd) {
      player.currentTime = 0;
      setPositionOverrideMs(null);
    }
    player.play();
    setShowControls(true);
  }, [player, durationMs, positionOverrideMs]);

  const seekTo = useCallback(
    (milliseconds: number): void => {
      const safeMs = Math.max(0, milliseconds);
      player.currentTime = safeMs / 1000;
      setPositionOverrideMs(null);
    },
    [player],
  );

  const playbackPositionMs = Math.max(0, Math.round(currentTime * 1000));
  const currentPositionMs = positionOverrideMs ?? playbackPositionMs;
  const hasError = errorMessage.length > 0;
  const isLoading = isStreamLoading || !proxyReady || (isActive && !hasLoaded && !hasError);

  const progress = durationMs > 0 ? currentPositionMs / durationMs : 0;
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const scrubberWidth = measuredWidth > 0 ? measuredWidth : viewportWidth - 152;
  const thumbPosition = useSharedValue(0);
  const isDragging = useSharedValue(false);
  const startThumbX = useSharedValue(0);
  const scrubberWidthSV = useSharedValue(scrubberWidth);

  useEffect(() => {
    scrubberWidthSV.value = scrubberWidth;
  }, [scrubberWidth, scrubberWidthSV]);

  useEffect(() => {
    if (!isDragging.value) {
      thumbPosition.value = progress * scrubberWidthSV.value;
    }
  }, [progress, isDragging.value, scrubberWidthSV.value, thumbPosition]);

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

  const videoPanGesture = Gesture.Pan()
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

  const singleTapGesture = Gesture.Tap().onEnd(() => {
    'worklet';
    runOnJS(toggleControls)();
  });

  const tapGestures = Gesture.Exclusive(doubleTapGesture, singleTapGesture);

  const videoGestures = Gesture.Simultaneous(
    tapGestures,
    Gesture.Simultaneous(pinchGesture, videoPanGesture),
  );

  const scrubberPanGesture = Gesture.Pan()
    .onBegin(() => {
      'worklet';
      isDragging.value = true;
      startThumbX.value = thumbPosition.value;
    })
    .onUpdate(event => {
      'worklet';
      const rawX = startThumbX.value + event.translationX;
      const clampedX = Math.max(0, Math.min(rawX, scrubberWidthSV.value));
      thumbPosition.value = clampedX;
      const newProgress = scrubberWidthSV.value > 0 ? clampedX / scrubberWidthSV.value : 0;
      runOnJS(setPositionOverrideMs)(newProgress * durationMs);
    })
    .onEnd(() => {
      'worklet';
      isDragging.value = false;
      const seekMs =
        scrubberWidthSV.value > 0 ? (thumbPosition.value / scrubberWidthSV.value) * durationMs : 0;
      runOnJS(seekTo)(seekMs);
    });

  const thumbAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: thumbPosition.value }],
  }));

  const progressWidthStyle = useAnimatedStyle(() => ({
    width: thumbPosition.value + SCRUBBER_THUMB_SIZE / 2,
  }));

  const videoAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  if (hasError) {
    return (
      <View style={styles.container}>
        <View style={styles.errorContainer}>
          <Play size={48} color='white' />
          <Text style={styles.errorText}>Failed to load video</Text>
          <Text style={styles.errorDetails}>{errorMessage.substring(0, 100)}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator />
          <Text style={styles.loadingText}>{proxyReady ? 'Loading...' : 'Initializing...'}</Text>
        </View>
      )}

      {isActive && (
        <GestureDetector gesture={videoGestures}>
          <Animated.View
            style={[styles.videoContainer, videoAnimatedStyle]}
            renderToHardwareTextureAndroid
            shouldRasterizeIOS
          >
            <VideoView
              player={player}
              style={styles.video}
              contentFit='contain'
              fullscreenOptions={{ enable: true }}
              allowsPictureInPicture
            />
          </Animated.View>
        </GestureDetector>
      )}

      {!isLoading && showControls && (
        <View style={styles.controlsOverlay}>
          <Pressable style={styles.centerButtonContainer} onPress={togglePlayPause}>
            <GlassSurface fallbackColor='rgba(0,0,0,0.5)' style={styles.playButton}>
              {isPlaying ? (
                <Pause size={40} color='white' />
              ) : (
                <Play size={40} color='white' fill='white' />
              )}
            </GlassSurface>
          </Pressable>

          <View style={styles.bottomControls}>
            <Text style={styles.timeText}>{formatTime(currentPositionMs)}</Text>

            <View
              style={styles.scrubberContainer}
              onLayout={event => {
                const { width } = event.nativeEvent.layout;
                setMeasuredWidth(width);
              }}
            >
              <View style={styles.scrubberTrack} />
              <Animated.View style={[styles.scrubberFill, progressWidthStyle]} />
              <GestureDetector gesture={scrubberPanGesture}>
                <Animated.View style={[styles.scrubberThumb, thumbAnimatedStyle]}>
                  <View style={styles.thumbInner} />
                </Animated.View>
              </GestureDetector>
            </View>

            <Text style={styles.timeText}>{formatTime(durationMs)}</Text>
          </View>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'black',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  videoContainer: {
    width: '100%',
    height: '100%',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    zIndex: 10,
  },
  loadingText: {
    color: 'white',
    marginTop: 12,
    fontSize: 14,
  },
  controlsOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  centerButtonContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bottomControls: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 24,
    paddingTop: 12,
    gap: 12,
  },
  timeText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '500',
    minWidth: 40,
    textAlign: 'center',
  },
  scrubberContainer: {
    flex: 1,
    height: SCRUBBER_HEIGHT + 20,
    justifyContent: 'center',
    marginHorizontal: 4,
  },
  scrubberTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: SCRUBBER_HEIGHT,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: SCRUBBER_HEIGHT / 2,
  },
  scrubberFill: {
    position: 'absolute',
    left: 0,
    height: SCRUBBER_HEIGHT,
    backgroundColor: 'white',
    borderRadius: SCRUBBER_HEIGHT / 2,
  },
  scrubberThumb: {
    position: 'absolute',
    left: 0,
    width: SCRUBBER_THUMB_SIZE,
    height: SCRUBBER_THUMB_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: -SCRUBBER_THUMB_SIZE / 2,
  },
  thumbInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: 'white',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: 'white',
    marginTop: 12,
    fontSize: 14,
    opacity: 0.8,
  },
  errorDetails: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    marginTop: 8,
  },
});
