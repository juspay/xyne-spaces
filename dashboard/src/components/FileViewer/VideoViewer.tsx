import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize2, Settings } from 'lucide-react';
import { BaseViewerProps } from './utils';
import { BASE_URL } from '../../services/clients/apiClient';
import { useScope, useShortcutById } from '../../shortcuts';
import { usePlatform } from '../../hooks/usePlatform';

interface VideoViewerProps extends BaseViewerProps {
  attachmentId?: string;
  width?: number;
  height?: number;
}

const VideoViewer: React.FC<VideoViewerProps> = ({ source, attachmentId, width, height }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [isViewerFocused, setIsViewerFocused] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { isMobile } = usePlatform();
  // Determine compact mode based on container size (more reliable than aspect ratio alone)
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
          videoRef.current.play().catch(() => {
            setShowControls(true);
          });
        }
      };
      attemptAutoPlay();
    }
  }, [streamUrl]);

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
      setShowSettings(false);
    }
  };

  // Handle fullscreen
  const toggleFullscreen = (): void => {
    if (videoRef.current) {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {
          // Silently handle fullscreen exit errors
        });
      } else {
        videoRef.current.requestFullscreen().catch(() => {
          // Silently handle fullscreen enter errors
        });
      }
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
      <div className='flex items-center justify-center h-full bg-gray-900'>
        <div className='text-center text-white'>
          <p className='text-lg font-semibold mb-2'>Failed to load video</p>
          <p className='text-sm text-gray-400'>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className='relative h-full w-full bg-white flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white'
      onMouseMove={resetControlsTimeout}
      onMouseLeave={() => {
        if (controlsTimeoutRef.current) {
          clearTimeout(controlsTimeoutRef.current);
        }
        setShowControls(false);
      }}
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
        className={width && height ? 'w-full h-full' : 'max-w-full max-h-full'}
        style={{
          willChange: 'transform',
          transform: 'translate3d(0, 0, 0)',
          objectFit: 'contain',
          ...(width && height ? { width: `${width}px`, height: `${height}px` } : {}),
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
        <div className='absolute inset-0 flex items-center justify-center'>
          <div className='animate-spin rounded-full h-16 w-16 border-t-4 border-white'></div>
        </div>
      )}

      {/* Top-right fullscreen button (compact mode only) */}
      {isCompactControls && !isMobile && (
        <div
          className={`absolute top-2 right-2 z-20 transition-opacity duration-300 ${
            showControls ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <button
            onClick={toggleFullscreen}
            className='p-1.5 rounded-md bg-black/60 backdrop-blur-sm text-white hover:bg-black/80 transition-colors'
            title='Fullscreen (F)'
          >
            <Maximize2 className='h-4 w-4' />
          </button>
        </div>
      )}

      {/* Controls Overlay */}
      <div
        className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0'
        } ${isCompactControls ? 'pt-4' : 'pt-8'}`}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {/* Progress Bar */}
        <div className={`px-4 pb-2 ${isCompactControls ? 'pt-2' : 'pt-0'}`}>
          <div className='relative w-full h-1 bg-gray-600 rounded-lg'>
            {/* Filled progress */}
            <div
              className='absolute left-0 top-0 h-full bg-blue-500 rounded-lg transition-all duration-100'
              style={{ width: `${(currentTime / (duration || 1)) * 100}%` }}
            />
            {/* Range input */}
            <input
              type='range'
              min='0'
              max={duration || 0}
              value={currentTime}
              onChange={handleSeek}
              className='absolute top-0 left-0 w-full h-1 appearance-none cursor-pointer bg-transparent [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:relative [&::-webkit-slider-thumb]:z-10 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer'
            />
          </div>
        </div>

        {/* Control Buttons */}
        <div
          className={`flex items-center justify-between px-4 ${isCompactControls ? 'pb-2' : 'pb-4'}`}
        >
          <div className={`flex items-center ${isCompactControls ? 'gap-2' : 'gap-4'}`}>
            {/* Play/Pause */}
            <button
              onClick={togglePlay}
              className='text-white hover:text-gray-300 transition-colors'
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <Pause className={`${isCompactControls ? 'h-5 w-5' : 'h-6 w-6'}`} />
              ) : (
                <Play className={`${isCompactControls ? 'h-5 w-5' : 'h-6 w-6'}`} />
              )}
            </button>

            {/* Volume */}
            <div className='flex items-center gap-2'>
              <button
                onClick={toggleMute}
                className='text-white hover:text-gray-300 transition-colors'
                title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className={`${isCompactControls ? 'h-4 w-4' : 'h-5 w-5'}`} />
                ) : (
                  <Volume2 className={`${isCompactControls ? 'h-4 w-4' : 'h-5 w-5'}`} />
                )}
              </button>
              {showVolumeSlider && (
                <div className='relative w-20 h-1 bg-gray-600 rounded-lg'>
                  {/* Filled volume */}
                  <div
                    className='absolute left-0 top-0 h-full bg-blue-500 rounded-lg transition-all duration-100'
                    style={{ width: `${volume * 100}%` }}
                  />
                  {/* Range input */}
                  <input
                    type='range'
                    min='0'
                    max='1'
                    step='0.1'
                    value={volume}
                    onChange={handleVolumeChange}
                    className='absolute top-0 left-0 w-full h-1 appearance-none cursor-pointer bg-transparent [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:relative [&::-webkit-slider-thumb]:z-10 [&::-moz-range-thumb]:w-2.5 [&::-moz-range-thumb]:h-2.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer'
                  />
                </div>
              )}
            </div>

            {/* Time */}
            {showTimeDisplay && (
              <div className='text-white text-sm'>
                {formatTime(currentTime)} / {formatTime(duration)}
              </div>
            )}
          </div>

          <div className='flex items-center gap-3'>
            {/* Playback Speed - Always shown */}
            <div className='relative'>
              <button
                onClick={() => setShowSettings(!showSettings)}
                className='text-white hover:text-gray-300 transition-colors'
                title='Playback Speed'
              >
                <Settings className={`${isCompactControls ? 'h-4 w-4' : 'h-5 w-5'}`} />
              </button>
              {showSettings && (
                <div className='absolute bottom-full right-0 mb-2 bg-gray-800 rounded-lg shadow-lg py-2 min-w-[120px] z-10'>
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map(rate => (
                    <button
                      key={rate}
                      onClick={() => handlePlaybackRateChange(rate)}
                      className={`block w-full text-left px-4 py-2 text-sm ${
                        playbackRate === rate
                          ? 'text-white bg-gray-700'
                          : 'text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Fullscreen - Hidden on mobile and in compact mode (shown in top-right instead) */}
            {!isMobile && !isCompactControls && (
              <button
                onClick={toggleFullscreen}
                className='text-white hover:text-gray-300 transition-colors'
                title='Fullscreen (F)'
              >
                <Maximize2 className='h-5 w-5' />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoViewer;
