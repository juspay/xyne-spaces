import React, { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useDraftAttachments } from '../../hooks/useDraft';
import {
  useAttachmentUpload,
  batchLabel,
  batchPercent,
  batchRoute,
} from '../../store/useAttachmentUploadStore';

/**
 * Upload progress for chat attachments, shown as a toast.
 *
 * Renders no markup of its own: it is a synchroniser that mirrors the upload store into
 * sonner. Toasts are imperative and sonner keys them by id, so re-issuing under a batch's
 * id updates that toast in place rather than stacking a new one.
 *
 * Built on sonner's title/description API rather than `toast.custom`. The Toaster in App.tsx
 * already dresses every toast — card background, border, padding, the error icon, title and
 * description typography, the close button — and a custom body only ends up drawing a second
 * card inside that one. Only the description is ours, because a progress bar has no
 * equivalent in the standard API.
 *
 * Progress comes from the store for the same reason the pill uses it: the DB records
 * PENDING and FAILED but never a percentage.
 */

/** Sonner would otherwise auto-dismiss these mid-upload. */
const STICKY = { duration: Infinity } as const;

const ProgressDescription = ({ percent }: { percent: number }): React.JSX.Element => (
  <div className='mt-1 flex items-center gap-2'>
    <div className='h-1 flex-1 overflow-hidden rounded-full bg-muted'>
      <div
        className='h-full rounded-full bg-primary transition-[width] duration-300 ease-out motion-reduce:transition-none'
        style={{ width: `${percent}%` }}
      />
    </div>
    <span className='shrink-0 text-[11px] font-semibold leading-4 tabular-nums'>{percent}%</span>
  </div>
);

const FailedDescription = ({
  onRetry,
  onOpen,
  onDismiss,
}: {
  onRetry: () => void;
  onOpen: () => void;
  onDismiss: () => void;
}): React.JSX.Element => (
  // Inline rather than sonner's `action` prop: the global actionButton class carries an
  // !mt-8 sized for taller toasts, which on a two-line one leaves a large empty gap.
  <div className='mt-1 flex items-center gap-2'>
    <button
      type='button'
      onClick={onRetry}
      className='rounded-md bg-primary px-2 py-0.5 text-[11px] font-semibold leading-4 text-primary-foreground transition-opacity hover:opacity-90'
      data-track-category='CHAT_ATTACHMENT_UPLOAD'
      data-track-name='Retry_Upload_Toast'
    >
      Retry
    </button>
    <button
      type='button'
      onClick={onOpen}
      className='rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 underline-offset-2 hover:underline'
      data-track-category='CHAT_ATTACHMENT_UPLOAD'
      data-track-name='Open_Upload_Toast_Chat'
    >
      Open chat
    </button>
    {/* The toast carries no close button and never auto-dismisses, so without this a
        failed upload would sit on screen for the rest of the session. */}
    <button
      type='button'
      onClick={onDismiss}
      className='rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 underline-offset-2 hover:underline'
      data-track-category='CHAT_ATTACHMENT_UPLOAD'
      data-track-name='Dismiss_Upload_Toast'
    >
      Dismiss
    </button>
  </div>
);

export const AttachmentUploadToast = (): null => {
  const navigate = useNavigate();
  const { retryUpload, dismissUpload } = useDraftAttachments();
  const batches = useAttachmentUpload(s => s.batches);

  // What each batch's toast currently shows. Re-issuing a toast whose content has not
  // changed makes sonner restart its animation, which on a fast upload reads as a flicker,
  // so a batch is only re-rendered when its rounded percentage or status actually moves.
  const renderedRef = useRef(new Map<string, string>());

  useEffect(() => {
    const rendered = renderedRef.current;
    const live = new Set(Object.keys(batches));

    for (const batchId of [...rendered.keys()]) {
      if (!live.has(batchId)) {
        toast.dismiss(batchId);
        rendered.delete(batchId);
      }
    }

    for (const batch of Object.values(batches)) {
      const failed = batch.status === 'failed';
      const percent = batchPercent(batch);
      const signature = failed ? 'failed' : `uploading:${percent}`;
      if (rendered.get(batch.batchId) === signature) continue;
      rendered.set(batch.batchId, signature);

      // closeButton:false overrides the Toaster's global one. The uploading toast clears
      // itself when the upload lands, and the failed one offers Dismiss below, so a cross
      // would only invite closing a live upload out of view.
      //
      // sonner styles [data-content] as a bare `display:flex; flex-direction:column`, with
      // no flex-grow, so it shrink-wraps its widest child — the title. With a short title
      // like "Uploading 4 files" the progress bar inherits that narrow box and stops well
      // short of the toast edge. flex-1 makes the column claim the row; min-w-0 lets the
      // title still truncate inside it rather than forcing the toast wider.
      const options = {
        id: batch.batchId,
        closeButton: false,
        classNames: { content: 'flex-1 min-w-0' },
        ...STICKY,
      };

      if (failed) {
        toast.error(`${batchLabel(batch)} failed to upload`, {
          ...options,
          description: (
            <FailedDescription
              onRetry={() => void retryUpload(batch.batchId)}
              onOpen={() => void navigate(batchRoute(batch))}
              onDismiss={() => dismissUpload(batch.batchId)}
            />
          ),
        });
      } else {
        // toast.loading supplies sonner's own spinner, matching every other pending toast.
        toast.loading(`Uploading ${batchLabel(batch)}`, {
          ...options,
          description: <ProgressDescription percent={percent} />,
        });
      }
    }
  }, [batches, navigate, retryUpload, dismissUpload]);

  // Clear anything still on screen if this unmounts, so a toast cannot outlive the store.
  useEffect(() => {
    const rendered = renderedRef.current;
    return () => {
      for (const batchId of rendered.keys()) toast.dismiss(batchId);
      rendered.clear();
    };
  }, []);

  return null;
};

export default AttachmentUploadToast;
