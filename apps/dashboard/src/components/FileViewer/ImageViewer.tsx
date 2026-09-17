import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ZoomIn, ZoomOut, RotateCw, Maximize2, Minimize2, ExternalLink } from 'lucide-react';
import {
  TransformWrapper,
  TransformComponent,
  ReactZoomPanPinchContentRef,
} from 'react-zoom-pan-pinch';
import { BaseViewerProps } from './utils';
import { usePlatform } from '../../hooks/usePlatform';
import { useMobileZoom } from '../../hooks/useMobileZoom';
import { useScope, useShortcutById } from '../../shortcuts';
import { ShortcutTooltip } from '../ui/ShortcutTooltip';
import { Tooltip } from '../ui/Tooltip';

const ImageViewer: React.FC<BaseViewerProps> = ({
  source,
  fileName,
  disableGestures,
  onInteractionStateChange,
}) => {
  const [imageUrl, setImageUrl] = useState<string>('');
  const [rotation, setRotation] = useState(0);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const viewerContainerRef = useRef<HTMLDivElement>(null);
  const disableGesturesContainerRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<ReactZoomPanPinchContentRef>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const { isMobile } = usePlatform();

  // Use mobile zoom hook when disableGestures is enabled (carousel mode)
  const {
    scale: gestureScale,
    transformOrigin,
    panX,
    resetZoom,
  } = useMobileZoom({
    enabled: Boolean(disableGestures),
    containerRef: disableGesturesContainerRef,
    targetRef: imageRef,
    minScale: 1,
    maxScale: 5,
    onInteractionStateChange,
  });

  useScope('viewer', imageLoaded && !imageError);

  useEffect((): (() => void) => {
    if (!source) return () => {};
    if (!(source instanceof File)) {
      return () => {};
    }

    // An empty (0-byte) File can never decode into an image — fail fast with a
    // clear message instead of waiting for the <img> onerror (XYNE-61758).
    if (source.size === 0) {
      setImageError(true);
      return () => {};
    }

    const url = URL.createObjectURL(source);
    setImageError(false);
    setImageUrl(url);

    // Reset zoom when source changes
    resetZoom();

    return () => URL.revokeObjectURL(url);
  }, [source, resetZoom]);

  const handleZoomIn = useCallback(() => {
    if (transformRef.current) {
      transformRef.current.zoomIn(0.25);
    }
  }, []);

  const handleZoomOut = useCallback(() => {
    if (transformRef.current) {
      transformRef.current.zoomOut(0.25);
    }
  }, []);

  const handleReset = useCallback(() => {
    if (transformRef.current) {
      transformRef.current.resetTransform();
    }
  }, []);

  const handleFullscreenToggle = useCallback(() => {
    if (document.fullscreenElement === viewerContainerRef.current) {
      document.exitFullscreen().catch(() => undefined);
      return;
    }

    void viewerContainerRef.current?.requestFullscreen().catch(() => {
      // Fullscreen not supported or denied — keep the viewer as-is.
    });
  }, []);

  useEffect(() => {
    const onFullscreenChange = (): void => {
      setIsFullscreen(document.fullscreenElement === viewerContainerRef.current);
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    return (): void => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const handleRotate = useCallback(() => {
    setRotation(prev => (prev + 90) % 360);
  }, []);

  const handleOpenInNewWindow = useCallback(() => {
    if (imageUrl) {
      window.open(imageUrl, '_blank');
    }
  }, [imageUrl]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!imageLoaded || imageError) return;

      switch (e.code) {
        case 'Equal':
        case 'NumpadAdd':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            handleZoomIn();
          }
          break;
        case 'Minus':
        case 'NumpadSubtract':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            handleZoomOut();
          }
          break;
        case 'Digit0':
        case 'Numpad0':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            handleReset();
          }
          break;
        case 'KeyR':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            handleRotate();
          }
          break;
        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight':
          if (transformRef.current) {
            e.preventDefault();
            const {
              positionX: currentX,
              positionY: currentY,
              scale,
            } = transformRef.current.instance.transformState;

            const newX = currentX;
            const newY = currentY;
            transformRef.current.setTransform(newX, newY, scale);
          }
          break;
      }
    },
    [imageLoaded, imageError, handleZoomIn, handleZoomOut, handleReset, handleRotate],
  );

  useShortcutById(
    'viewer.image.controls',
    event => {
      handleKeyDown(event);
    },
    {
      enabled: imageLoaded && !imageError,
    },
  );

  useShortcutById(
    'viewer.image.pan',
    event => {
      handleKeyDown(event);
    },
    {
      enabled: imageLoaded && !imageError,
    },
  );

  const handleImageLoad = (): void => {
    setImageLoaded(true);
    setImageError(false);
  };

  const handleImageError = (): void => {
    setImageError(true);
    setImageLoaded(false);
  };

  if (imageError) {
    return (
      <div className='flex items-center justify-center h-full'>
        <div className='text-center text-muted'>
          <p className='text-lg font-semibold mb-2 text-white'>Couldn&apos;t load image</p>
          <p className='text-sm text-muted-foreground'>The file may be missing or empty</p>
        </div>
      </div>
    );
  }

  if (disableGestures) {
    return (
      <div
        ref={disableGesturesContainerRef}
        className='h-full w-full relative'
        style={{ touchAction: 'none', overflow: 'hidden' }}
      >
        <div className='absolute inset-0 overflow-hidden'>
          <div
            className='absolute inset-0 scale-110'
            style={{
              backgroundImage: imageUrl ? `url(${imageUrl})` : 'none',
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: 'blur(32px)',
              opacity: 0.7,
            }}
          />
          <div className='absolute inset-0 bg-black/30' />
        </div>
        <div className='relative z-10 h-full w-full flex items-center justify-center'>
          {!imageLoaded && (
            <div className='absolute inset-0 flex items-center justify-center z-10'>
              <div className='text-gray-300 bg-black/60 px-4 py-2 rounded backdrop-blur-sm'>
                Loading image...
              </div>
            </div>
          )}
          {imageUrl && !imageError && (
            <img
              ref={imageRef}
              src={imageUrl}
              alt={fileName}
              onLoad={handleImageLoad}
              onError={handleImageError}
              className='select-none max-h-full max-w-full h-auto w-auto object-contain origin-center'
              style={{
                transform: `rotate(${rotation}deg) translateX(${panX}px) scale(${gestureScale})`,
                transformOrigin,
                // A short transition to smooth out the discrete setState calls without adding perceptible lag.
                transition: 'transform 0.05s ease-out',
              }}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={viewerContainerRef}
      className='h-full w-full relative bg-black'
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Blurred Background Layer */}
      <div className='absolute inset-0 overflow-hidden'>
        <div
          className='absolute inset-0 scale-110'
          style={{
            backgroundImage: imageUrl ? `url(${imageUrl})` : 'none',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: 'blur(32px)',
            opacity: 0.7,
          }}
        />
        <div className='absolute inset-0 bg-black/30' />
      </div>

      {/* Image Container with TransformWrapper - Full screen */}
      <div className='h-full w-full relative z-10'>
        <TransformWrapper
          ref={transformRef}
          initialScale={1}
          minScale={1}
          maxScale={5}
          limitToBounds={true}
          centerOnInit={true}
          centerZoomedOut={true}
          panning={{ disabled: false }}
          wheel={{
            step: 0.5,
            smoothStep: 0.01,
            activationKeys: [],
          }}
          doubleClick={{ mode: 'toggle', step: 0.7 }}
          pinch={{ step: 5 }}
        >
          <TransformComponent
            wrapperClass='!w-full !h-full'
            contentClass='!w-full !h-full flex items-center justify-center'
          >
            <div className='relative w-full h-full flex items-center justify-center'>
              {!imageLoaded && (
                <div className='absolute inset-0 flex items-center justify-center z-10'>
                  <div className='text-muted bg-black/60 px-4 py-2 rounded backdrop-blur-sm'>
                    Loading image...
                  </div>
                </div>
              )}
              {imageUrl && !imageError && (
                <img
                  ref={imageRef}
                  src={imageUrl}
                  alt={fileName}
                  onLoad={handleImageLoad}
                  onError={handleImageError}
                  className='select-none max-h-full max-w-full h-auto w-auto object-contain origin-center'
                  style={{ transform: `rotate(${rotation}deg)` }}
                />
              )}
            </div>
          </TransformComponent>
        </TransformWrapper>
      </div>

      {/* Floating Controls - Slack Style */}
      {imageLoaded && !isMobile && (
        <>
          {/* Zoom Controls - Bottom Left */}
          <div
            className={`absolute bg-gradient-to-t from-black/60 to-transparent gap-6 p-6 w-full bottom-0 left-0 z-20 flex transition-opacity duration-300 ${
              isHovered ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <ShortcutTooltip
              label='Rotate'
              shortcut='viewer.image.controls'
              keys='mod+r'
              side='top'
            >
              <button
                onClick={handleRotate}
                className='inline-flex items-center justify-center w-9 h-9 text-white/90 hover:text-white hover:bg-background/10 rounded-md transition-colors'
                aria-label='Rotate'
                data-track-category='FileViewer'
                data-track-name='ROTATE_IMAGE'
                data-track-metadata={JSON.stringify({ source, fileName })}
              >
                <RotateCw className='h-5 w-5' />
              </button>
            </ShortcutTooltip>
            <ShortcutTooltip
              label='Zoom out'
              shortcut='viewer.image.controls'
              keys='mod+minus'
              side='top'
            >
              <button
                onClick={handleZoomOut}
                className='inline-flex items-center justify-center w-9 h-9 text-white/90 hover:text-white hover:bg-background/10 rounded-md transition-colors'
                aria-label='Zoom out'
                data-track-category='FileViewer'
                data-track-name='ZOOM_OUR_IMAGE'
                data-track-metadata={JSON.stringify({ source, fileName })}
              >
                <ZoomOut className='h-5 w-5' />
              </button>
            </ShortcutTooltip>

            <ShortcutTooltip
              label='Zoom in'
              shortcut='viewer.image.controls'
              keys='mod+shift+equal'
              side='top'
            >
              <button
                onClick={handleZoomIn}
                className='inline-flex items-center justify-center w-9 h-9 text-white/90 hover:text-white hover:bg-background/10 rounded-md transition-colors'
                aria-label='Zoom in'
                data-track-category='FileViewer'
                data-track-name='ZOOM_IN_IMAGE'
                data-track-metadata={JSON.stringify({ source, fileName })}
              >
                <ZoomIn className='h-5 w-5' />
              </button>
            </ShortcutTooltip>
          </div>

          {/* Fullscreen & Open in New Window - Bottom Right */}
          <div
            className={`absolute bottom-0 right-0 z-20 flex gap-6 p-6 transition-opacity duration-300 ${
              isHovered ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <Tooltip content={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} side='top'>
              <button
                onClick={handleFullscreenToggle}
                className='inline-flex items-center justify-center w-9 h-9 text-white/90 hover:text-white hover:bg-background/10 rounded-md transition-colors'
                aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                data-track-category='FileViewer'
                data-track-name={isFullscreen ? 'EXIT_IMAGE_FULLSCREEN' : 'ENTER_IMAGE_FULLSCREEN'}
                data-track-metadata={JSON.stringify({ source, fileName })}
              >
                {isFullscreen ? (
                  <Minimize2 className='h-5 w-5' />
                ) : (
                  <Maximize2 className='h-5 w-5' />
                )}
              </button>
            </Tooltip>

            <button
              onClick={handleOpenInNewWindow}
              className='inline-flex items-center justify-center w-9 h-9 text-white/90 hover:text-white hover:bg-background/10 rounded-md transition-colors'
              title='Open in New Window'
              data-track-category='FileViewer'
              data-track-name='OPEN_IMAGE_IN_NEW_WINDOW'
              data-track-metadata={JSON.stringify({ source, fileName })}
            >
              <ExternalLink className='h-5 w-5' />
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default ImageViewer;
