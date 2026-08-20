import React, { useContext, useState } from 'react';
import { MaximizeTwoArrow } from '@xyne/icons';
import type { AgentProfileProps, FlowComponent } from '@xyne/shared';
import { useFlow } from '../../FlowContext';
import { AuditLine, CardShell, Mention, StatusChip } from '../cardPrimitives';
import Avatar from '../../../ui/Avatar/Avatar';
import { AgentPreview, InsideAgentPreviewContext } from './AgentPreview';

/**
 * The `agent` artifact's PROFILE variant — a live agent described back to the
 * user ("what can this agent do?", "which agents review PRs?"). Read-only: no
 * capability selection and no decision controls.
 *
 * Presentation is a deliberate mirror of DraftAgentCard's created phase — same
 * inset panel, same chin, same expanded preview — so a listed agent and one the
 * user just created are visibly the same object. The two stay separate
 * components because the draft card is stateful and actionable (flow-state,
 * approve/decline) while this one is not; only the chrome is shared.
 */
export const ProfileAgentCard: React.FC<{ node: FlowComponent; props: AgentProfileProps }> = ({
  node,
  props,
}) => {
  const { conversationId, messageId } = useFlow();
  const insidePreview = useContext(InsideAgentPreviewContext);
  const [expanded, setExpanded] = useState(false);

  const statePill = <StatusChip label='Created' />;

  const auditNode = (
    <div className='flex min-w-0 items-center gap-1.5'>
      {props.agent.ownedById && (
        <Avatar userId={props.agent.ownedById} size='xs' rounded showActiveStatus={false} />
      )}
      <AuditLine>
        {props.agent.ownedBy ? (
          <>
            {'Created by '}
            <Mention handle={props.agent.ownedBy} />
          </>
        ) : props.agent.scope === 'global' ? (
          'Global agent'
        ) : (
          'No owner'
        )}
      </AuditLine>
    </div>
  );

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
          {!insidePreview && (
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
          )}
        </div>

        <div className='flex flex-col gap-3'>
          <div className='flex min-w-0 flex-col gap-1 pl-1'>
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
        {auditNode}
      </div>

      <AgentPreview
        open={expanded}
        onOpenChange={setExpanded}
        messageId={messageId ?? ''}
        agent={props.agent}
        note={props.note}
        statePill={statePill}
        footer={auditNode}
        conversationId={conversationId ?? undefined}
      />
    </CardShell>
  );
};
