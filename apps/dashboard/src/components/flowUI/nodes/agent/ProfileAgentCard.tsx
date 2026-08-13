import React, { useContext, useState } from 'react';
import { MaximizeFourArrow } from '@xyne/icons';
import type { AgentProfileProps, FlowComponent } from '@xyne/shared';
import { useFlow } from '../../FlowContext';
import { CardShell } from '../cardPrimitives';
import { AgentIdentityBlock, AgentConnectPrompt } from './AgentIdentityBlock';
import { AgentPreview, InsideAgentPreviewContext } from './AgentPreview';

/**
 * The `agent` artifact's PROFILE variant — a live agent described back to the
 * user ("what can this agent do?"). Read-only: no selection, no footer, and no
 * state pill (a live agent isn't in a state worth calling out).
 *
 * Same identity block and the same expanded view as the draft card, so an agent
 * looks and reads the same before and after it exists — only the affordances
 * differ. Its content is built server-side from the agent's row, never from text
 * a model supplied.
 */
export const ProfileAgentCard: React.FC<{ node: FlowComponent; props: AgentProfileProps }> = ({
  node,
  props,
}) => {
  const { conversationId, messageId } = useFlow();
  const insidePreview = useContext(InsideAgentPreviewContext);
  const [expanded, setExpanded] = useState(false);

  return (
    <CardShell style={node.style}>
      <div className='flex flex-col p-4'>
        <AgentIdentityBlock
          agent={props.agent}
          note={props.note}
          trailing={
            insidePreview ? undefined : (
              <button
                type='button'
                onClick={(): void => setExpanded(true)}
                aria-label='Expand agent'
                className='shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
                data-track-category='AGENT_ARTIFACT'
                data-track-name='EXPAND_ARTIFACT'
              >
                <MaximizeFourArrow size={16} className='shrink-0' />
              </button>
            )
          }
        />
      </div>

      {/* A profile card always describes a live agent, so its link goes straight
          to that agent's Connections tab. */}
      <AgentConnectPrompt
        agent={props.agent}
        agentExists
        className='border-t border-border bg-foreground/[0.03] px-4 py-3'
      />

      <AgentPreview
        open={expanded}
        onOpenChange={setExpanded}
        messageId={messageId ?? ''}
        agent={props.agent}
        note={props.note}
        conversationId={conversationId ?? undefined}
      />
    </CardShell>
  );
};
