import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ZoomIn, ZoomOut, RotateCw, Maximize2, ExternalLink } from 'lucide-react';
import {
  TransformWrapper,
  TransformComponent,
  ReactZoomPanPinchContentRef,
} from 'react-zoom-pan-pinch';
import { BaseViewerProps } from './utils';
import { usePlatform } from '../../hooks/usePlatform';
import { useScope, useShortcutById } from '../../shortcuts';

const ImageViewer: React.FC<BaseViewerProps> = ({ source, fileName, disableGestures }) => {
  const [imageUrl, setImageUrl] = useState<string>('');
  const [rotation, setRotation] = useState(0);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // Sets the scale for image transform
  const [gestureScale, setGestureScale] = useState(1);
  // To enable zooming centered at other parts of the image apart from actual center
  const [transformOrigin, setTransformOrigin] = useState('50% 50%');
  // Mutable ref mirroring gestureScale, used to avoid stale closure.
  // Listeners read scale correctly without effect re-run
  const gestureScaleRef = useRef(1);
  // Records the finger distance and scale when the second finger lands.
  // Every subsequent touchmove computes its ratio against this anchor
  const pinchRef = useRef<{ startDist: number; startScale: number } | null>(null);
  const disableGesturesContainerRef = useRef<HTMLDivElement>(null);

  const transformRef = useRef<ReactZoomPanPinchContentRef>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const { isMobile } = usePlatform();

  useScope('viewer', imageLoaded && !imageError);

  useEffect((): (() => void) => {
    if (!source) return () => {};
    if (!(source instanceof File)) {
      return () => {};
    }

    const url = URL.createObjectURL(source);
    setImageError(false);
    setImageUrl(url);

    // Resetting any pinch-zoom from the previous image
    gestureScaleRef.current = 1;
    setGestureScale(1);
    setTransformOrigin('50% 50%');
    pinchRef.current = null;

    return () => URL.revokeObjectURL(url);
  }, [source]);

  // ─── Non-passive touch + wheel listeners for pinch-zoom ─────────────────────
  useEffect(() => {
    if (!disableGestures) return;
    const el = disableGesturesContainerRef.current;
    if (!el) return;

    const getTouchDistance = (touches: TouchList): number | null => {
      const t0 = touches[0];
      const t1 = touches[1];
      if (!t0 || !t1) return null;
      const dx = t0.clientX - t1.clientX;
      const dy = t0.clientY - t1.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const onTouchStart = (e: TouchEvent): void => {
      if (e.touches.length === 2) {
        const dist = getTouchDistance(e.touches);
        if (dist === null) return;
        pinchRef.current = {
          startDist: dist,
          startScale: gestureScaleRef.current,
        };
        // Set transform-origin to the midpoint between the two fingers,
        // expressed as a percentage of the image element so zooming
        // expands toward where the user is actually pinching.
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        if (t0 && t1 && imageRef.current) {
          const rect = imageRef.current.getBoundingClientRect();
          const midX = (t0.clientX + t1.clientX) / 2;
          const midY = (t0.clientY + t1.clientY) / 2;
          const originX = ((midX - rect.left) / rect.width) * 100;
          const originY = ((midY - rect.top) / rect.height) * 100;
          setTransformOrigin(`${originX}% ${originY}%`);
        }
      } else {
        // Single finger — clear pinch state so a stale ref can't interfere.
        pinchRef.current = null;
      }
    };

    const onTouchMove = (e: TouchEvent): void => {
      if (e.touches.length !== 2 || !pinchRef.current) return;

      const newDist = getTouchDistance(e.touches);
      if (newDist === null) return;

      // Prevent the parent swipe-carousel from treating two fingers as a swipe.
      e.preventDefault();
      const ratio = newDist / pinchRef.current.startDist;
      const newScale = Math.min(Math.max(pinchRef.current.startScale * ratio, 1), 5);

      gestureScaleRef.current = newScale;
      setGestureScale(newScale);
    };

    const onTouchEnd = (e: TouchEvent): void => {
      if (e.touches.length < 2) {
        pinchRef.current = null;
      }
    };

    // ── Laptop trackpad support, purely for testing pinch gesture on laptop itself────────────────────────────────────────────────
    // On desktop browsers a physical pinch on trackpad fires wheel events with
    // ctrlKey=true (Chrome, Firefox, Safari all do this). We don't want this to interfere
    // with our pinch gesture so we prevent default.
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      // On trackpad, use the cursor position as the focal point.
      if (imageRef.current) {
        const rect = imageRef.current.getBoundingClientRect();
        const originX = ((e.clientX - rect.left) / rect.width) * 100;
        const originY = ((e.clientY - rect.top) / rect.height) * 100;
        setTransformOrigin(`${originX}% ${originY}%`);
      }
      // deltaY is negative when pinching out (zoom-in) and positive when pinching in (zoom-out)
      const delta = -e.deltaY * 0.01;
      const newScale = Math.min(Math.max(gestureScaleRef.current + delta, 1), 5);
      gestureScaleRef.current = newScale;
      setGestureScale(newScale);
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    // To prevent being treated like a swipe
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    // To prevent wheel event on laptop trackpad on pinch gesture
    el.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('wheel', onWheel);
    };
    // gestureScaleRef doesn't trigger re-runs and the handlers don't close over any changing state.
  }, [disableGestures]);

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
          <p className='text-lg font-semibold mb-2 text-white'>Failed to load image</p>
          <p className='text-sm text-muted-foreground'>The image could not be displayed</p>
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
              className='select-none max-h-screen max-w-full h-auto w-auto object-contain origin-center'
              style={{
                transform: `rotate(${rotation}deg) scale(${gestureScale})`,
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
      className='h-full w-full relative'
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
          panning={{ disabled: true }}
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
                  className='select-none max-h-screen max-w-full h-auto w-auto object-contain origin-center'
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
            <button
              onClick={handleRotate}
              className='inline-flex items-center justify-center w-9 h-9 text-white/90 hover:text-white hover:bg-background/10 rounded-md transition-colors'
              title='Rotate (Ctrl R)'
              data-track-category='FileViewer'
              data-track-name='ROTATE_IMAGE'
              data-track-metadata={JSON.stringify({ source, fileName })}
            >
              <RotateCw className='h-5 w-5' />
            </button>
            <button
              onClick={handleZoomOut}
              className='inline-flex items-center justify-center w-9 h-9 text-white/90 hover:text-white hover:bg-background/10 rounded-md transition-colors'
              title='Zoom Out (Ctrl -)'
              data-track-category='FileViewer'
              data-track-name='ZOOM_OUR_IMAGE'
              data-track-metadata={JSON.stringify({ source, fileName })}
            >
              <ZoomOut className='h-5 w-5' />
            </button>

            <button
              onClick={handleZoomIn}
              className='inline-flex items-center justify-center w-9 h-9 text-white/90 hover:text-white hover:bg-background/10 rounded-md transition-colors'
              title='Zoom In (Ctrl +)'
              data-track-category='FileViewer'
              data-track-name='ZOOM_IN_IMAGE'
              data-track-metadata={JSON.stringify({ source, fileName })}
            >
              <ZoomIn className='h-5 w-5' />
            </button>
          </div>

          {/* Fit to Screen & Rotate - Bottom Right */}
          <div
            className={`absolute bottom-0 right-0 z-20 flex gap-6 p-6 transition-opacity duration-300 ${
              isHovered ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <button
              onClick={handleReset}
              className='inline-flex items-center justify-center w-9 h-9 text-white/90 hover:text-white hover:bg-background/10 rounded-md transition-colors'
              title='Fit to Screen (Ctrl 0)'
              data-track-category='FileViewer'
              data-track-name='FIT_IMAGE_TO_SCREEN'
              data-track-metadata={JSON.stringify({ source, fileName })}
            >
              <Maximize2 className='h-5 w-5' />
            </button>

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
