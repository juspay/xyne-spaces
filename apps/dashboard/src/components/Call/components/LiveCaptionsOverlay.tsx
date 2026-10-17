import { cn } from '../../../utils/classNames';
import type { LiveCaption } from '../hooks/useLiveCaptions';

interface LiveCaptionsOverlayProps {
  captions: LiveCaption[];
  /** Floating mini window: smaller type, one line per speaker. */
  compact?: boolean;
}

/**
 * Film-style subtitles over the call stage: a dark translucent box at the bottom centre,
 * speaker name above large white text. Each line shows only its last two rows, so a long
 * sentence scrolls up as it grows instead of covering the video.
 */
export function LiveCaptionsOverlay({
  captions,
  compact = false,
}: LiveCaptionsOverlayProps): React.ReactElement | null {
  if (captions.length === 0) return null;
  const shown = compact ? captions.slice(-1) : captions;

  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-0 z-40 flex justify-center',
        compact ? 'bottom-2 px-2' : 'bottom-6 px-4',
      )}
      aria-label='Live captions'
      data-testid='live-captions'
    >
      {/* Screen readers hear finished lines only; interim text changes about once a second */}
      <div className='sr-only' aria-live='polite'>
        {shown
          .filter(caption => caption.isFinal)
          .map(caption => (
            <p key={caption.segmentId}>
              {caption.speakerName}: {caption.text}
            </p>
          ))}
      </div>
      <div className='flex w-full max-w-3xl flex-col gap-2'>
        {shown.map(caption => (
          <div
            key={caption.segmentId}
            aria-hidden='true'
            className={cn(
              'bg-black/75 shadow-lg backdrop-blur-sm transition-opacity duration-300',
              compact ? 'rounded-lg px-2.5 py-1.5' : 'rounded-xl px-4 py-2.5',
              caption.isFinal ? 'opacity-90' : 'opacity-100',
            )}
          >
            <div
              className={cn(
                'font-semibold uppercase tracking-wide text-[#a8c7fa]',
                compact ? 'text-[10px]' : 'mb-0.5 text-xs',
              )}
            >
              {caption.speakerName}
            </div>
            {/* Bottom-anchored, two rows tall: older words scroll off the top */}
            <div
              className={cn(
                'flex flex-col justify-end overflow-hidden',
                compact ? 'max-h-[2.5rem]' : 'max-h-[3.6rem]',
              )}
            >
              <p
                className={cn(
                  'text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]',
                  compact ? 'text-sm leading-5' : 'text-lg leading-[1.8rem] sm:text-xl',
                )}
              >
                {caption.text}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
