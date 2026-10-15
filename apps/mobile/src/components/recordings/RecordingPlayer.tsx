// ---------------------------------------------------------------------------
// RecordingPlayer
// One transport UI (PlayerShell) over two backends: expo-audio for
// AUDIO_ONLY, which keeps silent-mode playback, and expo-video otherwise.
// Showing/hiding the video is just the surface — same player underneath, so
// playback never stops and there is no position to sync.
// ---------------------------------------------------------------------------

import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, PanResponder, Platform, Pressable, Text, View } from 'react-native';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEvent, useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { AlertTriangle, Maximize, Pause, Play, Video, VideoOff } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { formatElapsedTime } from '@/src/utils/recordingUtils';
import type { RecordingType } from '@/src/types/recordings';

const PLAYBACK_RATES = [1, 1.2, 1.5, 2] as const;

interface RecordingPlayerProps {
  uri: string;
  recordingType?: RecordingType | null | undefined;
}

export function RecordingPlayer({ uri, recordingType }: RecordingPlayerProps): ReactElement {
  return recordingType && recordingType !== 'AUDIO_ONLY' ? (
    <VideoBackedPlayer uri={uri} />
  ) : (
    <AudioBackedPlayer uri={uri} />
  );
}

function AudioBackedPlayer({ uri }: { uri: string }): ReactElement {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);

  useEffect(() => {
    void setAudioModeAsync({ playsInSilentMode: true });
  }, []);

  // Auto-reset on playback completion
  useEffect(() => {
    if (status.didJustFinish) {
      player.pause();
      void player.seekTo(0);
    }
  }, [player, status.didJustFinish]);

  const handlePlayPause = useCallback((): void => {
    if (status.playing) player.pause();
    else player.play();
  }, [player, status.playing]);

  const handleSeek = useCallback((ms: number): Promise<void> => player.seekTo(ms / 1000), [player]);

  const handleRate = useCallback((next: number): void => player.setPlaybackRate(next), [player]);

  return (
    <PlayerShell
      status={status.error ? 'error' : status.isLoaded ? 'ready' : 'loading'}
      isPlaying={status.playing}
      positionMs={status.currentTime * 1000}
      durationMs={status.duration * 1000}
      onPlayPause={handlePlayPause}
      onSeek={handleSeek}
      onRate={handleRate}
    />
  );
}

function VideoBackedPlayer({ uri }: { uri: string }): ReactElement {
  const viewRef = useRef<VideoView>(null);
  const player = useVideoPlayer(uri, p => {
    p.loop = false;
    p.timeUpdateEventInterval = 0.25;
  });
  const [durationMs, setDurationMs] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [hasError, setHasError] = useState(false);

  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const { currentTime } = useEvent(player, 'timeUpdate', {
    currentTime: player.currentTime,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
    bufferedPosition: 0,
  });

  useEventListener(player, 'sourceLoad', payload => {
    setDurationMs(Math.max(0, payload.duration * 1000));
  });

  useEventListener(player, 'statusChange', payload => {
    if (payload.status === 'readyToPlay') {
      setIsReady(true);
      setHasError(false);
    }
    if (payload.status === 'error') {
      setHasError(true);
    }
  });

  // Same auto-reset the audio backend does on completion.
  useEventListener(player, 'playToEnd', () => {
    player.currentTime = 0;
  });

  const handlePlayPause = useCallback((): void => {
    if (player.playing) player.pause();
    else player.play();
  }, [player]);

  const handleSeek = useCallback(
    (ms: number): void => {
      player.currentTime = ms / 1000;
    },
    [player],
  );

  const handleRate = useCallback(
    (next: number): void => {
      player.playbackRate = next;
    },
    [player],
  );

  return (
    <PlayerShell
      status={hasError ? 'error' : isReady ? 'ready' : 'loading'}
      isPlaying={isPlaying}
      positionMs={currentTime * 1000}
      durationMs={durationMs}
      onPlayPause={handlePlayPause}
      onSeek={handleSeek}
      onRate={handleRate}
      video={{
        onFullscreen: () => void viewRef.current?.enterFullscreen(),
        surface: (
          <VideoView
            ref={viewRef}
            player={player}
            style={{ width: '100%', height: '100%' }}
            contentFit='contain'
            nativeControls={false}
            fullscreenOptions={{ enable: true }}
            {...(Platform.OS === 'android' ? { surfaceType: 'textureView' as const } : {})}
          />
        ),
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// PlayerShell — the entire UI, backend-agnostic.
// ---------------------------------------------------------------------------

interface PlayerShellProps {
  status: 'loading' | 'ready' | 'error';
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  onPlayPause: () => void;
  onSeek: (ms: number) => void | Promise<void>;
  onRate: (rate: number) => void;
  /** Present only for recordings with a video track. */
  video?: { surface: ReactElement; onFullscreen: () => void } | undefined;
}

function PlayerShell({
  status,
  isPlaying,
  positionMs,
  durationMs,
  onPlayPause,
  onSeek,
  onRate,
  video,
}: PlayerShellProps): ReactElement {
  const borderColor = useCSSVariable('--color-border') as string;
  const mutedColor = useCSSVariable('--color-secondary-foreground') as string;
  const { accentBg, accentFg } = useBubbleAccent();

  const [showVideo, setShowVideo] = useState(true);
  const [scrubMs, setScrubMs] = useState<number | null>(null);
  const [rate, setRate] = useState(1);
  const trackWidthRef = useRef(0);

  const isLoading = status === 'loading';

  const displayMs = scrubMs ?? positionMs;
  const progress = durationMs > 0 ? Math.min(1, Math.max(0, displayMs / durationMs)) || 0 : 0;

  const awaitingSeekRef = useRef(false);
  const lastPositionRef = useRef(positionMs);

  useEffect(() => {
    if (positionMs === lastPositionRef.current) return;
    lastPositionRef.current = positionMs;
    if (awaitingSeekRef.current) {
      awaitingSeekRef.current = false;
      setScrubMs(null);
    }
  }, [positionMs]);

  const durationMsRef = useRef(0);
  durationMsRef.current = durationMs;
  const canScrubRef = useRef(false);
  canScrubRef.current = !isLoading && durationMs > 0;

  const grantMsRef = useRef(0);

  const panResponder = useMemo(() => {
    const msFromPx = (px: number): number =>
      (px / (trackWidthRef.current || 1)) * durationMsRef.current;
    const clampMs = (ms: number): number => Math.max(0, Math.min(durationMsRef.current, ms));

    return PanResponder.create({
      onStartShouldSetPanResponder: () => canScrubRef.current,
      onMoveShouldSetPanResponder: () => canScrubRef.current,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: evt => {
        const startMs = clampMs(msFromPx(evt.nativeEvent.locationX));
        grantMsRef.current = startMs;
        awaitingSeekRef.current = false;
        setScrubMs(startMs);
      },
      onPanResponderMove: (_evt, gestureState) => {
        setScrubMs(clampMs(grantMsRef.current + msFromPx(gestureState.dx)));
      },
      onPanResponderRelease: (_evt, gestureState) => {
        const target = clampMs(grantMsRef.current + msFromPx(gestureState.dx));
        setScrubMs(target);
        awaitingSeekRef.current = true;
        void Promise.resolve(onSeek(target)).catch(() => undefined);
      },
      onPanResponderTerminate: () => {
        awaitingSeekRef.current = false;
        setScrubMs(null);
      },
    });
  }, [onSeek]);

  const handleCycleRate = useCallback((): void => {
    const index = PLAYBACK_RATES.indexOf(rate as (typeof PLAYBACK_RATES)[number]);
    const next = PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length] ?? 1;
    setRate(next);
    onRate(next);
  }, [onRate, rate]);

  if (status === 'error') {
    return (
      <View
        className='flex-row items-center gap-2 rounded-2xl p-4'
        style={{ borderWidth: 1, borderColor }}
      >
        <AlertTriangle size={16} color={mutedColor} />
        <Text className='text-sm' style={{ color: mutedColor }}>
          Could not load this recording.
        </Text>
      </View>
    );
  }

  return (
    <View className='gap-3 rounded-2xl p-4' style={{ borderWidth: 1, borderColor }}>
      {video && showVideo ? (
        <View className='overflow-hidden rounded-xl' style={{ aspectRatio: 16 / 9 }}>
          {video.surface}
          {isLoading ? (
            <View className='absolute inset-0 items-center justify-center'>
              <ActivityIndicator size='small' color='white' />
            </View>
          ) : null}
        </View>
      ) : null}

      <View className='flex-row items-center gap-4'>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
          onPress={onPlayPause}
          disabled={isLoading}
          className='size-11 items-center justify-center rounded-full active:opacity-70'
          style={{ backgroundColor: accentBg }}
        >
          {isLoading ? (
            <ActivityIndicator size='small' color={accentFg} />
          ) : isPlaying ? (
            <Pause size={18} color={accentFg} fill={accentFg} />
          ) : (
            <Play size={18} color={accentFg} fill={accentFg} style={{ marginLeft: 2 }} />
          )}
        </Pressable>

        <View className='min-w-0 flex-1 gap-1.5'>
          {/* Track — tall hit area, thin visible line */}
          <View
            className='h-8 justify-center'
            onLayout={e => {
              trackWidthRef.current = e.nativeEvent.layout.width;
            }}
            {...panResponder.panHandlers}
          >
            <View
              pointerEvents='none'
              className='h-1 w-full rounded-full'
              style={{ backgroundColor: borderColor }}
            >
              <View
                className='h-1 w-full rounded-full'
                style={{
                  backgroundColor: accentBg,
                  transform: [{ scaleX: progress }],
                  transformOrigin: 'left',
                }}
              />
            </View>
          </View>

          <View className='flex-row items-center'>
            <Text className='text-xs tabular-nums' style={{ color: mutedColor }}>
              {formatElapsedTime(displayMs)}
            </Text>
            <Text className='flex-1 text-right text-xs tabular-nums' style={{ color: mutedColor }}>
              {formatElapsedTime(durationMs)}
            </Text>

            {video ? (
              <Pressable
                accessibilityRole='button'
                accessibilityLabel={showVideo ? 'Hide video' : 'Show video'}
                onPress={() => setShowVideo(value => !value)}
                hitSlop={8}
                className='ml-3 active:opacity-60'
              >
                {showVideo ? (
                  <VideoOff size={14} color={mutedColor} />
                ) : (
                  <Video size={14} color={mutedColor} />
                )}
              </Pressable>
            ) : null}

            {video && showVideo ? (
              <Pressable
                accessibilityRole='button'
                accessibilityLabel='Fullscreen'
                onPress={video.onFullscreen}
                disabled={isLoading}
                hitSlop={8}
                className='ml-3 active:opacity-60'
              >
                <Maximize size={14} color={mutedColor} />
              </Pressable>
            ) : null}

            <Pressable
              accessibilityRole='button'
              accessibilityLabel={`Playback speed ${rate}x`}
              onPress={handleCycleRate}
              disabled={isLoading}
              hitSlop={8}
              className='ml-3 active:opacity-60'
            >
              <Text className='text-xs font-semibold tabular-nums' style={{ color: mutedColor }}>
                {rate}x
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}
