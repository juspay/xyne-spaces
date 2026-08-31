import React, { useMemo, createContext } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useParams } from 'react-router-dom';
import { MultipleCrossCancelDefault } from '@xyne/icons';
import { PreviewSplitDialog, PreviewThreadPanel } from '../../ui/PreviewSplitDialog';
import { MarkdownMessageRenderer } from '../../ui/MessageBubble/MarkdownMessageRenderer';
import { createMarkdownComponents } from '../../../utils/markdownComponents';
import { usePlatform } from '../../../hooks/usePlatform';

/**
 * True inside PrPreview's right-hand thread panel. The thread re-renders the SAME
 * PR card, which would otherwise show its own "View Details" button and let the
 * user stack a second full-screen preview on top. PrNode reads this and hides the
 * button (and skips mounting a nested PrPreview) when set. Mirrors
 * InsidePlanPreviewContext.
 */
export const InsidePrPreviewContext = createContext(false);

/**
 * PrPreview — the EXPANDED "View Details" view for a PR card.
 *
 * The compact PR card (PrNode) only briefs the PR (status badge + title + a
 * clamped description). "View Details" opens THIS split screen — the SAME shell
 * as the plan preview / attachment viewer (PreviewSplitDialog), only the content
 * area differs:
 *
 *   LEFT  → the PR detail (status badge + ticketId/title + the full description
 *           rendered with the canonical MarkdownMessageRenderer chat uses), with
 *           the PR/ticket links in the footer.
 *   RIGHT → the live thread (PreviewThreadPanel), the same conversation the card
 *           is in.
 *
 * The status badge and the footer links are passed in as already-rendered nodes
 * (`badge` / `footer`) so this file stays free of PrNode's status→colour /
 * provider→label maps — exactly how PlanPreview receives `todos` / `footer`. On
 * mobile / when there's no conversation, the thread panel is dropped (detail
 * only), mirroring the plan preview and the attachment viewer.
 */
interface PrPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Stable id for markdown code-block keys (the PR card message id). */
  messageId: string;
  title: string;
  ticketId?: string | undefined;
  /** PR description (agent-authored markdown). Rendered below the heading. */
  desc?: string | undefined;
  /** Thread the card belongs to — rendered on the right. */
  conversationId?: string | undefined;
  /** Status badge, rendered by PrNode (owns the status→colour map). */
  badge?: React.ReactNode;
  /** PR / ticket link buttons, rendered by PrNode (owns the provider→label map). */
  footer?: React.ReactNode;
}

const PanelHeader: React.FC<{ label: string; onClose?: (() => void) | undefined }> = ({
  label,
  onClose,
}) => (
  <div className='flex h-14 flex-shrink-0 items-center justify-between border-b border-border px-5'>
    <span className='font-mono text-sm leading-[18px] tracking-[0.2px] text-muted-foreground'>
      {label}
    </span>
    {onClose && (
      <button
        type='button'
        onClick={onClose}
        aria-label='Close'
        className='rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
        data-track-category='PR_ARTIFACT'
        data-track-name='CLOSE_PR_PREVIEW'
      >
        <MultipleCrossCancelDefault size={18} />
      </button>
    )}
  </div>
);

const DetailPanel: React.FC<{
  messageId: string;
  title: string;
  ticketId?: string | undefined;
  desc?: string | undefined;
  badge?: React.ReactNode;
  footer?: React.ReactNode;
  onClose?: () => void;
}> = ({ messageId, title, ticketId, desc, badge, footer, onClose }) => {
  const markdownComponents = useMemo(
    () => createMarkdownComponents(messageId || 'pr-detail'),
    [messageId],
  );
  return (
    <div className='flex h-full flex-col bg-background'>
      <PanelHeader label='Pull Request' onClose={onClose} />
      <div className='flex-1 overflow-y-auto px-6 py-5'>
        <div className='mx-auto flex max-w-3xl flex-col gap-5'>
          {badge && <div>{badge}</div>}
          <h1 className='text-2xl font-semibold leading-[1.2] text-foreground'>
            {ticketId && <span className='text-muted-foreground'>{ticketId} </span>}
            {title}
          </h1>
          {desc && (
            <>
              <div className='h-px w-full bg-border' />
              <MarkdownMessageRenderer content={desc} markdownComponents={markdownComponents} />
            </>
          )}
        </div>
      </div>
      {footer && (
        <div className='flex-shrink-0 border-t border-border bg-foreground/[0.03] px-6 py-3'>
          {footer}
        </div>
      )}
    </div>
  );
};

export const PrPreview: React.FC<PrPreviewProps> = ({
  open,
  onOpenChange,
  messageId,
  title,
  ticketId,
  desc,
  conversationId,
  badge,
  footer,
}) => {
  const { channelId } = useParams<{ channelId?: string }>();
  const { isMobile } = usePlatform();
  const close = (): void => onOpenChange(false);

  const detailPanel = (
    <>
      {/* Radix needs a Title/Description descendant of Dialog.Content (rendered by
          the shared shell); keep them screen-reader only. */}
      <Dialog.Title className='sr-only'>{ticketId ? `${ticketId} ${title}` : title}</Dialog.Title>
      <Dialog.Description className='sr-only'>{desc ?? 'Pull request details'}</Dialog.Description>
      <DetailPanel
        messageId={messageId}
        title={title}
        ticketId={ticketId}
        desc={desc}
        badge={badge}
        footer={footer}
        // Close lives on the detail panel only when there's no thread panel to
        // carry it (mobile / no conversation) — matching the plan preview.
        {...(isMobile || !conversationId ? { onClose: close } : {})}
      />
    </>
  );

  const threadPanel =
    isMobile || !conversationId ? undefined : (
      // Mark the thread subtree so the nested (same) PR card hides its own
      // "View Details" — no second full-screen preview stacked on top.
      <InsidePrPreviewContext.Provider value={true}>
        <PreviewThreadPanel
          {...(channelId ? { channelId } : {})}
          conversationId={conversationId}
          onClose={close}
        />
      </InsidePrPreviewContext.Provider>
    );

  // Same shell as the plan preview / attachment viewer — only the left content differs.
  return (
    <PreviewSplitDialog
      open={open}
      onClose={close}
      idPrefix='pr-preview'
      isMobile={isMobile}
      left={detailPanel}
      right={threadPanel}
      overlayClassName='bg-black/80'
      contentClassName='bg-black data-[state=closed]:fade-out transition-all ease-in-out duration-300 data-[state=open]:fade-in'
      bodyClassName='bg-background'
    />
  );
};
