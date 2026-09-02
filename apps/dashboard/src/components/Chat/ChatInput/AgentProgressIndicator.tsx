import { logger, Event as LogEvent } from '../../../utils/logger';
import { type CSSProperties, type ReactElement, useCallback, useEffect } from 'react';
import { Square } from 'lucide-react';
import { toast } from 'sonner';
import { useAgentProgress } from '../../../hooks/useAgentProgress';
import { useAuth } from '../../../hooks/useAuth';
import { apiInstance } from '../../../services/clients/apiClient';
import { AgentSpinner } from '../../ui/AgentSpinner';
import { Button } from '../../ui/Button/Button';

const rowStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};

/**
 * Renders a transient "agent is working" pill next to the chat input.
 * Mirrors the shape of the typing indicator. No DB rows are created.
 * The spinner variant comes from the hook and rotates on each tool-label change.
 *
 * The Stop button is only rendered for the user who triggered the run
 * (agent.triggeredByUserId === current user). The backend enforces the same
 * ownership rule on /agent-cancel, so this is purely a visibility gate.
 */
export function AgentProgressIndicator({
  sessionId,
  conversationId,
  onActiveChange,
}: {
  sessionId: string | undefined;
  conversationId: string | undefined;
  /** Notifies the parent whether any agent is currently active (drives the input activity bar). */
  onActiveChange?: (active: boolean) => void;
}): ReactElement | null {
  const { user } = useAuth();
  const { agents, clearAll } = useAgentProgress(sessionId);

  const isActive = agents.length > 0;
  useEffect(() => {
    onActiveChange?.(isActive);
  }, [isActive, onActiveChange]);

  const currentUserId = user?.id;
  const myAgent = agents.find(
    a => a.triggeredByUserId !== null && a.triggeredByUserId === currentUserId,
  );

  const handleAbortAgent = useCallback(async () => {
    if (!conversationId) return;
    const slug = myAgent?.agentSlug;
    if (!slug) return;
    try {
      await apiInstance.post(`/conversations/${encodeURIComponent(conversationId)}/agent-cancel`, {
        agentSlug: slug,
      });
      // Clear only after confirmed cancel — prevents hiding a still-running agent
      // when the request is rejected (e.g. 403 non-owner) or fails.
      clearAll();
      // Notify sibling instances (e.g. channel input ↔ thread input both watching
      // the same conversationId) so they clear immediately without waiting for the socket.
      window.dispatchEvent(
        new CustomEvent('agent-progress-cleared', { detail: { conversationId } }),
      );
    } catch (err) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[AgentProgressIndicator] cancel failed:'),
        error: err,
      });
      toast.error('Failed to stop agent', {
        description: 'Only the person who started it can stop.',
      });
    }
  }, [conversationId, myAgent, clearAll]);

  if (agents.length === 0) return null;

  return (
    <div className='mb-2 flex items-center gap-2 h-5 bg-background'>
      <div className='flex flex-wrap gap-3 text-[11px] text-muted-foreground flex-1 min-w-0'>
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
      {myAgent && (
        <Button
          variant='ghost'
          type='button'
          onClick={() => void handleAbortAgent()}
          className='p-1 rounded-full bg-red-500 text-white hover:bg-red-600 transition-colors shrink-0'
          aria-label='Stop agent'
          trackId='stop_agent'
          data-track-category='CHAT_INPUT'
          data-track-name='STOP_AGENT'
        >
          <Square className='h-3 w-3 fill-current' />
        </Button>
      )}
    </div>
  );
}
