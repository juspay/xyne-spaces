import { useCallback, useId, useRef, useState, type ReactElement } from 'react';
import { useReducedMotion } from 'motion/react';
import { AgentBotAvatar } from '@/components/agents/AgentBotAvatar';
import { EMPTY_DRAFT_CHAT_EXTRAS, type DraftChatExtras } from '@/services/claw/draftChat';
import { DraftChatComposer } from './DraftChatComposer';
import { DraftChatOverlay } from './DraftChatOverlay';
import { DraftChatTranscript } from './DraftChatTranscript';
import type { AgentCreateFormState } from './types';
import { draftThreadTitle, useDraftChat } from './useDraftChat';
import { composerPlaceholder } from './draftChatMotion';

/**
 * Test chat with the unsaved agent, floating over the bottom of the create
 * canvas. Each run uses the form as it is at send time.
 */
export function DraftAgentChat({
  getForm,
  agentName,
  agentKey,
  disabled = false,
}: {
  getForm: () => AgentCreateFormState;
  agentName: string;
  /** Seeds the avatar, like the canvas's own. */
  agentKey: string;
  disabled?: boolean;
}): ReactElement {
  const inputId = useId();
  const reduceMotion = useReducedMotion();
  const chat = useDraftChat(getForm);
  const { send, stop } = chat;
  const [value, setValue] = useState('');
  const [extras, setExtras] = useState<DraftChatExtras>(EMPTY_DRAFT_CHAT_EXTRAS);
  const [sessionOverlay, setSessionOverlay] = useState(false);
  const [active, setActive] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const activeRef = useRef(false);
  activeRef.current = active;
  const name = agentName.trim() || 'your agent';

  const handleSend = useCallback(
    (text: string, sent: DraftChatExtras): void => {
      // A closed chat is finished: the next message starts a new one.
      void send(text, sent, { fresh: !activeRef.current });
      setExtras(current => ({ ...current, attachments: [] }));
      setSessionOverlay(true);
      setActive(true);
      setExpanded(true);
    },
    [send],
  );

  const handleCollapse = useCallback((): void => setExpanded(false), []);
  const handleExpand = useCallback((): void => setExpanded(true), []);
  const handleClose = useCallback((): void => {
    stop();
    setExpanded(false);
    setActive(false);
  }, [stop]);
  const handleExited = useCallback((): void => {
    if (activeRef.current) return;
    setSessionOverlay(false);
    setMaximized(false);
  }, []);

  const threads = chat.threads
    .filter(thread => thread.messages.length > 0)
    .map(thread => ({ id: thread.id, title: draftThreadTitle(thread) }))
    .reverse();
  const activeThread = chat.threads.find(thread => thread.id === chat.activeThreadId);

  return (
    <DraftChatOverlay
      variant={sessionOverlay ? 'session' : 'origin'}
      open={expanded}
      sessionActive={active}
      maximized={maximized}
      reduceMotion={reduceMotion}
      title={draftThreadTitle(activeThread)}
      threads={threads}
      activeThreadId={chat.activeThreadId}
      // A test chat has no history to pick from: no header. Clicking away folds
      // it, Escape closes it.
      showHeader={false}
      transcript={
        <DraftChatTranscript
          messages={chat.messages}
          avatar={(size, busy) => (
            <AgentBotAvatar type='clover' agentKey={agentKey} busy={busy} size={size} />
          )}
          emptyLabel={`Try out ${name}`}
        />
      }
      onNewChat={() => {
        chat.newChat();
        setExpanded(true);
      }}
      onSelectThread={id => {
        chat.selectThread(id);
        setExpanded(true);
      }}
      onToggleMaximize={() => setMaximized(current => !current)}
      onCollapse={handleCollapse}
      onExpand={handleExpand}
      onClose={handleClose}
      onExited={handleExited}
    >
      <DraftChatComposer
        inputId={inputId}
        value={value}
        onValueChange={setValue}
        extras={extras}
        onExtrasChange={setExtras}
        placeholder={composerPlaceholder({
          folded: active && !expanded,
          pending: chat.pending,
          replying: Boolean(
            [...chat.messages].reverse().find(message => message.role === 'assistant')?.content,
          ),
          idle: `Ask ${name} anything`,
        })}
        pending={chat.pending}
        disabled={disabled}
        onSend={handleSend}
        onStop={stop}
      />
    </DraftChatOverlay>
  );
}
