import { useCallback, useId, useRef, useState, type ReactElement } from 'react';
import { useReducedMotion } from 'motion/react';
import { AgentBotAvatar } from '@/components/agents/AgentBotAvatar';
import { EMPTY_DRAFT_CHAT_EXTRAS, type DraftChatExtras } from '@/services/claw/draftChat';
import { ThinkingStatus, DraftChatComposer, UnreadStatus } from './DraftChatComposer';
import { useUnreadReplies } from './useUnreadReplies';
import { useMcpCatalog } from '@/routes/AIScreen/library/shared/pickers/mcp/useMcpCatalog';
import { BuildConnectCards } from './BuildConnectCards';
import { DraftChatGapList, type HandoffPhase } from './DraftChatGapRows';
import { addCapabilityRequest, capabilityGapKey, type CapabilityGap } from './draftChatGaps';
import { readDraftChat } from './draftChatStorage';
import { DraftChatOverlay } from './DraftChatOverlay';
import { DraftChatTranscript } from './DraftChatTranscript';
import type { AgentCreateFormState } from './types';
import { draftThreadTitle, useDraftChat } from './useDraftChat';
import { composerPlaceholder } from './draftChatMotion';

/**
 * Test chat with the unsaved agent, floating over the bottom of the create
 * canvas. Each run uses the form as it is at send time. It works at every
 * stage of the build: the agent chats with whatever it has, and reports what
 * it can't use in this test as rows with an Add button.
 */
const NO_HANDOFFS: Readonly<Record<string, HandoffPhase>> = {};

export function DraftAgentChat({
  getForm,
  agentName,
  agentKey,
  disabled = false,
  onHandoff,
  handoffs = NO_HANDOFFS,
  storageKey,
}: {
  getForm: () => AgentCreateFormState;
  agentName: string;
  /** Seeds the avatar, like the canvas's own. */
  agentKey: string;
  disabled?: boolean;
  /**
   * Sends a message to the Build chat and returns its id. Absent where there
   * is no Build chat, which hides the Add buttons.
   */
  onHandoff?: ((text: string) => string) | undefined;
  /** Progress of each message sent with `onHandoff`, by id. */
  handoffs?: Readonly<Record<string, HandoffPhase>>;
  /**
   * Keeps the conversation, and whether the chat was open, across a reload,
   * such as the round trip through a connector's sign-in.
   */
  storageKey?: string | undefined;
}): ReactElement {
  const inputId = useId();
  const reduceMotion = useReducedMotion();
  // Open before a reload: comes back open on the same conversation.
  const [reopen] = useState(() => (storageKey ? readDraftChat(storageKey)?.open : false) ?? false);
  const [sessionOverlay, setSessionOverlay] = useState(reopen);
  const [active, setActive] = useState(reopen);
  const [expanded, setExpanded] = useState(reopen);
  const chat = useDraftChat(getForm, { storageKey, open: active && expanded });
  const { send, stop } = chat;
  const { entries } = useMcpCatalog();
  const [value, setValue] = useState('');
  const [extras, setExtras] = useState<DraftChatExtras>(EMPTY_DRAFT_CHAT_EXTRAS);
  const [maximized, setMaximized] = useState(false);
  const activeRef = useRef(false);
  activeRef.current = active;
  const name = agentName.trim() || 'your agent';
  /** Which Build chat message each button sent, keyed by reply id and row. */
  const [sent, setSent] = useState<Readonly<Record<string, string>>>({});

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

  const handOff = useCallback(
    (row: string, text: string): void => {
      if (!onHandoff || sent[row]) return;
      const id = onHandoff(text);
      setSent(current => ({ ...current, [row]: id }));
    },
    [onHandoff, sent],
  );
  const phaseOf = (row: string): HandoffPhase | undefined => {
    const id = sent[row];
    return id ? (handoffs[id] ?? 'queued') : undefined;
  };
  const askAgain = (request: string): void => {
    if (request) handleSend(request, EMPTY_DRAFT_CHAT_EXTRAS);
  };
  /** Connectors the agent has but the user hasn't connected, by the name the agent gave them. */
  const unconnectedSlugs = (gaps: readonly CapabilityGap[]): string[] =>
    gaps.flatMap(gap => {
      if (gap.status !== 'not_connected') return [];
      const name = gap.capability.trim().toLowerCase();
      const entry = entries.find(
        item => item.label.toLowerCase() === name || item.slug.toLowerCase() === name,
      );
      return entry ? [entry.slug] : [];
    });

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
  const folded = active && !expanded;
  const replying = Boolean(
    [...chat.messages].reverse().find(message => message.role === 'assistant')?.content,
  );
  const unread = useUnreadReplies(
    chat.messages.filter(message => message.role === 'assistant' && !message.streaming).length,
    expanded,
  );
  const showUnread = folded && !chat.pending && unread > 0;

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
          renderAfterReply={(message, { request, latest }) => {
            if (!message.gaps?.length) return null;
            return (
              <>
                <DraftChatGapList
                  gaps={message.gaps}
                  phaseOf={gap => phaseOf(`${message.id}:${capabilityGapKey(gap)}`)}
                  latest={latest}
                  onAdd={
                    onHandoff
                      ? (gap): void =>
                          handOff(
                            `${message.id}:${capabilityGapKey(gap)}`,
                            addCapabilityRequest(gap),
                          )
                      : undefined
                  }
                  onAskAgain={() => askAgain(request)}
                />
                {latest ? <BuildConnectCards slugs={unconnectedSlugs(message.gaps)} /> : null}
              </>
            );
          }}
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
          folded,
          pending: chat.pending,
          replying,
          idle: `Ask ${name} anything`,
        })}
        status={
          folded && chat.pending ? (
            <ThinkingStatus
              avatar={<AgentBotAvatar type='clover' agentKey={agentKey} busy size={22} />}
              replying={replying}
            />
          ) : showUnread ? (
            <UnreadStatus
              avatar={<AgentBotAvatar type='clover' agentKey={agentKey} size={22} />}
              count={unread}
            />
          ) : undefined
        }
        statusKey={chat.pending ? 'working' : 'unread'}
        statusOnly={showUnread}
        pending={chat.pending}
        disabled={disabled}
        onSend={handleSend}
        onStop={stop}
      />
    </DraftChatOverlay>
  );
}
