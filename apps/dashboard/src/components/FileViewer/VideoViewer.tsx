import React, { useState, useRef, useEffect, useCallback, useImperativeHandle } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize2, Minimize2, Settings } from 'lucide-react';
import { BaseViewerProps } from './utils';
import { BASE_URL, apiInstance } from '../../services/clients/apiClient';
import { useScope, useShortcutById } from '../../shortcuts';
import { usePlatform } from '../../hooks/usePlatform';
import { useMobileZoom } from '../../hooks/useMobileZoom';
import { Menu } from '@base-ui/react/menu';
import { cn } from '../../utils/classNames';
import { attachmentViewerActor } from '../../machines/attachmentViewerMachine';
import { useSelector } from '@xstate/react';
import {
  clearVideoPosition,
  getVideoPosition,
  saveVideoPosition,
} from '../../utils/videoPlaybackPositions';

interface VideoViewerProps extends BaseViewerProps {
  attachmentId?: string;
  width?: number;
  height?: number;
  onExpand?: () => void;
  menuContent?: React.ReactNode;
  initialTime?: number;
  autoPlay?: boolean;
}

const VideoViewer = React.forwardRef<HTMLVideoElement, VideoViewerProps>(
  (
    {
      source,
      attachmentId,
      width,
      height,
      onExpand,
      menuContent,
      initialTime,
      autoPlay = false,
      disableGestures,
      onInteractionStateChange,
    },
    ref,
  ) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [volume, setVolume] = useState(1);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showControls, setShowControls] = useState(true);
    const [playbackRate, setPlaybackRate] = useState(1);
    const [isViewerFocused, setIsViewerFocused] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const retryCountRef = useRef(0);
    const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const videoObserverRef = useRef<IntersectionObserver | null>(null);
    const MAX_VIDEO_RETRIES = 5;
    const { isMobile } = usePlatform();

    // Expose video ref to parent component
    useImperativeHandle(ref, () => videoRef.current as HTMLVideoElement);

    // Determine if we're in immersive mode (full view modal) or inline mode
    const isImmersiveMode = width === undefined && height === undefined;

    // Determine compact mode based on container size
    const isCompactControls = width !== undefined && width <= 260;
    const showVolumeSlider =
      !isCompactControls && !isMobile && (width === undefined || width > 340);
    const showVerticalVolumeSlider = !isImmersiveMode && !isMobile && !showVolumeSlider;
    const showTimeDisplay = width === undefined || width > 220;

    // Memoize the streaming URL to prevent recreation on every render
    const streamUrl = React.useMemo((): string => {
      if (attachmentId) {
        // Use the streaming endpoint for range request support
        return `${BASE_URL}/attachments/${attachmentId}/stream`;
      }
      // Fallback: create object URL from File
      if (source instanceof File) {
        return URL.createObjectURL(source);
      }
      return '';
    }, [attachmentId, source]);

    // Mobile zoom hook for pinch-to-zoom and pan
    const {
      scale: mobileZoomScale,
      transformOrigin,
      panX,
      resetZoom,
    } = useMobileZoom({
      enabled: Boolean(isMobile && (isImmersiveMode || disableGestures)),
      containerRef,
      targetRef: videoRef,
      minScale: 1,
      maxScale: 5,
      onInteractionStateChange,
    });

    // Reset zoom when source/attachmentId changes
    useEffect(() => {
      resetZoom();
    }, [streamUrl, resetZoom]);

    useEffect((): (() => void) => {
      // Cleanup object URL if created from File
      return (): void => {
        if (source instanceof File && streamUrl && streamUrl.startsWith('blob:')) {
          URL.revokeObjectURL(streamUrl);
        }
      };
    }, [source, streamUrl]);

    // Reset retry state whenever the stream URL changes (new video)
    useEffect(() => {
      retryCountRef.current = 0;
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    }, [streamUrl]);

    const isViewerActive = isViewerFocused;

    useScope('viewer', isViewerActive);

    // Subscribe to the global attachment viewer state
    const activeGalleryAttachmentId = useSelector(attachmentViewerActor, state => {
      if (state.value === 'closed') return null;
      return state.context.attachments[state.context.currentIndex]?.attachmentId;
    });

    // Pause this video if the user swipes to a different attachment in the modal
    useEffect(() => {
      if (activeGalleryAttachmentId && attachmentId && activeGalleryAttachmentId !== attachmentId) {
        if (videoRef.current) {
          // Call pause() unconditionally. If it's already paused, it's a safe no-op.
          // If there is a pending auto-play promise, this instantly aborts it.
          videoRef.current.pause();
          setIsPlaying(false);
        }
      }
    }, [activeGalleryAttachmentId, attachmentId]);

    const positionKey = attachmentId;
    const lastKnownRef = useRef<{ key: string | undefined; time: number; duration: number }>({
      key: positionKey,
      time: 0,
      duration: 0,
    });
    const savedTimeRef = useRef(0);
    const hasAppliedStartTimeRef = useRef(false);
    const hasAutoPlayedRef = useRef(false);
    const retryResumeRef = useRef<{ time: number; wasPlaying: boolean } | null>(null);
    const isSeekingRef = useRef(false);

    useEffect(() => {
      hasAppliedStartTimeRef.current = false;
      hasAutoPlayedRef.current = false;
      savedTimeRef.current = 0;
      lastKnownRef.current = { key: positionKey, time: 0, duration: 0 };
    }, [streamUrl, positionKey]);

    useEffect((): (() => void) => {
      return (): void => {
        const { key, time, duration } = lastKnownRef.current;
        saveVideoPosition(key, time, duration);
      };
    }, [positionKey]);

    const applyStartTime = (): void => {
      const video = videoRef.current;
      if (!video || hasAppliedStartTimeRef.current) {
        return;
      }
      hasAppliedStartTimeRef.current = true;

      const retryResume = retryResumeRef.current;
      retryResumeRef.current = null;

      const resumeFrom = retryResume
        ? retryResume.time
        : initialTime !== undefined && initialTime > 0
          ? initialTime
          : (getVideoPosition(positionKey) ?? 0);

      if (resumeFrom <= 0) {
        return;
      }
      if (isFinite(video.duration) && resumeFrom >= video.duration) {
        return;
      }
      video.currentTime = resumeFrom;
      setCurrentTime(resumeFrom);

      if (retryResume?.wasPlaying) {
        hasAutoPlayedRef.current = true;
        video.play().catch(() => {
          setShowControls(true);
        });
      }
    };

    const maybeAutoPlay = (): void => {
      const video = videoRef.current;
      if (!autoPlay || hasAutoPlayedRef.current || !video || !video.paused) {
        return;
      }
      // Don't steal playback while a different attachment is open in the modal.
      if (activeGalleryAttachmentId && attachmentId && activeGalleryAttachmentId !== attachmentId) {
        return;
      }
      hasAutoPlayedRef.current = true;
      video.play().catch(() => {
        setShowControls(true);
      });
    };

    // Handle play/pause
    const togglePlay = useCallback((e?: React.MouseEvent): void => {
      if (e) {
        e.stopPropagation();
        e.preventDefault();
      }
      if (videoRef.current) {
        // Use the actual video element's paused property instead of state
        // to avoid race conditions, especially in fullscreen mode
        if (videoRef.current.paused) {
          videoRef.current.play().catch(() => {
            // Silently handle play errors - user can try again
          });
        } else {
          videoRef.current.pause();
        }
      }
    }, []);

    // Handle mute/unmute
    const toggleMute = (): void => {
      if (videoRef.current) {
        videoRef.current.muted = !isMuted;
        setIsMuted(!isMuted);
      }
    };

    // Handle volume change
    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
      const newVolume = parseFloat(e.target.value);
      if (videoRef.current) {
        videoRef.current.volume = newVolume;
        setVolume(newVolume);
        setIsMuted(newVolume === 0);
      }
    };

    // Handle seek
    const handleSeek = (e: React.ChangeEvent<HTMLInputElement>): void => {
      const newTime = parseFloat(e.target.value);
      if (videoRef.current) {
        videoRef.current.currentTime = newTime;
        setCurrentTime(newTime);
      }
    };

    // Handle playback rate change
    const handlePlaybackRateChange = (rate: number): void => {
      if (videoRef.current) {
        videoRef.current.playbackRate = rate;
        setPlaybackRate(rate);
      }
    };

    // Format time (seconds to MM:SS)
    const formatTime = (seconds: number): string => {
      if (!isFinite(seconds)) return '0:00';
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    // Auto-hide controls
    const resetControlsTimeout = useCallback((): void => {
      setShowControls(true);
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
      controlsTimeoutRef.current = setTimeout(() => {
        // Hide controls after timeout, regardless of play state
        setShowControls(false);
      }, 3000);
    }, []);

    // Video event handlers
    const handleLoadStart = (): void => {
      setError(null);
    };

    const handleLoadedMetadata = (): void => {
      applyStartTime();
    };

    const handleCanPlay = (): void => {
      setIsLoading(false);
      setError(null);
      applyStartTime();
      maybeAutoPlay();
    };

    const handlePlay = (): void => {
      setIsPlaying(true);
    };

    const handlePause = (): void => {
      setIsPlaying(false);
      const video = videoRef.current;
      if (video) {
        savedTimeRef.current = video.currentTime;
        lastKnownRef.current = {
          key: positionKey,
          time: video.currentTime,
          duration: video.duration,
        };
        saveVideoPosition(positionKey, video.currentTime, video.duration);
      }
    };

    const handleEnded = (): void => {
      setIsPlaying(false);
      lastKnownRef.current = { key: positionKey, time: 0, duration: 0 };
      clearVideoPosition(positionKey);
    };

    const handleSeeking = (): void => {
      isSeekingRef.current = true;
    };

    const handleSeeked = (): void => {
      isSeekingRef.current = false;
      const video = videoRef.current;
      if (video) {
        savedTimeRef.current = video.currentTime;
        lastKnownRef.current = {
          key: positionKey,
          time: video.currentTime,
          duration: video.duration,
        };
        saveVideoPosition(positionKey, video.currentTime, video.duration);
      }
    };

    const handleTimeUpdate = (): void => {
      const video = videoRef.current;
      if (!video) {
        return;
      }
      setCurrentTime(video.currentTime);
      attachmentViewerActor.send({ type: 'SET_VIDEO_TIME', time: video.currentTime });

      lastKnownRef.current = {
        key: positionKey,
        time: video.currentTime,
        duration: video.duration,
      };
      if (!isSeekingRef.current && Math.abs(video.currentTime - savedTimeRef.current) >= 1) {
        savedTimeRef.current = video.currentTime;
        saveVideoPosition(positionKey, video.currentTime, video.duration);
      }
    };

    const handleDurationChange = (): void => {
      if (videoRef.current) {
        setDuration(videoRef.current.duration);
      }
    };

    const handleError = (): void => {
      // Retry on ANY error while retries remain.
      //
      // A video that isn't ready yet (still uploading / processing) can
      // trigger different error codes depending on the browser:
      //   • MEDIA_ERR_NETWORK (2) – Chrome when the server returns 404
      //   • MEDIA_ERR_SRC_NOT_SUPPORTED (4) – Firefox / Safari for the same 404
      //
      // Checking only MEDIA_ERR_NETWORK therefore fails silently on non-Chrome
      // browsers and immediately shows the error UI. Retrying on every code
      // means even a genuinely unsupported format will show an error after
      // exhausting retries — still a better UX than an instant failure for a
      // video that simply hasn't finished uploading.
      if (retryCountRef.current < MAX_VIDEO_RETRIES) {
        retryCountRef.current += 1;
        // Keep loading spinner visible during retries
        setIsLoading(true);
        setError(null);

        const video = videoRef.current;
        if (video && video.currentTime > 0) {
          retryResumeRef.current = { time: video.currentTime, wasPlaying: !video.paused };
        }
        hasAppliedStartTimeRef.current = false;

        // Exponential back-off: 2 s, 3 s, 4.5 s … capped at 15 s
        const delay = Math.min(2000 * Math.pow(1.5, retryCountRef.current - 1), 15_000);
        retryTimeoutRef.current = setTimeout(() => {
          if (videoRef.current) {
            videoRef.current.load();
          }
        }, delay);
      } else {
        // Retries exhausted → show error UI. A file that never finished uploading 404s
        // here and surfaces as the same MediaError as an undecodable one, so ask the
        // server which it is instead of always blaming the format.
        setIsLoading(false);
        setError('Failed to load video. The video format may not be supported.');
        if (attachmentId) {
          void apiInstance
            .get(`/attachments/${attachmentId}/stream`, {
              headers: { Range: 'bytes=0-0' },
              validateStatus: () => true,
            })
            .then(res => {
              if (res.status === 404) {
                setError('This video did not finish uploading, so there is nothing to play.');
              }
            })
            .catch(() => {
              // Offline or blocked — leave the generic message in place.
            });
        }
      }
    };

    // Shared keyboard handler logic
    const handleKeyboardAction = useCallback(
      (code: string): boolean => {
        if (!videoRef.current) return false;

        switch (code) {
          case 'Space':
            togglePlay();
            resetControlsTimeout();
            return true;
          case 'KeyM':
            videoRef.current.muted = !videoRef.current.muted;
            setIsMuted(videoRef.current.muted);
            return true;
          case 'KeyF':
            if (document.fullscreenElement) {
              document.exitFullscreen().catch(() => {
                // Silently handle fullscreen exit errors
              });
            } else {
              videoRef.current.requestFullscreen().catch(() => {
                // Silently handle fullscreen enter errors
              });
            }
            return true;
          case 'ArrowLeft':
            videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 5);
            return true;
          case 'ArrowRight':
            videoRef.current.currentTime = Math.min(duration, videoRef.current.currentTime + 5);
            return true;
          case 'ArrowUp':
            videoRef.current.volume = Math.min(1, videoRef.current.volume + 0.1);
            setVolume(videoRef.current.volume);
            return true;
          case 'ArrowDown':
            videoRef.current.volume = Math.max(0, videoRef.current.volume - 0.1);
            setVolume(videoRef.current.volume);
            return true;
          default:
            return false;
        }
      },
      [duration, togglePlay, resetControlsTimeout],
    );

    useShortcutById(
      'viewer.video',
      event => {
        handleKeyboardAction(event.code);
      },
      {
        enabled: isViewerActive,
      },
    );

    // IntersectionObserver to pause video when scrolled out of view
    // Only applies to inline mode (when width/height are defined), not immersive mode
    useEffect(() => {
      const video = videoRef.current;
      if (!video || isImmersiveMode) return;

      videoObserverRef.current = new IntersectionObserver(
        entries => {
          const entry = entries[0];
          // If video is not visible and is playing, pause it
          if (entry && !entry.isIntersecting && !video.paused) {
            video.pause();
          }
        },
        { threshold: 0, rootMargin: '0px' },
      );

      videoObserverRef.current.observe(video);

      return () => {
        videoObserverRef.current?.disconnect();
        videoObserverRef.current = null;
      };
    }, [isImmersiveMode]);

    // Cleanup timeouts on unmount
    useEffect((): (() => void) => {
      return () => {
        if (controlsTimeoutRef.current) {
          clearTimeout(controlsTimeoutRef.current);
        }
        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current);
        }
      };
    }, []);

    if (error) {
      return (
        <div className='flex items-center justify-center h-full bg-gray-900 min-h-64'>
          <div className='text-center text-white'>
            <p className='text-lg font-semibold mb-2'>Failed to load video</p>
            <p className='text-sm text-muted-foreground px-4'>{error}</p>
          </div>
        </div>
      );
    }

    // Common video player UI - used for both inline and immersive modes
    return (
      <div
        ref={containerRef}
        className={cn(
          'relative h-full w-full flex items-center justify-center group bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2',
        )}
        onMouseLeave={() => {
          if (controlsTimeoutRef.current) {
            clearTimeout(controlsTimeoutRef.current);
          }
          setShowControls(false);
        }}
        onMouseMove={resetControlsTimeout}
        onFocus={() => setIsViewerFocused(true)}
        onBlur={() => setIsViewerFocused(false)}
        tabIndex={0}
        role='button'
        aria-label='Video player. Press Space to play/pause, M to mute, F for fullscreen, arrow keys to seek and adjust volume'
      >
        {/* Video Element */}
        <video
          ref={videoRef}
          src={streamUrl}
          crossOrigin='use-credentials'
          className={cn(
            isImmersiveMode
              ? 'relative z-10 max-h-full max-w-full h-auto w-auto'
              : width && height
                ? 'w-full h-full'
                : 'max-w-full max-h-full',
          )}
          style={{
            willChange: 'transform',
            transform: isMobile
              ? `translateX(${panX}px) scale(${mobileZoomScale})`
              : 'translate3d(0, 0, 0)',
            transformOrigin: isMobile ? transformOrigin : undefined,
            transition: isMobile ? 'transform 0.05s ease-out' : undefined,
            objectFit: 'contain',
            ...(!isImmersiveMode && width && height
              ? { width: `${width}px`, height: `${height}px` }
              : {}),
          }}
          onClick={togglePlay}
          onLoadStart={handleLoadStart}
          onLoadedMetadata={handleLoadedMetadata}
          onCanPlay={handleCanPlay}
          onPlay={handlePlay}
          onPause={handlePause}
          onEnded={handleEnded}
          onSeeking={handleSeeking}
          onSeeked={handleSeeked}
          onTimeUpdate={handleTimeUpdate}
          onDurationChange={handleDurationChange}
          onError={handleError}
          preload='metadata'
          playsInline
          controls={false}
          data-track-category='VIDEO_PLAYER'
          data-track-name='ClickVideo'
          data-track-metadata={JSON.stringify({ attachmentId })}
        >
          <track kind='captions' />
          Your browser does not support the video tag.
        </video>

        {/* Loading Spinner — always shown over a black background */}
        {isLoading && (
          <div className='absolute inset-0 flex items-center justify-center bg-black/60 z-20'>
            <div className='flex flex-col items-center gap-3'>
              <div className='animate-spin rounded-full border-t-4 h-12 w-12 border-white'></div>
              {isImmersiveMode && <div className='text-muted text-sm'>Loading video...</div>}
            </div>
          </div>
        )}

        {/* Top-right 3-dot menu - Only for inline mode */}
        {!isImmersiveMode && menuContent && (
          <div
            className={cn(
              'absolute top-2 right-2 z-20 transition-opacity duration-300',
              showControls ? 'opacity-100' : 'opacity-0',
            )}
          >
            {menuContent}
          </div>
        )}

        {/* Controls Overlay - Shared by both modes */}
        {!isLoading && (
          <div
            className={cn(
              'absolute left-0 right-0 z-20 transition-opacity duration-300',
              showControls ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
              isImmersiveMode
                ? 'bg-gradient-to-t from-black/90 via-black/50 to-transparent p-6 bottom-0'
                : `bg-gradient-to-t from-black/80 via-black/40 to-transparent bottom-0 ${
                    isCompactControls ? 'pt-4' : 'pt-8'
                  }`,
            )}
          >
            {/* Progress Bar */}
            <div
              className={
                isImmersiveMode ? 'mb-4' : `px-4 pb-2 ${isCompactControls ? 'pt-2' : 'pt-0'}`
              }
            >
              <div
                className={cn(
                  `relative w-full rounded-lg ${
                    isImmersiveMode
                      ? 'h-1.5 bg-gray-600/50 cursor-pointer group/progress'
                      : 'h-1 bg-gray-600'
                  }`,
                )}
              >
                <div
                  className={cn(
                    `absolute left-0 top-0 h-full rounded-lg ${
                      isImmersiveMode ? 'bg-white' : 'bg-blue-500'
                    }`,
                  )}
                  style={{ width: `${(currentTime / (duration || 1)) * 100}%` }}
                />
                <input
                  type='range'
                  min='0'
                  max={duration || 0}
                  value={currentTime}
                  onChange={handleSeek}
                  className={cn(
                    `absolute left-0 w-full appearance-none cursor-pointer bg-transparent ${
                      isImmersiveMode
                        ? '-top-1 h-3 opacity-0 group-hover/progress:opacity-100 transition-opacity [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4'
                        : 'top-0 h-1 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3'
                    } [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:relative [&::-webkit-slider-thumb]:z-10 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer`,
                  )}
                  data-track-category='VIDEO_PLAYER'
                  data-track-name='SeekVideo'
                  data-track-metadata={JSON.stringify({ currentTime, attachmentId })}
                />
              </div>
            </div>

            {/* Control Buttons */}
            <div
              className={cn(
                `flex items-center justify-between ${
                  isImmersiveMode ? '' : `px-4 ${isCompactControls ? 'pb-2' : 'pb-4'}`
                }`,
              )}
            >
              {/* Left side controls */}
              <div
                className={cn(
                  `flex items-center ${isImmersiveMode ? 'gap-4' : isCompactControls ? 'gap-2' : 'gap-4'}`,
                )}
              >
                {/* Play/Pause */}
                <button
                  onClick={togglePlay}
                  className={
                    isImmersiveMode
                      ? 'inline-flex items-center justify-center w-9 h-9 text-white hover:bg-white/15 rounded-md transition-colors'
                      : 'text-white hover:text-muted transition-colors'
                  }
                  title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
                  data-track-category='VIDEO_PLAYER'
                  data-track-name={isPlaying ? 'PauseVideo' : 'PlayVideo'}
                  data-track-metadata={JSON.stringify({ currentTime, attachmentId })}
                >
                  {isPlaying ? (
                    <Pause
                      className={`${isImmersiveMode || !isCompactControls ? 'h-5 w-5' : 'h-4 w-4'} fill-white`}
                    />
                  ) : (
                    <Play
                      className={`${isImmersiveMode || !isCompactControls ? 'h-5 w-5' : 'h-4 w-4'} fill-white`}
                    />
                  )}
                </button>

                {/* Volume */}
                <div className={cn('relative group/volume flex items-center gap-2')}>
                  <button
                    onClick={toggleMute}
                    className={
                      isImmersiveMode
                        ? 'inline-flex items-center justify-center w-9 h-9 text-white hover:bg-white/15 rounded-md transition-colors'
                        : 'text-white hover:text-muted transition-colors'
                    }
                    title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
                    data-track-category='VIDEO_PLAYER'
                    data-track-name={isMuted ? 'UnmuteVideo' : 'MuteVideo'}
                    data-track-metadata={JSON.stringify({ currentTime, attachmentId })}
                  >
                    {isMuted || volume === 0 ? (
                      <VolumeX
                        className={`${isImmersiveMode || !isCompactControls ? 'h-5 w-5' : 'h-4 w-4'}`}
                      />
                    ) : (
                      <Volume2
                        className={`${isImmersiveMode || !isCompactControls ? 'h-5 w-5' : 'h-4 w-4'}`}
                      />
                    )}
                  </button>

                  {/* Volume slider - inline next to the mute button when it fits,
                      otherwise the same slider rotated vertical in a hover popover */}
                  {(isImmersiveMode || showVolumeSlider || showVerticalVolumeSlider) && (
                    <div
                      className={cn(
                        showVerticalVolumeSlider &&
                          'absolute bottom-full left-1/2 -translate-x-1/2 z-30 pb-1 opacity-0 pointer-events-none group-hover/volume:opacity-100 group-hover/volume:pointer-events-auto transition-opacity duration-150',
                      )}
                    >
                      <div
                        className={cn(
                          showVerticalVolumeSlider &&
                            'flex h-24 w-6 items-center justify-center rounded-lg bg-black/90 backdrop-blur-sm border border-gray-700 shadow-lg',
                        )}
                      >
                        <div
                          className={cn(
                            'relative w-20 h-1 bg-gray-600 rounded-lg',
                            showVerticalVolumeSlider && 'shrink-0 -rotate-90',
                          )}
                        >
                          <div
                            className={cn(
                              `absolute left-0 top-0 h-full rounded-lg transition-all duration-100 ${
                                isImmersiveMode ? 'bg-white' : 'bg-blue-500'
                              }`,
                            )}
                            style={{ width: `${volume * 100}%` }}
                          />
                          <input
                            type='range'
                            min='0'
                            max='1'
                            step='0.1'
                            value={volume}
                            onChange={handleVolumeChange}
                            className='absolute top-0 left-0 w-full h-1 appearance-none cursor-pointer bg-transparent [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:relative [&::-webkit-slider-thumb]:z-10 [&::-moz-range-thumb]:w-2.5 [&::-moz-range-thumb]:h-2.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer'
                            data-track-category='VIDEO_PLAYER'
                            data-track-name='AdjustVolume'
                            data-track-metadata={JSON.stringify({ volume, attachmentId })}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Time - show in immersive or when not compact */}
                {(isImmersiveMode || showTimeDisplay) && (
                  <div
                    className={cn(
                      'text-white text-sm whitespace-nowrap drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]',
                    )}
                  >
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </div>
                )}
              </div>

              {/* Right side controls */}
              <div className='flex items-center gap-3'>
                {/* Playback Speed */}
                <Menu.Root>
                  <Menu.Trigger>
                    <button
                      type='button'
                      className={
                        isImmersiveMode
                          ? 'inline-flex items-center justify-center w-9 h-9 text-white hover:bg-white/15 rounded-md transition-colors'
                          : 'text-white hover:text-muted transition-colors p-1'
                      }
                      title='Playback speed'
                    >
                      <Settings
                        className={`${isImmersiveMode || !isCompactControls ? 'h-5 w-5' : 'h-4 w-4'}`}
                      />
                    </button>
                  </Menu.Trigger>
                  <Menu.Portal>
                    <Menu.Positioner
                      onClick={e => e.stopPropagation()}
                      side='top'
                      align='end'
                      sideOffset={8}
                      className='z-[100] bg-black/90 backdrop-blur-sm rounded-lg shadow-lg border border-gray-700 p-1 min-w-[120px] pointer-events-auto'
                    >
                      <Menu.Popup>
                        {[0.5, 0.75, 1, 1.25, 1.5, 2].map(rate => (
                          <Menu.Item
                            key={rate}
                            onClick={() => handlePlaybackRateChange(rate)}
                            className={cn(
                              `px-3 py-2 text-sm text-white hover:bg-white/15 rounded-md transition-colors cursor-pointer flex items-center justify-between outline-none ${playbackRate === rate ? 'bg-white/20' : ''}`,
                            )}
                          >
                            <span>{rate}x</span>
                            {playbackRate === rate && <span className='text-blue-400 ml-2'>✓</span>}
                          </Menu.Item>
                        ))}
                      </Menu.Popup>
                    </Menu.Positioner>
                  </Menu.Portal>
                </Menu.Root>

                {/* Fullscreen/Expand - Show in immersive or when not on mobile/compact */}
                {(isImmersiveMode || !isMobile) && (
                  <button
                    onClick={onExpand}
                    className={cn(
                      isImmersiveMode
                        ? 'inline-flex items-center justify-center w-9 h-9 text-white hover:bg-white/15 rounded-md transition-colors'
                        : 'text-white hover:text-muted transition-colors',
                    )}
                    data-track-category='VIDEO_PLAYER'
                    data-track-name={isImmersiveMode ? 'ExitFullscreen' : 'EnterFullscreen'}
                    data-track-metadata={JSON.stringify({ attachmentId })}
                  >
                    {isImmersiveMode ? (
                      <Minimize2 className='h-5 w-5' />
                    ) : (
                      <Maximize2 className='h-4 w-4' />
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  },
);

VideoViewer.displayName = 'VideoViewer';

export default VideoViewer;
