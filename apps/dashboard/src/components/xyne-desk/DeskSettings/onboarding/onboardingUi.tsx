import React from 'react';
import { Paperclip } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../../../utils/classNames';
import { createPreviewUrl } from '../../../../services/clients/fileFetchService';
import type {
  OnboardingAttachment,
  OnboardingAttempt,
  OnboardingAttemptStatus,
} from '../../../../services/clients/onboardingApi';

export const secondaryButtonClass =
  'inline-flex items-center gap-1.5 rounded-[10px] border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-sm hover:bg-muted/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-desk-accent disabled:cursor-not-allowed disabled:opacity-50';

export const primaryButtonClass =
  'inline-flex items-center gap-1.5 rounded-[10px] border border-desk-accent bg-desk-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:opacity-90 focus:outline-none focus-visible:ring-1 focus-visible:ring-desk-accent disabled:cursor-not-allowed disabled:opacity-50';

export const dangerButtonClass =
  'inline-flex items-center gap-1.5 rounded-[10px] border border-red-500 bg-red-500 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-red-600 disabled:opacity-50';

export const iconButtonClass =
  'flex h-7 w-7 items-center justify-center rounded-[8px] text-muted-foreground hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-desk-accent disabled:cursor-not-allowed disabled:opacity-40';

export const inputClass =
  'w-full rounded-[10px] border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-desk-accent disabled:cursor-not-allowed disabled:opacity-50';

/** "12m 04s", "1h 03m". */
export function formatDuration(totalSeconds: number | null | undefined): string {
  if (typeof totalSeconds !== 'number') return '—';
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

export function formatScore(
  attempt: Pick<OnboardingAttempt, 'totalScore' | 'maxScore'> | undefined,
): string {
  if (!attempt || attempt.totalScore === null || !attempt.maxScore) return '—';
  return `${attempt.totalScore}/${attempt.maxScore}`;
}

export function scoreRatio(attempt: Pick<OnboardingAttempt, 'totalScore' | 'maxScore'>): number {
  return attempt.maxScore ? (attempt.totalScore ?? 0) / attempt.maxScore : 0;
}

const STATUS_LABEL: Record<OnboardingAttemptStatus, string> = {
  IN_PROGRESS: 'In progress',
  GRADING: 'Grading',
  GRADED: 'Graded',
  FAILED: 'Grading failed',
};

const STATUS_CLASS: Record<OnboardingAttemptStatus, string> = {
  IN_PROGRESS: 'bg-accent text-foreground',
  GRADING: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  GRADED: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  FAILED: 'bg-red-500/15 text-red-700 dark:text-red-300',
};

export const AttemptStatusPill: React.FC<{ status: OnboardingAttemptStatus }> = ({ status }) => (
  <span
    className={cn(
      'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium',
      STATUS_CLASS[status],
    )}
  >
    {STATUS_LABEL[status]}
  </span>
);

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Types that are safe to show in a new tab. A blob URL runs on the dashboard's own origin, so
 * anything that can carry script (HTML, SVG, XML, …) from a customer's email is downloaded instead.
 */
const INLINE_SAFE_MIMETYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
]);

/** Opens (safe types) or downloads an email attachment through the normal attachment access checks. */
export const AttachmentList: React.FC<{ attachments: OnboardingAttachment[] }> = ({
  attachments,
}) => {
  if (attachments.length === 0) return null;

  const open = async (attachment: OnboardingAttachment): Promise<void> => {
    const inline = INLINE_SAFE_MIMETYPES.has(attachment.mimetype.toLowerCase());
    // Open the tab during the click, before the download, or the browser blocks it as a popup.
    const tab = inline ? window.open('', '_blank') : null;
    if (tab) tab.opener = null;
    try {
      const blob = await createPreviewUrl(attachment.id);
      const url = URL.createObjectURL(
        new Blob([blob], { type: inline ? attachment.mimetype : 'application/octet-stream' }),
      );
      if (tab) {
        tab.location.href = url;
      } else {
        const link = document.createElement('a');
        link.href = url;
        link.download = attachment.filename;
        link.rel = 'noopener';
        link.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      tab?.close();
      toast.error(`Couldn't open ${attachment.filename}`);
    }
  };

  return (
    <div className='flex flex-wrap gap-2'>
      {attachments.map(attachment => (
        <button
          key={attachment.id}
          type='button'
          onClick={() => void open(attachment)}
          className='inline-flex max-w-[260px] items-center gap-1.5 rounded-[8px] border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-muted/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-desk-accent'
          title={attachment.filename}
          data-track-category='DeskSettings'
          data-track-name='OnboardingOpenAttachment'
        >
          <Paperclip size={12} className='shrink-0 text-muted-foreground' />
          <span className='truncate'>{attachment.filename}</span>
          <span className='shrink-0 text-muted-foreground'>{formatBytes(attachment.size)}</span>
        </button>
      ))}
    </div>
  );
};

export const EmptyState: React.FC<{ title: string; children?: React.ReactNode }> = ({
  title,
  children,
}) => (
  <div className='flex flex-col items-start gap-1 rounded-[12px] border border-dashed border-desk-border px-5 py-6 dark:border-border'>
    <div className='text-sm font-medium text-foreground'>{title}</div>
    {children && <div className='text-desk-helper'>{children}</div>}
  </div>
);
