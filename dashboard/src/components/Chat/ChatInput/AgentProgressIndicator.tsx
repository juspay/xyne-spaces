import { type CSSProperties, type ReactElement } from 'react';
import { useAgentProgress } from '../../../hooks/useAgentProgress';
import { AgentSpinner } from '../../ui/AgentSpinner';

const rowStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};

/**
 * Renders a transient "agent is working" pill next to the chat input.
 * Mirrors the shape of the typing indicator. No DB rows are created.
 * The spinner variant comes from the hook and rotates on each tool-label change.
 */
export function AgentProgressIndicator({
  sessionId,
}: {
  sessionId: string | undefined;
}): ReactElement | null {
  const agents = useAgentProgress(sessionId);
  if (agents.length === 0) return null;

  return (
    <div className='flex flex-wrap gap-3 px-1 py-0.5 text-[11px] text-muted-foreground'>
      {agents.map(a => (
        <span key={a.agentUserId ?? a.agentSlug ?? 'agent'} style={rowStyle}>
          <AgentSpinner variant={a.variant} size={12} />
          <span className='truncate max-w-[320px]'>
            {a.agentSlug ? <strong className='mr-1'>{a.agentSlug}</strong> : null}
            {a.toolLabel ?? 'working…'}
          </span>
        </span>
      ))}
    </div>
  );
}
