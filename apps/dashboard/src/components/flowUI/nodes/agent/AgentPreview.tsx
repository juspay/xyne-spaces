import React, { createContext, useMemo } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useParams } from 'react-router-dom';
import { MultipleCrossCancelDefault } from '@xyne/icons';
import type { AgentIdentity } from '@xyne/shared';
import { PreviewSplitDialog, PreviewThreadPanel } from '../../../ui/PreviewSplitDialog';
import { MarkdownMessageRenderer } from '../../../ui/MessageBubble/MarkdownMessageRenderer';
import { createMarkdownComponents } from '../../../../utils/markdownComponents';
import { usePlatform } from '../../../../hooks/usePlatform';
import {
  AgentCapabilities,
  AgentConnectLinks,
  type AgentCapabilityInteraction,
} from './AgentIdentityBlock';

/**
 * True inside AgentPreview's right-hand thread panel. The thread re-renders the
 * SAME agent message as a live card, which would otherwise show its own expand
 * button and let the user stack a second full-screen preview on top. The agent
 * cards read this and hide their expand control when set.
 */
export const InsideAgentPreviewContext = createContext(false);

/**
 * AgentPreview — the EXPANDED agent view.
 *
 * The compact card only BRIEFS the agent (name, description, capability chips).
 * Expanding opens this split screen on the same shell the plan preview and the
 * attachment viewer use:
 *
 *   LEFT  → the whole agent: name, @slug, description, details, capabilities
 *           (the SAME selection state as the card — toggling here is the same
 *           edit), and the full system prompt rendered with the canonical
 *           MarkdownMessageRenderer chat uses.
 *   RIGHT → the live thread the card sits in.
 *
 * Rendered INSIDE the card, so it shares live flow props and the flow-action
 * round-trip; `footer` carries the phase-specific controls (pending →
 * Approve/Decline, decided → audit). On a decision the card closes this view so
 * the user drops back to the thread. On mobile the thread panel is dropped.
 */
interface AgentPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Stable id for markdown code-block keys (the card's message id). */
  messageId: string;
  agent: AgentIdentity;
  /** Present ⇒ capability chips are toggles here too. */
  interactive?: AgentCapabilityInteraction | undefined;
  note?: string | undefined;
  /** State pill shown beside the name (the card's own "Draft"/"Created" chip). */
  statePill?: React.ReactNode;
  /** Thread the card belongs to — rendered on the right. */
  conversationId?: string | undefined;
  /** Phase-specific controls shown in the left panel footer (actions / audit). */
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
        data-track-category='AGENT_ARTIFACT'
        data-track-name='CLOSE_AGENT_PREVIEW'
      >
        <MultipleCrossCancelDefault size={18} />
      </button>
    )}
  </div>
);

const DetailPanel: React.FC<{
  messageId: string;
  agent: AgentIdentity;
  interactive?: AgentCapabilityInteraction | undefined;
  note?: string | undefined;
  statePill?: React.ReactNode;
  footer?: React.ReactNode;
  onClose?: () => void;
}> = ({ messageId, agent, interactive, note, statePill, footer, onClose }) => {
  const markdownComponents = useMemo(
    () => createMarkdownComponents(messageId || 'agent-detail'),
    [messageId],
  );
  const details = agent.details ?? [];

  return (
    <div className='flex h-full flex-col bg-background'>
      <PanelHeader label='Agent' onClose={onClose} />
      <div className='flex-1 overflow-y-auto px-6 py-5'>
        <div className='mx-auto flex max-w-3xl flex-col gap-5'>
          <div className='flex min-w-0 flex-col gap-1'>
            <div className='flex items-center gap-2'>
              <h1 className='text-2xl font-medium leading-[1.2] text-foreground'>{agent.name}</h1>
              {statePill}
            </div>
            {/* Slug + model, matching the card's sub-line. */}
            <p className='flex min-w-0 items-center gap-2 text-sm leading-[22px]'>
              <span className='truncate text-blue-500 dark:text-blue-400'>@{agent.slug}</span>
              {agent.modelId && (
                <>
                  <span aria-hidden className='shrink-0 text-foreground/30'>
                    ·
                  </span>
                  <span className='truncate text-foreground/70'>{agent.modelId}</span>
                </>
              )}
            </p>
          </div>

          {/* Same "What it does" block as the card, one size up. */}
          {agent.description && (
            <div className='flex flex-col gap-1'>
              <h2 className='text-sm font-medium leading-[1.2] tracking-[-0.1px] text-foreground'>
                What it does
              </h2>
              <p className='text-sm leading-[22px] text-foreground/70'>{agent.description}</p>
            </div>
          )}

          {details.length > 0 && (
            <div className='flex flex-col gap-1.5 rounded-lg border border-border bg-muted/30 p-3'>
              {details.map(detail => (
                <div key={detail.label} className='flex items-baseline gap-3 text-sm leading-[1.4]'>
                  <span className='w-32 shrink-0 text-muted-foreground'>{detail.label}</span>
                  <span className='text-foreground/80'>{detail.value || '—'}</span>
                </div>
              ))}
            </div>
          )}

          {/* Same chips, same selection state as the compact card — a toggle here
              and a toggle there are one edit, not two views of it. */}
          <AgentCapabilities capabilities={agent.capabilities ?? []} interactive={interactive} />
          <AgentConnectLinks agent={agent} />
          {note && <p className='text-xs leading-[1.4] text-muted-foreground'>{note}</p>}

          {agent.systemPrompt && (
            <>
              <div className='h-px w-full bg-border' />
              <div className='flex flex-col gap-2'>
                <h2 className='text-sm font-medium leading-[1.2] text-foreground'>Instructions</h2>
                {/* The full prompt — this view is the reason the card doesn't
                    carry it inline. Same renderer the plan document uses. */}
                <MarkdownMessageRenderer
                  content={agent.systemPrompt}
                  markdownComponents={markdownComponents}
                />
              </div>
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

export const AgentPreview: React.FC<AgentPreviewProps> = ({
  open,
  onOpenChange,
  messageId,
  agent,
  interactive,
  note,
  statePill,
  conversationId,
  footer,
}) => {
  const { channelId } = useParams<{ channelId?: string }>();
  const { isMobile } = usePlatform();
  const close = (): void => onOpenChange(false);

  const detailPanel = (
    <>
      {/* Radix needs a Title/Description descendant of Dialog.Content (which the
          shared shell renders); keep them screen-reader only. */}
      <Dialog.Title className='sr-only'>{agent.name}</Dialog.Title>
      <Dialog.Description className='sr-only'>
        {agent.description ?? 'Agent details'}
      </Dialog.Description>
      <DetailPanel
        messageId={messageId}
        agent={agent}
        interactive={interactive}
        note={note}
        statePill={statePill}
        footer={footer}
        // Close button lives on the detail panel only when there is no thread
        // panel to carry it (mobile / no conversation) — matching the viewer.
        {...(isMobile || !conversationId ? { onClose: close } : {})}
      />
    </>
  );

  const threadPanel =
    isMobile || !conversationId ? undefined : (
      // Mark the thread subtree so the nested (same) agent card hides its own
      // expand button — no second full-screen preview stacked on top.
      <InsideAgentPreviewContext.Provider value={true}>
        <PreviewThreadPanel
          {...(channelId ? { channelId } : {})}
          conversationId={conversationId}
          onClose={close}
        />
      </InsideAgentPreviewContext.Provider>
    );

  // Same shell as the plan preview and the attachment viewer — only the left
  // panel's content differs.
  return (
    <PreviewSplitDialog
      open={open}
      onClose={close}
      idPrefix='agent-preview'
      isMobile={isMobile}
      left={detailPanel}
      right={threadPanel}
      overlayClassName='bg-black/80'
      contentClassName='bg-black data-[state=closed]:fade-out transition-all ease-in-out duration-300 data-[state=open]:fade-in'
      bodyClassName='bg-background'
    />
  );
};
