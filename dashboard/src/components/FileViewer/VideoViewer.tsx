import React, { useState, useRef, useEffect, useCallback, useImperativeHandle } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize2, Minimize2, Settings } from 'lucide-react';
import { BaseViewerProps } from './utils';
import { BASE_URL } from '../../services/clients/apiClient';
import { useScope, useShortcutById } from '../../shortcuts';
import { usePlatform } from '../../hooks/usePlatform';
import { Menu } from '@base-ui/react/menu';
import { cn } from '../../utils/classNames';

interface VideoViewerProps extends BaseViewerProps {
  attachmentId?: string;
  width?: number;
  height?: number;
  onExpand?: () => void;
  menuContent?: React.ReactNode;
  initialTime?: number;
}

const VideoViewer = React.forwardRef<HTMLVideoElement, VideoViewerProps>(
  ({ source, attachmentId, width, height, onExpand, menuContent, initialTime = 0 }, ref) => {
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
    const { isMobile } = usePlatform();

    // Expose video ref to parent component
    useImperativeHandle(ref, () => videoRef.current as HTMLVideoElement);

    // Determine if we're in immersive mode (full view modal) or inline mode
    const isImmersiveMode = width === undefined && height === undefined;

    // Determine compact mode based on container size
    const isCompactControls = width !== undefined && width <= 220;
    const showVolumeSlider = !isCompactControls && !isMobile;
    const showTimeDisplay = !isCompactControls;

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

    useEffect((): (() => void) => {
      // Cleanup object URL if created from File
      return (): void => {
        if (source instanceof File && streamUrl && streamUrl.startsWith('blob:')) {
          URL.revokeObjectURL(streamUrl);
        }
      };
    }, [source, streamUrl]);

    const isViewerActive = isViewerFocused;

    useScope('viewer', isViewerActive);

    // Auto-play video when component mounts and video is ready
    useEffect(() => {
      if (videoRef.current) {
        const attemptAutoPlay = (): void => {
          if (videoRef.current && videoRef.current.paused) {
            // Seek to initial time if provided before playing
            if (initialTime > 0) {
              videoRef.current.currentTime = initialTime;
            }
            videoRef.current.play().catch(() => {
              setShowControls(true);
            });
          }
        };
        attemptAutoPlay();
      }
    }, [streamUrl, initialTime]);

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
      setIsLoading(true);
      setError(null);
    };

    const handleCanPlay = (): void => {
      setIsLoading(false);
      setError(null);
    };

    const handlePlay = (): void => {
      setIsPlaying(true);
    };

    const handlePause = (): void => {
      setIsPlaying(false);
    };

    const handleTimeUpdate = (): void => {
      if (videoRef.current) {
        setCurrentTime(videoRef.current.currentTime);
      }
    };

    const handleDurationChange = (): void => {
      if (videoRef.current) {
        setDuration(videoRef.current.duration);
      }
    };

    const handleError = (): void => {
      setIsLoading(false);
      setError('Failed to load video. The video format may not be supported.');
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

    // Cleanup timeout on unmount
    useEffect((): (() => void) => {
      return () => {
        if (controlsTimeoutRef.current) {
          clearTimeout(controlsTimeoutRef.current);
        }
      };
    }, []);

    if (error) {
      return (
        <div className='flex items-center justify-center h-full bg-gray-900 min-h-64'>
          <div className='text-center text-white'>
            <p className='text-lg font-semibold mb-2'>Failed to load video</p>
            <p className='text-sm text-gray-400 px-4'>{error}</p>
          </div>
        </div>
      );
    }

    // Common video player UI - used for both inline and immersive modes
    return (
      <div
        ref={containerRef}
        className={cn(
          `relative h-full w-full flex items-center justify-center group ${
            isImmersiveMode ? 'bg-black' : 'bg-white'
          } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2`,
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
            transform: 'translate3d(0, 0, 0)',
            objectFit: 'contain',
            ...(!isImmersiveMode && width && height
              ? { width: `${width}px`, height: `${height}px` }
              : {}),
          }}
          onClick={togglePlay}
          onLoadStart={handleLoadStart}
          onCanPlay={handleCanPlay}
          onPlay={handlePlay}
          onPause={handlePause}
          onTimeUpdate={handleTimeUpdate}
          onDurationChange={handleDurationChange}
          onError={handleError}
          preload='metadata'
          autoPlay
          playsInline
          controls={false}
        >
          <track kind='captions' />
          Your browser does not support the video tag.
        </video>

        {/* Loading Spinner */}
        {isLoading && (
          <div
            className={cn(
              'absolute inset-0 flex items-center justify-center',
              isImmersiveMode ? 'bg-black/40 z-20' : '',
            )}
          >
            <div className='flex flex-col items-center gap-3'>
              <div
                className={cn(
                  `animate-spin rounded-full border-t-4 ${
                    isImmersiveMode ? 'h-12 w-12 border-white' : 'h-16 w-16 border-white'
                  }`,
                )}
              ></div>
              {isImmersiveMode && <div className='text-gray-300 text-sm'>Loading video...</div>}
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
                ? 'bg-gradient-to-t from-black/60 to-transparent p-6 bottom-0'
                : `bg-gradient-to-t from-black/60 via-black/20 to-transparent bottom-0 ${
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
                      ? 'inline-flex items-center justify-center w-9 h-9 text-white/90 hover:text-white hover:bg-white/10 rounded-md transition-colors'
                      : 'text-white hover:text-gray-300 transition-colors'
                  }
                  title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
                >
                  {isPlaying ? (
                    <Pause
                      className={`${isImmersiveMode || !isCompactControls ? 'h-5 w-5' : 'h-4 w-4'}`}
                    />
                  ) : (
                    <Play
                      className={`${isImmersiveMode || !isCompactControls ? 'h-5 w-5' : 'h-4 w-4'}`}
                    />
                  )}
                </button>

                {/* Volume */}
                <div className={cn('flex items-center gap-2')}>
                  <button
                    onClick={toggleMute}
                    className={
                      isImmersiveMode
                        ? 'inline-flex items-center justify-center w-9 h-9 text-white/90 hover:text-white hover:bg-white/10 rounded-md transition-colors'
                        : 'text-white hover:text-gray-300 transition-colors'
                    }
                    title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
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

                  {/* Volume slider - show in immersive or when not compact */}
                  {(isImmersiveMode || showVolumeSlider) && (
                    <div className={cn('relative w-20 h-1 bg-gray-600 rounded-lg')}>
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
                      />
                    </div>
                  )}
                </div>

                {/* Time - show in immersive or when not compact */}
                {(isImmersiveMode || showTimeDisplay) && (
                  <div className={cn('text-white text-sm')}>
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
                          ? 'inline-flex items-center justify-center w-9 h-9 text-white/90 hover:text-white hover:bg-white/10 rounded-md transition-colors'
                          : 'text-white hover:text-gray-300 transition-colors p-1'
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
                              `px-3 py-2 text-sm text-white hover:bg-white/10 rounded-md transition-colors cursor-pointer flex items-center justify-between outline-none ${playbackRate === rate ? 'bg-white/20' : ''}`,
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
                        ? 'inline-flex items-center justify-center w-9 h-9 text-white/90 hover:text-white hover:bg-white/10 rounded-md transition-colors'
                        : 'text-white hover:text-gray-300 transition-colors',
                    )}
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
