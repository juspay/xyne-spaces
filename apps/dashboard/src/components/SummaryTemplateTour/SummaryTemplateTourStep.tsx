import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Button } from '../ui/Button/Button';
import { Popover } from '../ui/Popover';
import {
  SUMMARY_TEMPLATE_TOUR_STEPS,
  summaryTemplateTour,
  useSummaryTemplateTour,
  type SummaryTemplateTourStepId,
} from './summaryTemplateTour';

type PopoverSide = React.ComponentProps<typeof Popover>['side'];
type PopoverAlign = React.ComponentProps<typeof Popover>['align'];

interface SummaryTemplateTourStepProps {
  step: SummaryTemplateTourStepId;
  /** Value of the `data-tour` attribute on the element this step points at. */
  target: string;
  side?: PopoverSide;
  align?: PopoverAlign;
  /** Runs instead of plain `next()` when the step needs to change the screen first. */
  onNext?: () => void;
  showBack?: boolean;
}

// Dialog open animations shift the target for a moment; measure after they settle.
const SETTLE_DELAY_MS = 220;
// Give up if the target never renders so the tour cannot get stuck invisibly.
const FIND_TIMEOUT_MS = 2000;

/**
 * One coachmark of the summary template tour, anchored to a `data-tour` element.
 *
 * Render it inside the same React tree as its target (for dialog steps, inside the
 * dialog content) so Radix treats clicks on it as inside the dialog.
 */
export const SummaryTemplateTourStep = ({
  step,
  target,
  side = 'bottom',
  align = 'start',
  onNext,
  showBack = false,
}: SummaryTemplateTourStepProps): ReactElement | null => {
  const { activeStep, stepIndex, stepCount } = useSummaryTemplateTour();
  const isActive = activeStep === step;
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isActive) {
      setElement(null);
      setOpen(false);
      return;
    }

    let cancelled = false;
    let frame = 0;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();

    const find = (): void => {
      if (cancelled) return;
      const found = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
      if (found) {
        found.scrollIntoView({ block: 'center', inline: 'nearest' });
        setElement(found);
        settleTimer = setTimeout(() => {
          if (!cancelled) setOpen(true);
        }, SETTLE_DELAY_MS);
        return;
      }
      if (Date.now() - startedAt > FIND_TIMEOUT_MS) {
        summaryTemplateTour.dismiss();
        return;
      }
      frame = requestAnimationFrame(find);
    };
    find();

    return (): void => {
      cancelled = true;
      cancelAnimationFrame(frame);
      if (settleTimer) clearTimeout(settleTimer);
    };
  }, [isActive, target]);

  useEffect(() => {
    if (!element || !open) return;
    element.setAttribute('data-tour-active', '');
    return (): void => element.removeAttribute('data-tour-active');
  }, [element, open]);

  // The element itself, not a rect-only proxy, so floating-ui can watch the
  // dialog's scroll container and the target's size.
  const anchor = useMemo(() => (element ? { current: element } : undefined), [element]);

  if (!isActive || !anchor || stepIndex === null) return null;

  const copy = SUMMARY_TEMPLATE_TOUR_STEPS[stepIndex];
  if (!copy) return null;
  const isLast = stepIndex === stepCount - 1;
  const trackMetadata = JSON.stringify({ step, stepIndex });

  return (
    <Popover
      trigger={<span aria-hidden className='hidden' />}
      anchor={anchor}
      open={open}
      onOpenChange={next => {
        if (!next) summaryTemplateTour.dismiss();
      }}
      side={side}
      align={align}
      sideOffset={10}
      collisionPadding={12}
      showArrow
      onOpenAutoFocus={event => event.preventDefault()}
      onInteractOutside={event => event.preventDefault()}
      className='w-80 rounded-xl border-border p-4 shadow-lg'
    >
      <div role='dialog' aria-label={`${copy.title}. Step ${stepIndex + 1} of ${stepCount}`}>
        <p className='text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
          Step {stepIndex + 1} of {stepCount}
        </p>
        <h3 className='mt-1 text-sm font-semibold'>{copy.title}</h3>
        <p className='mt-1.5 text-sm text-muted-foreground'>{copy.body}</p>
        <div className='mt-3.5 flex items-center justify-between gap-2'>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={summaryTemplateTour.skip}
            className='-ml-2 text-muted-foreground'
            data-track-category='SummaryTemplateTour'
            data-track-name='Skip'
            data-track-metadata={trackMetadata}
          >
            Skip tour
          </Button>
          <div className='flex items-center gap-2'>
            {showBack && stepIndex > 0 && (
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={summaryTemplateTour.back}
                data-track-category='SummaryTemplateTour'
                data-track-name='Back'
                data-track-metadata={trackMetadata}
              >
                Back
              </Button>
            )}
            <Button
              type='button'
              size='sm'
              onClick={onNext ?? summaryTemplateTour.next}
              data-track-category='SummaryTemplateTour'
              data-track-name={isLast ? 'Done' : 'Next'}
              data-track-metadata={trackMetadata}
            >
              {isLast ? 'Got it' : 'Next'}
            </Button>
          </div>
        </div>
      </div>
    </Popover>
  );
};
