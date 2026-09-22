import React, { useContext } from 'react';
import { Link } from 'react-router-dom';
import type { AgentProfileProps, FlowComponent } from '@xyne/shared';
import { AuditLine, CardShell, Mention, StatusChip } from '../cardPrimitives';
import Avatar from '../../../ui/Avatar/Avatar';
import { ChatWithAgentButton } from './ChatWithAgentButton';
import { InsideAgentPreviewContext } from './AgentPreview';

/**
 * The `agent` artifact's PROFILE variant — a live agent described back to the
 * user ("what can this agent do?", "which agents review PRs?"). Read-only: no
 * capability selection and no decision controls.
 *
 * Presentation is a deliberate mirror of DraftAgentCard's created phase — same
 * inset panel and chin — so a listed agent and one the
 * user just created are visibly the same object. The two stay separate
 * components because the draft card is stateful and actionable (flow-state,
 * approve/decline) while this one is not; only the chrome is shared.
 *
 * View opens the agent's detail page rather than a preview dialog: the page
 * shows persona, tools and keys in full, which the dialog only summarised.
 */
export const ProfileAgentCard: React.FC<{ node: FlowComponent; props: AgentProfileProps }> = ({
  node,
  props,
}) => {
  const insidePreview = useContext(InsideAgentPreviewContext);

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

  const footerNode = (
    <div className='flex w-full items-center justify-between gap-3'>
      {auditNode}
      <ChatWithAgentButton slug={props.agent.slug} />
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
            // The agent exists, so its detail page carries everything the
            // preview dialog only summarises.
            <Link
              to={`/ai/library/agent/${encodeURIComponent(props.agent.slug)}?tab=persona`}
              className='shrink-0 rounded-[10px] px-2 py-1 text-sm font-medium leading-5 !text-muted-foreground !no-underline transition-colors hover:bg-accent hover:!text-foreground'
              data-track-category='AGENT_ARTIFACT'
              data-track-name='VIEW_AGENT_FROM_CARD'
            >
              View
            </Link>
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
        {footerNode}
      </div>
    </CardShell>
  );
};
