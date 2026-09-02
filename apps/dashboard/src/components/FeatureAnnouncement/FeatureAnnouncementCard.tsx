import { ReactElement, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FeatureAnnouncementCtaType,
  isRenderableCta,
  type FeatureAnnouncementView,
} from '@xyne/shared';
import { AnnouncementMedia } from './AnnouncementMedia';

export interface FeatureAnnouncementCardProps {
  announcement: FeatureAnnouncementView;
  onSeen: (id: string, pageIndex: number) => void;
  onCta: (id: string) => void | Promise<void>;
  onDismiss: () => void | Promise<void>;
  /** Set by the admin preview, which renders unsaved form values and must not write. */
  previewOnly?: boolean;
}

/**
 * Placeholder presentation — the layout, spacing and motion are for the design team to
 * replace. The behaviour below is the contract and should survive that restyle:
 * stepper bounds, seen reporting per rendered page, CTA dispatch by type, and degrading
 * an unrecognised CTA to a plain close.
 */
export function FeatureAnnouncementCard({
  announcement,
  onSeen,
  onCta,
  onDismiss,
  previewOnly = false,
}: FeatureAnnouncementCardProps): ReactElement | null {
  const navigate = useNavigate();
  const [pageIndex, setPageIndex] = useState(() =>
    Math.min(announcement.progress ?? 0, Math.max(announcement.pages.length - 1, 0)),
  );

  const pages = announcement.pages;
  const page = pages[pageIndex];
  const isLastPage = pageIndex >= pages.length - 1;
  const ctaRenderable = isRenderableCta(announcement);

  useEffect(() => {
    if (previewOnly || !page) return;
    onSeen(announcement.id, pageIndex);
  }, [announcement.id, onSeen, page, pageIndex, previewOnly]);

  const handleCta = useCallback(async () => {
    if (previewOnly) return;
    await onCta(announcement.id);
    if (announcement.ctaType === FeatureAnnouncementCtaType.ROUTE && announcement.ctaTarget) {
      void navigate(announcement.ctaTarget);
      return;
    }
    if (announcement.ctaType === FeatureAnnouncementCtaType.EXTERNAL && announcement.ctaTarget) {
      window.open(announcement.ctaTarget, '_blank', 'noopener,noreferrer');
    }
  }, [announcement.ctaTarget, announcement.ctaType, announcement.id, navigate, onCta, previewOnly]);

  if (!page) return null;

  const media = page.mediaUrl ?? announcement.mediaUrl;
  const mediaAlt = page.mediaAlt ?? announcement.mediaAlt ?? '';

  return (
    <div
      role='dialog'
      aria-label={announcement.title}
      data-testid='feature-announcement-card'
      className='pointer-events-auto w-[310px] overflow-hidden rounded-[12px] border border-border bg-card shadow-lg'
    >
      <div className='relative'>
        <div className='flex h-[170px] items-center justify-center bg-muted'>
          {media ? (
            <AnnouncementMedia path={media} alt={mediaAlt} className='h-full w-full object-cover' />
          ) : (
            <span className='text-xs text-muted-foreground'>No media</span>
          )}
        </div>
        <button
          type='button'
          aria-label='Dismiss'
          data-testid='feature-announcement-dismiss'
          data-track-category='FeatureAnnouncement'
          data-track-name='feature-announcement-dismiss'
          onClick={() => void onDismiss()}
          className='absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-background/80 text-muted-foreground hover:text-foreground'
        >
          ×
        </button>
      </div>

      <div className='flex flex-col gap-2 p-4'>
        <p className='font-serif text-[16px] font-bold italic leading-[20px] text-foreground'>
          {page.title}
        </p>
        <p className='text-[13px] leading-[18px] text-foreground/80'>{page.description}</p>

        <div className='mt-2 flex items-center justify-between'>
          <div
            className='flex items-center gap-1'
            aria-label={`Step ${pageIndex + 1} of ${pages.length}`}
          >
            {pages.map((_, index) => (
              <span
                key={index}
                data-testid='feature-announcement-step'
                data-active={index === pageIndex}
                className={
                  index === pageIndex
                    ? 'h-[3px] w-4 rounded-full bg-foreground'
                    : 'h-[3px] w-2 rounded-full bg-border'
                }
              />
            ))}
          </div>

          <div className='flex items-center gap-2'>
            {pageIndex > 0 && (
              <button
                type='button'
                data-testid='feature-announcement-back'
                data-track-category='FeatureAnnouncement'
                data-track-name='feature-announcement-back'
                onClick={() => setPageIndex(current => Math.max(current - 1, 0))}
                className='rounded-[8px] border border-border px-3 py-1 text-[13px] font-semibold text-foreground'
              >
                Back
              </button>
            )}

            {isLastPage ? (
              ctaRenderable ? (
                <button
                  type='button'
                  data-testid='feature-announcement-cta'
                  data-track-category='FeatureAnnouncement'
                  data-track-name='feature-announcement-cta'
                  onClick={() => void handleCta()}
                  className='rounded-[8px] bg-foreground px-3 py-1 text-[13px] font-semibold text-background'
                >
                  {announcement.ctaLabel}
                </button>
              ) : (
                <button
                  type='button'
                  data-testid='feature-announcement-close'
                  data-track-category='FeatureAnnouncement'
                  data-track-name='feature-announcement-close'
                  onClick={() => void onDismiss()}
                  className='rounded-[8px] border border-border px-3 py-1 text-[13px] font-semibold text-foreground'
                >
                  Close
                </button>
              )
            ) : (
              <button
                type='button'
                data-testid='feature-announcement-next'
                data-track-category='FeatureAnnouncement'
                data-track-name='feature-announcement-next'
                onClick={() => setPageIndex(current => Math.min(current + 1, pages.length - 1))}
                className='rounded-[8px] bg-foreground px-3 py-1 text-[13px] font-semibold text-background'
              >
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
