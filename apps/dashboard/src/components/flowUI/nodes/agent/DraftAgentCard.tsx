import React, { useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MaximizeTwoArrow, Spinner } from '@xyne/icons';
import type { AgentDraftProps, FlowComponent } from '@xyne/shared';
import { useFlow } from '../../FlowContext';
import { cn } from '../../../../utils/classNames';
import { AuditLine, CardShell, Mention, StatusChip } from '../cardPrimitives';
import Avatar from '../../../ui/Avatar/Avatar';
import { AgentPreview, InsideAgentPreviewContext } from './AgentPreview';
import { ChatWithAgentButton } from './ChatWithAgentButton';
import { AgentCreateFooter } from './create/AgentCreateFooter';
import { DiscardDraftDialog } from './create/DiscardDraftDialog';
import { formFromIdentity, patchFromIdentity } from './create/canvasFromIdentity';
import { toCanvasValue } from './create/types';
import { useAgentCreateForm } from './create/useAgentCreateForm';
import { useAgentCreateSession } from './create/AgentCreateSessionContext';
import { useAgentNameCheck } from '../../../../hooks/useAgentNameCheck';
import { slugify } from '../../../../routes/ClawAgentsScreen/create/wizardState';
import { useDraftAgentEditor } from './useDraftAgentEditor';

/**
 * The `agent` artifact's DRAFT variant — an agent an agent proposed, awaiting
 * the requester's decision.
 *
 * Compact thread card briefs the pending agent. Expand opens AgentPreview with
 * chat left / whole-agent canvas right. Create Agent lives on the preview
 * sticky footer; the nested thread card is a brief only.
 */
export const DraftAgentCard: React.FC<{ node: FlowComponent; props: AgentDraftProps }> = ({
  node,
  props,
}) => {
  const { state, updateFieldValue, executeAction, conversationId, messageId } = useFlow();
  const [pending, setPending] = useState<'approve' | 'reject' | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const insidePreview = useContext(InsideAgentPreviewContext);
  const createSession = useAgentCreateSession();

  const decided = props.phase !== 'pending';
  const createForm = useAgentCreateForm(formFromIdentity(props.agent));
  const editor = useDraftAgentEditor(props, node.id);

  useEffect(() => {
    if (createSession && props.phase === 'pending') {
      createSession.applyChatDraft(messageId, patchFromIdentity(props.agent));
    }
  }, [createSession, messageId, props.agent, props.phase]);

  useEffect(() => {
    if (insidePreview || decided) return;
    updateFieldValue(node.id, toCanvasValue(createForm.form));
  }, [createForm.form, decided, insidePreview, node.id, updateFieldValue]);

  const slug = createForm.form.slugManual
    ? createForm.form.slug
    : slugify(createForm.form.name) || createForm.form.slug;
  const nameCheck = useAgentNameCheck(decided ? '' : createForm.form.name.trim(), slug);
  const handleError = nameCheck.slugError
    ? `@${slug} is taken. Rename the handle to create a new agent.`
    : nameCheck.nameError;

  const locked = state.submitting || decided || pending !== null;

  const submit = async (actionId: 'agent-draft-approve' | 'agent-draft-decline'): Promise<void> => {
    if (locked) {
      return;
    }
    setCreateError(null);
    setPending(actionId === 'agent-draft-approve' ? 'approve' : 'reject');
    try {
      updateFieldValue(node.id, toCanvasValue({ ...createForm.form, slug }));
      const response = await executeAction({
        type: 'submit',
        actionId,
      });
      if (response?.type === 'error') {
        setCreateError(
          response.message ||
            `Couldn't create @${slug}. Check the handle is unique and try Create Agent again. Your draft is still here.`,
        );
        setExpanded(true);
        return;
      }
      setExpanded(false);
    } finally {
      setPending(null);
    }
  };

  const requestDiscard = (): void => {
    if (createForm.canvasDirty) {
      setDiscardOpen(true);
      return;
    }
    void submit('agent-draft-decline');
  };

  const statePill =
    props.phase === 'created' ? (
      <StatusChip label='Created' />
    ) : props.phase === 'rejected' ? (
      <StatusChip label='Declined' tone='rejected' />
    ) : (
      <StatusChip label='Draft' tone='muted' />
    );

  const auditNode = (
    <div className='flex min-w-0 items-center gap-1.5'>
      {props.decidedById && (
        <Avatar userId={props.decidedById} size='xs' rounded showActiveStatus={false} />
      )}
      <AuditLine>
        {props.phase === 'created' ? 'Created' : 'Declined'}
        {props.decidedBy && (
          <>
            {' by '}
            <Mention handle={props.decidedBy} />
          </>
        )}
      </AuditLine>
    </div>
  );

  const decidedFooter = (
    <div className='flex w-full items-center justify-between gap-3'>
      {auditNode}
      {props.phase === 'created' && <ChatWithAgentButton slug={props.agent.slug} />}
    </div>
  );

  const approveLabel = pending === 'approve' ? 'Creating…' : 'Create Agent';

  const ghostButton = cn(
    'inline-flex h-7 items-center gap-1.5 rounded-[10px] px-1.5',
    'text-sm font-semibold leading-5 text-foreground',
    'hover:bg-foreground/[0.04] disabled:cursor-not-allowed disabled:opacity-60',
  );
  const primaryButton = cn(
    'inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-background px-1.5',
    'text-sm font-semibold leading-5 text-foreground',
    'hover:bg-foreground/[0.04] disabled:cursor-not-allowed disabled:opacity-60',
  );

  const canCreate =
    createForm.form.name.trim().length > 0 &&
    slug.length > 0 &&
    createForm.form.systemPrompt.trim().length > 0 &&
    !nameCheck.checking &&
    nameCheck.nameValid &&
    createForm.conflicts.length === 0;

  const compactActions = (
    <div className='flex w-full items-center justify-end gap-3'>
      <div className='flex shrink-0 items-center gap-2'>
        <button
          type='button'
          onClick={requestDiscard}
          disabled={locked}
          className={cn(ghostButton, 'px-2.5')}
          data-track-category='AGENT_ARTIFACT'
          data-track-name='CLICK_DECLINE'
          data-ph-capture-attribute-track-id='agent_draft_decline'
        >
          {pending === 'reject' && <Spinner size={14} className='animate-spin' />}
          {pending === 'reject' ? 'Declining…' : 'Decline'}
        </button>
        <button
          type='button'
          onClick={() => void submit('agent-draft-approve')}
          disabled={locked || !canCreate}
          className={cn(primaryButton, 'px-2.5')}
          data-track-category='AGENT_ARTIFACT'
          data-track-name='CLICK_APPROVE'
          data-ph-capture-attribute-track-id='agent_draft_approve'
        >
          {pending === 'approve' && <Spinner size={14} className='animate-spin' />}
          {approveLabel}
        </button>
      </div>
    </div>
  );

  const previewFooter = decided ? (
    decidedFooter
  ) : (
    <AgentCreateFooter
      phase='pending'
      canCreate={canCreate}
      creating={pending === 'approve' || state.submitting}
      discarding={pending === 'reject'}
      onCreate={() => void submit('agent-draft-approve')}
      onDiscard={requestDiscard}
      createError={createError}
    />
  );

  const createPhase =
    props.phase === 'created' ? 'created' : props.phase === 'rejected' ? 'rejected' : 'draft';

  return (
    <CardShell style={node.style}>
      <div className='flex flex-col gap-4 rounded-b-[11px] border-b border-border bg-card/80 p-3'>
        <div className='flex h-6 items-center gap-1.5 pl-1'>
          <div className='flex min-w-0 flex-1 items-center gap-1.5'>
            <span className='text-sm font-semibold leading-5 tracking-[-0.5px] text-muted-foreground'>
              Agent
            </span>
            {statePill}
          </div>
          {!insidePreview &&
            (props.phase === 'created' ? (
              <Link
                to={`/ai/library/agent/${encodeURIComponent(props.agent.slug)}?tab=persona`}
                className='shrink-0 rounded-[10px] px-2 py-1 text-sm font-medium leading-5 !text-muted-foreground !no-underline transition-colors hover:bg-accent hover:!text-foreground'
                data-track-category='AGENT_ARTIFACT'
                data-track-name='VIEW_AGENT_FROM_DRAFT_CARD'
              >
                View
              </Link>
            ) : (
              <button
                type='button'
                onClick={(): void => setExpanded(true)}
                aria-label='Expand agent'
                className='shrink-0 rounded-[10px] p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
                data-track-category='AGENT_ARTIFACT'
                data-track-name='EXPAND_ARTIFACT'
              >
                <MaximizeTwoArrow size={16} className='shrink-0' />
              </button>
            ))}
        </div>

        <div className='flex flex-col gap-3'>
          <div className='flex min-w-0 flex-col pl-1 gap-1'>
            <p className='break-words text-sm font-semibold leading-5 text-foreground'>
              {props.agent.name}
            </p>
            <span className='block truncate text-sm font-normal leading-5 tracking-[-0.07px] text-foreground'>
              @{props.agent.slug}
            </span>
          </div>

          {props.agent.description && (
            <div className='flex min-w-0 flex-col gap-1 px-1'>
              <p className='truncate text-sm font-semibold leading-5 text-foreground'>
                Description
              </p>
              <span className='block break-words text-sm font-normal leading-5 tracking-[-0.07px] text-foreground'>
                {props.agent.description}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className='flex min-h-[44px] items-center justify-between gap-3 px-3 py-2'>
        {decided ? decidedFooter : insidePreview ? null : compactActions}
      </div>

      {!insidePreview && (
        <AgentPreview
          open={expanded}
          onOpenChange={setExpanded}
          messageId={messageId ?? ''}
          agent={props.agent}
          editor={editor}
          note={props.note}
          statePill={statePill}
          conversationId={conversationId ?? undefined}
          footer={previewFooter}
          mode='create'
          createForm={createForm}
          createPhase={createPhase}
          handleError={handleError}
          checkingHandle={nameCheck.checking}
          builtBy={props.agent.builtBy}
        />
      )}

      <DiscardDraftDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onConfirm={() => {
          setDiscardOpen(false);
          void submit('agent-draft-decline');
        }}
      />
    </CardShell>
  );
};
