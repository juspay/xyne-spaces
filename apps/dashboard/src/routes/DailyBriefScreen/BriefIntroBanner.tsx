import { ReactElement } from 'react';
import { MultipleCrossCancelDefault } from '@xyne/icons';
import { cn } from '@/utils/classNames';

interface BriefIntroBannerProps {
  onSeeMore: () => void;
  onDismiss: () => void;
  /** Master opt-in for the scheduled brief. Undefined while the config is still loading. */
  briefEnabled?: boolean | undefined;
  onEnableBrief?: (() => void) | undefined;
  enabling?: boolean | undefined;
}

export function BriefIntroBanner({
  onSeeMore,
  onDismiss,
  briefEnabled,
  onEnableBrief,
  enabling = false,
}: BriefIntroBannerProps): ReactElement {
  const showEnable = briefEnabled === false && onEnableBrief !== undefined;
  return (
    <div
      className={cn(
        'isolate relative mb-8 overflow-hidden rounded-[16px] border border-border px-6 py-5 bg-white/5 ~bg-gradient-to-r ~from-primary/25 ~via-primary/10 ~to-primary/30',
        'shadow-[0px_43px_26px_0px_rgba(0,0,0,0.01),0px_19px_19px_0px_rgba(0,0,0,0.02),0px_5px_10px_0px_rgba(0,0,0,0.02)]',
        'before:pointer-events-none before:-z-10 before:absolute before:-inset-x-[12%] before:h-[550%] before:bottom-full before:translate-y-[9%] before:bg-[radial-gradient(50%_50%_at_50%_50%,hsl(var(--primary))_54%,transparent)] before:blur-2xl',
      )}
    >
      <button
        type='button'
        aria-label='Dismiss'
        onClick={onDismiss}
        data-track-category='DailyBrief'
        data-track-name='daily-brief-intro-dismiss'
        className='absolute right-3 top-3 flex size-6 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
      >
        <MultipleCrossCancelDefault size={14} />
      </button>
      <div className='flex flex-col items-center gap-2 text-center'>
        <p className='font-serif text-[16px] font-bold italic leading-[20px] text-foreground'>
          Your Morning Brief
        </p>
        <p className='text-[16px] font-normal leading-[20px] text-foreground/80'>
          Everything that needs you, is overdue, waiting, and assigned to you summarized
        </p>
        {showEnable && (
          <p className='text-[13px] leading-[18px] text-muted-foreground'>
            You are not set up to receive this each morning yet.
          </p>
        )}
        <div className='mt-1 flex items-center gap-2'>
          {showEnable && (
            <button
              type='button'
              onClick={onEnableBrief}
              disabled={enabling}
              data-track-category='DailyBrief'
              data-track-name='daily-brief-intro-enable'
              className='flex h-7 items-center rounded-[8px] bg-foreground px-2.5 text-[14px] font-semibold leading-[20px] text-background shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50'
            >
              {enabling ? 'Turning on…' : 'Turn on morning brief'}
            </button>
          )}
          <button
            type='button'
            onClick={onSeeMore}
            data-track-category='DailyBrief'
            data-track-name='daily-brief-intro-see-more'
            className='flex h-7 items-center rounded-[8px] border border-border bg-background px-2.5 text-[14px] font-semibold leading-[20px] text-foreground shadow-sm transition-colors hover:bg-accent'
          >
            Learn more
          </button>
        </div>
      </div>
    </div>
  );
}
