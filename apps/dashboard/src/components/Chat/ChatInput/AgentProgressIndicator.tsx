import { logger, Event as LogEvent } from '../../../utils/logger';
import { type CSSProperties, type ReactElement, useCallback, useEffect } from 'react';
import { Square } from 'lucide-react';
import { toast } from 'sonner';
import { useAgentProgress } from '../../../hooks/useAgentProgress';
import { useAuth } from '../../../hooks/useAuth';
import { apiInstance } from '../../../services/clients/apiClient';
import Avatar from '../../ui/Avatar/Avatar';

const rowStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};

/**
 * Tool labels arrive from xyne-claw with a leading per-server icon —
 * "\u{1F50D} spaces-search: …", "\u{1F4CA} query_metrics: …", "\u{1F527} get_file_content"
 * (buildToolLabel in apps/xyne-claw/src/subagent-tools.ts). The icon says which
 * system is being queried, so it has to stay legible.
 *
 * It must NOT be rendered inside `.typing-shimmer`: that paints text via
 * `background-clip: text` + `color: transparent`, which clips colour emoji to
 * the gradient and flattens them into grey blobs — near-invisible on the dark
 * theme. So split it off and render it as a normal sibling.
 *
 * The trailing `\uFE0F`/ZWJ run is part of the glyph (🛠️ is U+1F6E0 U+FE0F);
 * leaving it behind would strand a stray selector at the head of the text.
 */
const LEADING_PICTOGRAPH = /^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)\s*/u;

function splitLeadingIcon(label: string): { icon: string | null; text: string } {
  const m = LEADING_PICTOGRAPH.exec(label);
  if (!m) return { icon: null, text: label };
  const text = label.slice(m[0].length);
  // A glyph with nothing after it would render as a bare icon with no context —
  // keep the original string intact in that case.
  return text.trim() ? { icon: m[1] ?? null, text } : { icon: null, text: label };
}


/**
 * Renders a transient "agent is working" pill next to the chat input.
 *
 * Deliberately styled as the typing indicator's twin: same slot (the bar above
 * the composer in InputBox), same row height, same avatar treatment, same
 * shimmer, same type scale. A human typing and an agent working are the same
 * kind of event — someone in this conversation is composing a reply — so they
 * should read as one system rather than two unrelated widgets.
 *
 * What stays different is what genuinely IS different: an agent run can last
 * minutes and can be stopped, so it keeps its Stop button. The agent's own
 * avatar also distinguishes it from a human at a glance, which is why the
 * spinner glyph could be dropped without losing the "who is this" signal.
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
    <div className='flex w-full items-center gap-1.5 h-5 bg-background'>
      <div className='flex flex-wrap gap-3 flex-1 min-w-0'>
        {agents.map(a => {
          const { icon, text } = splitLeadingIcon(a.toolLabel ?? 'working…');
          return (
            <span key={a.agentUserId ?? a.agentSlug ?? 'agent'} style={rowStyle}>
              <Avatar
                userId={a.agentUserId}
                size='xs'
                rounded
                showActiveStatus={false}
                className='size-3 ring-2 ring-background'
              />
              {icon ? (
                <span className='text-[10px] leading-none shrink-0' aria-hidden='true'>
                  {icon}
                </span>
              ) : null}
              <small className='typing-shimmer text-[10px] tracking-tight truncate max-w-[320px]'>
                {a.agentName ? `${a.agentName} · ` : ''}
                {text}
              </small>
            </span>
          );
        })}
      </div>
      {myAgent && (
        <button
          type='button'
          onClick={() => void handleAbortAgent()}
          className='p-1 rounded-full bg-red-500 text-white hover:bg-red-600 transition-colors shrink-0'
          aria-label='Stop agent'
          data-ph-capture-attribute-track-id='stop_agent'
          data-track-category='CHAT_INPUT'
          data-track-name='STOP_AGENT'
        >
          <Square className='h-3 w-3 fill-current' />
        </button>
      )}
    </div>
  );
}
