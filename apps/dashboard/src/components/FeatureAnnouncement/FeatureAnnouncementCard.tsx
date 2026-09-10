import { ReactElement, Ref, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useMeasure } from 'react-use';
import { MultipleCrossCancelDefault } from '@xyne/icons';
import {
  FeatureAnnouncementCtaType,
  isRenderableCta,
  type FeatureAnnouncementView,
} from '@xyne/shared';
import { cn } from '../../utils/classNames';
import { AnnouncementMedia, prefetchAnnouncementMedia } from './AnnouncementMedia';

export interface FeatureAnnouncementCardProps {
  /**
   * The whole pending batch, newest first. The card walks it in order rather than the host
   * handing over one announcement at a time, so a user with several waiting clears them in
   * a single sitting instead of one per app launch.
   */
  announcements: FeatureAnnouncementView[];
  onSeen: (id: string, pageIndex: number) => void;
  onCta: (id: string) => void | Promise<void>;
  onDismiss: () => void | Promise<void>;
  /** Set by the admin preview, which renders unsaved form values and must not write. */
  previewOnly?: boolean;
}

/**
 * Where an announcement opens. `progress` is the furthest page the user reached in an
 * earlier session, so a partly-read announcement resumes rather than restarting.
 */
function resumePage(announcement: FeatureAnnouncementView): number {
  return Math.min(announcement.progress ?? 0, Math.max(announcement.pages.length - 1, 0));
}

// Same pair of ease-outs the brief features dialog uses, so the two onboarding
// surfaces share a feel: size and content run on one duration and read as a
// single entity rather than two animations.
const SIZE_EASE = [0.25, 1, 0.5, 1] as const;
const CONTENT_EASE = [0.19, 1, 0.22, 1] as const;
const SIZE_DURATION = 0.27;
const CONTENT_DURATION = 0.27;

/**
 * Figma's 5-layer ambient lift, scaled to the in-app card size (see below). The
 * spec's first layer is 0-alpha and is dropped as a no-op.
 */
const CARD_SHADOW =
  'shadow-[0px_42px_17px_0px_rgba(0,0,0,0.01),0px_23px_14px_0px_rgba(0,0,0,0.03),0px_10px_10px_0px_rgba(0,0,0,0.04),0px_3px_6px_0px_rgba(0,0,0,0.05)]';

/**
 * The media container is its own surface in the design, with a hairline border and a
 * softer copy of the shell's lift. The shell clips it — as Figma's own `overflow-clip`
 * does — so what reads is the cast onto the 16px gap above the title.
 */
const MEDIA_SHADOW =
  'shadow-[0px_30px_12px_0px_rgba(0,0,0,0.01),0px_17px_10px_0px_rgba(0,0,0,0.02),0px_8px_8px_0px_rgba(0,0,0,0.03),0px_2px_4px_0px_rgba(0,0,0,0.04)]';

/**
 * The announcement card as specced in Chat—More › Feature Announcement.
 *
 * Proportions come from `stage 1` (5011:27079), the only frame that places the card
 * inside a 1:1 app window. The standalone `stage 6-8` frames are the same card blown up
 * to 440px for presentation - every value in them is the in-app one divided by 0.68977 -
 * so they are used for structure and ratio, not for absolute px.
 *
 * The box is 340px rather than the frame's 303.5px, a deliberate bump: the type below is
 * already above the literal scale, and widening the shell to match keeps the two in
 * proportion. The media container tracks it at the frame's 1.574 aspect (332x211).
 *
 * Type is the one place this does not follow that scale literally: 0.68977 puts the body
 * copy at 8.3px and the button label at 9.7px, which are artefacts of scaling a
 * presentation frame rather than shippable sizes. They are floored at 11px/12px, and the
 * close chip is 20px rather than 17.9px to stay a usable target.
 *
 * The behaviour is the contract and is unchanged by the restyle: stepper bounds, seen
 * reporting per rendered page, CTA dispatch by type, and degrading an unrecognised CTA
 * to a plain close. The design drops the explicit Back button, so the dot row is
 * interactive instead — backwards navigation stays reachable without extra chrome.
 */
export function FeatureAnnouncementCard({
  announcements,
  onSeen,
  onCta,
  onDismiss,
  previewOnly = false,
}: FeatureAnnouncementCardProps): ReactElement | null {
  const navigate = useNavigate();
  const [announcementIndex, setAnnouncementIndex] = useState(0);
  const [pageIndex, setPageIndex] = useState(() =>
    announcements[0] ? resumePage(announcements[0]) : 0,
  );
  const reduce = useReducedMotion();
  // Only the copy block changes height between pages; the media container is fixed.
  const [copyRef, copy] = useMeasure();

  // A CTA removes its own announcement from the batch, so both indices are clamped on
  // read rather than trusted: the array can shrink underneath this component between the
  // click and the re-render.
  const activeIndex = Math.min(announcementIndex, Math.max(announcements.length - 1, 0));
  const announcement = announcements[activeIndex];
  const pages = announcement?.pages ?? [];
  const safePage = Math.min(pageIndex, Math.max(pages.length - 1, 0));
  const page = pages[safePage];

  const isLastPage = safePage >= pages.length - 1;
  const isLastAnnouncement = activeIndex >= announcements.length - 1;
  const ctaRenderable = announcement ? isRenderableCta(announcement) : false;
  // The CTA belongs to its own announcement, so it appears on that announcement's last
  // page — not only at the end of the batch.
  const showCta = isLastPage && ctaRenderable;
  // Something still follows this slide, so the run is not over.
  const hasNext = !isLastPage || !isLastAnnouncement;
  // Skipping an announcement without acting on it has to stay possible, so a CTA that is
  // not the last thing in the batch is accompanied by the forward button rather than
  // replacing it. The forward control also keeps the same rightmost seat on every slide,
  // which is what makes paging through a batch a single repeated click.
  const showForward = !showCta || hasNext;
  const forwardLabel = hasNext ? 'Next' : 'Close';

  const enter = reduce
    ? { from: { opacity: 0 }, to: { opacity: 1 } }
    : {
        from: { opacity: 0, filter: 'blur(2px)', scale: 0.98 },
        to: { opacity: 1, filter: 'blur(0px)', scale: 1 },
      };
  const contentTransition = reduce
    ? { duration: 0 }
    : { duration: CONTENT_DURATION, ease: CONTENT_EASE };
  const sizeTransition = reduce ? { duration: 0 } : { duration: SIZE_DURATION, ease: SIZE_EASE };

  useEffect(() => {
    if (previewOnly || !page || !announcement) return;
    onSeen(announcement.id, safePage);
  }, [announcement, onSeen, page, safePage, previewOnly]);

  /**
   * The media the next slide will need, warmed while the current one is on screen. One
   * step only — see prefetchAnnouncementMedia. Null once there is nothing after this.
   */
  const nextMedia = ((): string | null => {
    if (!announcement) return null;
    if (!isLastPage) {
      const upcoming = pages[safePage + 1];
      return upcoming?.mediaUrl ?? announcement.mediaUrl;
    }
    const following = announcements[activeIndex + 1];
    if (!following) return null;
    const upcoming = following.pages[resumePage(following)];
    return upcoming?.mediaUrl ?? following.mediaUrl;
  })();

  useEffect(() => {
    // Draft previews are served `no-store`, so warming them would only burn bandwidth.
    if (previewOnly) return;
    prefetchAnnouncementMedia(nextMedia);
  }, [nextMedia, previewOnly]);

  const goToAnnouncement = useCallback(
    (index: number): void => {
      const target = announcements[index];
      if (!target) return;
      setAnnouncementIndex(index);
      setPageIndex(resumePage(target));
    },
    [announcements],
  );

  const handleCta = useCallback(async () => {
    if (previewOnly || !announcement) return;
    // Captured before the await: onCta removes this announcement from the batch, after
    // which `activeIndex` addresses whatever followed it.
    const following = announcements[activeIndex + 1] ?? null;

    // Set in the same tick as that removal so React batches the two together. Awaiting
    // first would leave the next announcement rendered at this one's page index for the
    // length of the CTA request.
    if (following) setPageIndex(resumePage(following));

    await onCta(announcement.id);

    if (!following) {
      // Acting on the last announcement finishes the batch. Anything still queued behind
      // it has already been walked past to get here, so the run is over.
      void onDismiss();
    }

    if (announcement.ctaType === FeatureAnnouncementCtaType.ROUTE && announcement.ctaTarget) {
      void navigate(announcement.ctaTarget);
      return;
    }
    if (announcement.ctaType === FeatureAnnouncementCtaType.EXTERNAL && announcement.ctaTarget) {
      window.open(announcement.ctaTarget, '_blank', 'noopener,noreferrer');
    }
  }, [activeIndex, announcement, announcements, navigate, onCta, onDismiss, previewOnly]);

  /** Forward one slide: next page, else next announcement, else the batch is finished. */
  const goNext = useCallback((): void => {
    if (!isLastPage) {
      // From safePage, not the raw state: the two diverge whenever the batch has shrunk.
      setPageIndex(Math.min(safePage + 1, pages.length - 1));
      return;
    }
    const following = announcements[activeIndex + 1];
    if (following) {
      goToAnnouncement(activeIndex + 1);
      return;
    }
    void onDismiss();
  }, [activeIndex, announcements, goToAnnouncement, isLastPage, onDismiss, pages.length, safePage]);

  if (!announcement || !page) return null;

  const media = page.mediaUrl ?? announcement.mediaUrl;
  const mediaAlt = page.mediaAlt ?? announcement.mediaAlt ?? '';

  return (
    <motion.div
      role='dialog'
      aria-label={announcement.title}
      data-testid='feature-announcement-card'
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      transition={contentTransition}
      className={cn(
        'pointer-events-auto flex w-[340px] flex-col items-center gap-4 overflow-hidden',
        'rounded-[16px] border-[0.5px] border-border bg-card p-1 pb-4',
        CARD_SHADOW,
      )}
    >
      <div
        className={cn(
          'relative h-[211px] w-[332px] shrink-0 overflow-hidden rounded-[12px]',
          'border-[0.5px] border-border bg-card',
          MEDIA_SHADOW,
        )}
      >
        {/* The empty container carries the app wallpaper, painted exactly as Wallpaper
            does for the page background — same themed `--wallpaper-image` variable, same
            cover/center sizing, no blur or scrim on top. It sits under the media, so it
            also fills the gap while an announcement's blob is still downloading. */}
        <div
          aria-hidden
          className='app-wallpaper-image pointer-events-none absolute inset-0 bg-cover bg-center bg-no-repeat'
        />

        <AnimatePresence initial={false} mode='popLayout'>
          <motion.div
            // Pages routinely share the announcement-level media; keying on the
            // resolved path means the hero only crossfades when it truly changes.
            key={media ?? 'empty'}
            initial={enter.from}
            animate={enter.to}
            exit={enter.from}
            transition={contentTransition}
            // `relative` so it stacks above the absolutely-positioned wallpaper wash,
            // which precedes it in the DOM and would otherwise paint over it.
            className='relative flex h-full w-full items-center justify-center'
          >
            {media ? (
              <AnnouncementMedia
                path={media}
                alt={mediaAlt}
                className='h-full w-full object-cover'
              />
            ) : (
              <span className='text-xs text-muted-foreground'>No media</span>
            )}
          </motion.div>
        </AnimatePresence>

        {announcements.length > 1 && (
          /* Sits on the media, opposite the close chip and matched to its 20px box so the
             two read as one row. Engraved rather than chipped: the 1px highlight beneath
             the glyphs is the surface colour itself, so it catches the light the way a
             pressed-in mark does. `--background` is a theme token, so the lip flips with
             the theme without a dark: variant — which this card does not otherwise use. */
          <span
            aria-label={`Announcement ${activeIndex + 1} of ${announcements.length}`}
            data-testid='feature-announcement-counter'
            className={cn(
              'pointer-events-none absolute left-1.5 top-1.5 flex h-5 items-center px-1',
              // Same family as the title; a step heavier so it holds at 11px.
              'font-serif text-[11px] font-semibold leading-none text-muted-foreground',
            )}
          >
            {activeIndex + 1} of {announcements.length}
          </span>
        )}

        <button
          type='button'
          aria-label='Dismiss'
          data-testid='feature-announcement-dismiss'
          data-track-category='FeatureAnnouncement'
          data-track-name='feature-announcement-dismiss'
          onClick={() => void onDismiss()}
          className={cn(
            'absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-md',
            'bg-foreground/5 text-foreground backdrop-blur-[2px] transition-colors',
            'hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
          )}
        >
          <MultipleCrossCancelDefault size={12} className='size-3 shrink-0' />
        </button>
      </div>
      <div className='flex w-full flex-col gap-2 px-3'>
        {/* The shell has no fixed height, so the copy block owns the morph: it
            animates to whatever the incoming page measures. */}
        <motion.div
          className='relative overflow-hidden'
          animate={{ height: copy.height || 'auto' }}
          transition={sizeTransition}
        >
          <div ref={copyRef as Ref<HTMLDivElement> | undefined} className='w-full'>
            <AnimatePresence initial={false} mode='popLayout'>
              <motion.div
                key={pageIndex}
                initial={enter.from}
                animate={enter.to}
                exit={enter.from}
                transition={contentTransition}
                className='flex w-full origin-left flex-col gap-1.5 text-foreground [word-break:break-word]'
              >
                <p className='font-serif text-[13px] font-medium italic leading-normal'>
                  {page.title}
                </p>
                <p className='text-[11px] font-[450] leading-[15px] tracking-[-0.1px]'>
                  {page.description}
                </p>
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>

        <div className='flex items-center justify-between'>
          <div
            className='flex items-center gap-[2px]'
            aria-label={`Step ${safePage + 1} of ${pages.length}`}
          >
            {pages.map((_, index) => (
              <button
                key={index}
                type='button'
                aria-label={`Go to step ${index + 1}`}
                aria-current={index === safePage ? 'step' : undefined}
                data-testid='feature-announcement-step'
                data-active={index === safePage}
                data-track-category='FeatureAnnouncement'
                data-track-name='feature-announcement-step'
                onClick={() => setPageIndex(index)}
                className={cn(
                  'h-[3px] w-1.5 rounded-full transition-colors duration-200 ease-out',
                  index === safePage ? 'bg-foreground' : 'bg-foreground/10 hover:bg-foreground/20',
                )}
              />
            ))}
          </div>

          <div className='flex min-w-0 items-center gap-1.5'>
            {showCta && (
              <motion.button
                layout
                transition={sizeTransition}
                type='button'
                data-testid='feature-announcement-cta'
                data-track-category='FeatureAnnouncement'
                data-track-name='feature-announcement-cta'
                onClick={() => void handleCta()}
                className={cn(
                  // Allowed to shrink, unlike the forward button: an author can spend up to
                  // MAX_TITLE_LENGTH on a CTA label, and it is the label that gives way.
                  'flex h-[22px] min-w-0 items-center justify-center rounded-[8px] px-2',
                  'text-[12px] font-semibold leading-4 transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                  // The CTA is the only filled button in the design.
                  'bg-foreground text-background hover:bg-foreground/90',
                )}
              >
                <span className='overflow-hidden text-ellipsis whitespace-nowrap'>
                  {announcement.ctaLabel}
                </span>
              </motion.button>
            )}

            {showForward && (
              /* `layout` carries the width change when Next becomes Close, so the label
                 swap and the box resize land together. */
              <motion.button
                layout
                transition={sizeTransition}
                type='button'
                data-testid={
                  forwardLabel === 'Close'
                    ? 'feature-announcement-close'
                    : 'feature-announcement-next'
                }
                data-track-category='FeatureAnnouncement'
                data-track-name={
                  forwardLabel === 'Close'
                    ? 'feature-announcement-close'
                    : 'feature-announcement-next'
                }
                onClick={goNext}
                className={cn(
                  // 8px radius is literal, not scaled — the design system's Button keeps it
                  // at 8px in the in-app frame too.
                  'flex h-[22px] shrink-0 items-center justify-center rounded-[8px] px-2',
                  'text-[12px] font-semibold leading-4 transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                  'border-[0.5px] border-border bg-card text-foreground hover:bg-accent',
                )}
              >
                <AnimatePresence initial={false} mode='popLayout'>
                  <motion.span
                    key={forwardLabel}
                    initial={enter.from}
                    animate={enter.to}
                    exit={enter.from}
                    transition={contentTransition}
                    className='overflow-hidden text-ellipsis whitespace-nowrap'
                  >
                    {forwardLabel}
                  </motion.span>
                </AnimatePresence>
              </motion.button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
