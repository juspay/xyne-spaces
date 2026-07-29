import React, { useMemo, createContext } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { PreviewSplitDialog, PreviewThreadPanel } from '../../ui/PreviewSplitDialog';
import { useParams } from 'react-router-dom';
import { MultipleCrossCancelDefault } from '@xyne/icons';
import { MarkdownMessageRenderer } from '../../ui/MessageBubble/MarkdownMessageRenderer';
import { createMarkdownComponents } from '../../../utils/markdownComponents';
import { usePlatform } from '../../../hooks/usePlatform';

/**
 * True inside PlanPreview's right-hand thread panel. The thread re-renders the
 * SAME plan message as a live card, which would otherwise show its own Maximize
 * button and let the user stack a second full-screen preview on top. PlanNode
 * reads this and hides its Maximize when set, so the nested stack is unreachable.
 */
export const InsidePlanPreviewContext = createContext(false);

/**
 * PlanPreview — the EXPANDED plan view.
 *
 * The compact plan card (PlanNode) only BRIEFS the plan (title + short todos).
 * Expanding opens this split screen — modeled on the Spaces attachment preview
 * (left = the artifact, right = the thread), but a SEPARATE component so the two
 * can evolve independently:
 *
 *   LEFT  → the todo checklist (`todos`, the same selection state as the card)
 *           above the detailed plan `document` (agent-authored markdown), rendered
 *           with the same canonical MarkdownMessageRenderer chat uses. The document
 *           is shown only when present.
 *   RIGHT → the live thread (ThreadMessages), the same conversation the card is in.
 *
 * Rendered INSIDE PlanNode, so it shares the live flow props (document/phase/todos
 * update live) and the flow-action round-trip. `footer` carries the phase-specific
 * controls (proposed → Approve/Reject; executing/done → audit + progress); on a
 * decision PlanNode closes this view (`onOpenChange(false)`) so the user drops back
 * to the thread. On mobile the thread panel is dropped (document only), mirroring
 * the attachment viewer.
 */
interface PlanPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Stable id for markdown code-block keys (the plan message id). */
  messageId: string;
  title: string;
  desc?: string | undefined;
  /** Detailed markdown plan (agent-authored). Rendered below the todo checklist
   *  when present; omitted when absent. */
  document?: string | undefined;
  /** Thread the card belongs to — rendered on the right. */
  conversationId?: string | undefined;
  /** Phase-specific controls shown in the left panel footer (actions / audit). */
  footer?: React.ReactNode;
  /** The todo checklist — the SAME selection state as the compact card (radios for
   *  proposed, status rows for executing/done). Shown above the document. */
  todos?: React.ReactNode;
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
        data-track-category='PLAN_ARTIFACT'
        data-track-name='CLOSE_PLAN_PREVIEW'
      >
        <MultipleCrossCancelDefault size={18} />
      </button>
    )}
  </div>
);

const DocumentPanel: React.FC<{
  messageId: string;
  title: string;
  desc?: string | undefined;
  document?: string | undefined;
  todos?: React.ReactNode;
  footer?: React.ReactNode;
  onClose?: () => void;
}> = ({ messageId, title, desc, document, todos, footer, onClose }) => {
  const markdownComponents = useMemo(
    () => createMarkdownComponents(messageId || 'plan-document'),
    [messageId],
  );
  return (
    <div className='flex h-full flex-col bg-background'>
      <PanelHeader label='Plan' onClose={onClose} />
      <div className='flex-1 overflow-y-auto px-6 py-5'>
        <div className='mx-auto flex max-w-3xl flex-col gap-5'>
          <div className='flex flex-col gap-1'>
            <h1 className='text-2xl font-semibold leading-[1.2] text-foreground'>{title}</h1>
            {desc && (
              <p className='text-sm leading-[1.5] tracking-[-0.15px] text-foreground/70'>{desc}</p>
            )}
          </div>
          {/* The interactive checklist (same selection state as the compact card) — shown
              up top so it's the first thing on open, mirroring the plan node. */}
          {todos}
          {document && (
            <>
              <div className='h-px w-full bg-border' />
              <MarkdownMessageRenderer content={document} markdownComponents={markdownComponents} />
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

export const PlanPreview: React.FC<PlanPreviewProps> = ({
  open,
  onOpenChange,
  messageId,
  title,
  desc,
  document,
  conversationId,
  footer,
  todos,
}) => {
  const { channelId } = useParams<{ channelId?: string }>();
  const { isMobile } = usePlatform();
  const close = (): void => onOpenChange(false);

  const documentPanel = (
    <>
      {/* Radix needs a Title/Description descendant of Dialog.Content (which the
          shared shell renders); keep them screen-reader only. */}
      <Dialog.Title className='sr-only'>{title}</Dialog.Title>
      <Dialog.Description className='sr-only'>{desc ?? 'Plan details'}</Dialog.Description>
      <DocumentPanel
        messageId={messageId}
        title={title}
        desc={desc}
        document={document}
        todos={todos}
        footer={footer}
        // Close button lives on the document panel only when there is no thread
        // panel to carry it (mobile / no conversation) — matching the viewer.
        {...(isMobile || !conversationId ? { onClose: close } : {})}
      />
    </>
  );

  const threadPanel =
    isMobile || !conversationId ? undefined : (
      // Mark the thread subtree so the nested (same) plan card hides its own
      // Maximize — no second full-screen preview stacked on top.
      <InsidePlanPreviewContext.Provider value={true}>
        <PreviewThreadPanel
          {...(channelId ? { channelId } : {})}
          conversationId={conversationId}
          onClose={close}
        />
      </InsidePlanPreviewContext.Provider>
    );

  // Same shell as the attachment viewer (FileViewerModal) — only the panels differ:
  // the plan document takes the place of the attachment.
  return (
    <PreviewSplitDialog
      open={open}
      onClose={close}
      idPrefix='plan-preview'
      isMobile={isMobile}
      left={documentPanel}
      right={threadPanel}
      // Identical chrome to the attachment viewer: same 70/30 split (shell defaults),
      // same overlay darkness and dark content frame. Only the panels' content differs.
      overlayClassName='bg-black/80'
      contentClassName='bg-black data-[state=closed]:fade-out transition-all ease-in-out duration-300 data-[state=open]:fade-in'
      bodyClassName='bg-background'
    />
  );
};
