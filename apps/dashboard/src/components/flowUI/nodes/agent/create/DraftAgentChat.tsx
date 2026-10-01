import { useCallback, useId, useMemo, useRef, useState, type ReactElement } from 'react';
import { useReducedMotion } from 'motion/react';
import { AgentBotAvatar } from '@/components/agents/AgentBotAvatar';
import { EMPTY_DRAFT_CHAT_EXTRAS, type DraftChatExtras } from '@/services/claw/draftChat';
import { ThinkingStatus, DraftChatComposer, UnreadStatus } from './DraftChatComposer';
import { useUnreadReplies } from './useUnreadReplies';
import { McpSuggestCard, type McpSuggestAttach } from '@/components/flowUI/nodes/McpSuggestNode';
import {
  enableEntry,
  isEntryEnabled,
  type McpCatalogEntry,
} from '@/routes/AIScreen/library/shared/pickers/mcp/mcpCatalog';
import { SPACES_SESSION_SERVER_TYPES } from '@/routes/AIScreen/library/shared/pickers/mcp/mcpConnectStrategy';
import { useMcpCatalog } from '@/routes/AIScreen/library/shared/pickers/mcp/useMcpCatalog';
import { DraftChatGapList, type HandoffPhase } from './DraftChatGapRows';
import {
  addCapabilityRequest,
  capabilityGapKey,
  connectorForGap,
  inferredCapabilityGaps,
  isConnectGap,
  type CapabilityGap,
} from './draftChatGaps';
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
 * it can't use in this test: connectors it needs come with Connect, anything
 * else as a row with an Add button.
 */
const NO_HANDOFFS: Readonly<Record<string, HandoffPhase>> = {};

export function DraftAgentChat({
  getForm,
  agentName,
  agentKey,
  disabled = false,
  onHandoff,
  handoffs = NO_HANDOFFS,
  onToolsChange,
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
   * Puts a connector on the agent, for Connect. Absent, connectors the agent
   * needs are rows like any other gap.
   */
  onToolsChange?: ((tools: AgentCreateFormState['tools']) => void) | undefined;
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
  const { entries, connectedServerIds, orgCoveredServerIds } = useMcpCatalog();
  const connectors = useMemo(
    () =>
      entries.flatMap(entry =>
        entry.server && !entry.isGateway
          ? [{ entry, label: entry.label, slug: entry.slug, serverType: entry.server.type }]
          : [],
      ),
    [entries],
  );
  const onAgent = useCallback(
    (entry: McpCatalogEntry): boolean => {
      const tools = getForm().tools;
      return (
        isEntryEnabled(tools, entry) ||
        tools.subagents.includes(entry.server?.type ?? '') ||
        tools.subagents.includes(entry.slug)
      );
    },
    [getForm],
  );
  const usable = useCallback(
    (entry: McpCatalogEntry): boolean => {
      const server = entry.server;
      return Boolean(
        server &&
        (SPACES_SESSION_SERVER_TYPES.has(server.type) ||
          connectedServerIds.has(server.id) ||
          orgCoveredServerIds.has(server.id)),
      );
    },
    [connectedServerIds, orgCoveredServerIds],
  );
  // When the model answers "I can't" in prose instead of reporting the gap, the
  // row still appears, with a status read from the canvas and connections.
  const inferGaps = useCallback(
    (request: string, reply: string, reported: CapabilityGap[]): CapabilityGap[] =>
      inferredCapabilityGaps(
        request,
        reply,
        connectors.map(({ entry, label, serverType }) => ({
          label,
          serverType,
          onAgent: onAgent(entry),
          usable: usable(entry),
        })),
        reported,
      ),
    [connectors, onAgent, usable],
  );
  // Connect puts the connector on the agent, then signs in if it still needs to.
  const attach = useMemo((): McpSuggestAttach | undefined => {
    if (!onToolsChange) return undefined;
    const entryFor = (id: string): McpCatalogEntry | undefined =>
      entries.find(entry => entry.server?.id === id);
    return {
      isAttached: server => {
        const entry = entryFor(server.id);
        return entry ? onAgent(entry) : false;
      },
      onAttach: server => {
        const entry = entryFor(server.id);
        if (!entry) return;
        const tools = getForm().tools;
        onToolsChange({
          ...enableEntry(entries, tools, entry),
          callableAgents: tools.callableAgents,
        });
      },
    };
  }, [entries, getForm, onAgent, onToolsChange]);
  const chat = useDraftChat(getForm, { storageKey, open: active && expanded, inferGaps });
  const { send, stop } = chat;
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
      // The Build chat takes it from here: fold the test chat out of its way,
      // keeping the conversation for Ask again once the change lands.
      setExpanded(false);
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
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
  /** The gaps that are catalog connectors, which Connect answers instead of Add. */
  const connectorGaps = (gaps: readonly CapabilityGap[]) =>
    attach
      ? gaps.flatMap(gap => {
          const connector = isConnectGap(gap) ? connectorForGap(gap, connectors) : undefined;
          return connector ? [{ gap, entry: connector.entry }] : [];
        })
      : [];

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
          avatar={(size, busy) => <AgentBotAvatar agentKey={agentKey} busy={busy} size={size} />}
          emptyLabel={`Try out ${name}`}
          renderAfterReply={(message, { request, latest }) => {
            if (!message.gaps?.length) return null;
            const toConnect = connectorGaps(message.gaps);
            const connectKeys = new Set(toConnect.map(({ gap }) => capabilityGapKey(gap)));
            // The newest reply offers Connect; older ones keep a plain row.
            const offerConnect = latest && toConnect.length > 0;
            const cards = toConnect.filter(
              ({ entry }, index) => toConnect.findIndex(other => other.entry === entry) === index,
            );
            return (
              <DraftChatGapList
                gaps={
                  offerConnect
                    ? message.gaps.filter(gap => !connectKeys.has(capabilityGapKey(gap)))
                    : message.gaps
                }
                phaseOf={gap => phaseOf(`${message.id}:${capabilityGapKey(gap)}`)}
                latest={latest}
                onAdd={
                  onHandoff
                    ? (gap): void =>
                        handOff(`${message.id}:${capabilityGapKey(gap)}`, addCapabilityRequest(gap))
                    : undefined
                }
                addable={gap => !connectKeys.has(capabilityGapKey(gap))}
                connect={
                  offerConnect ? (
                    <div data-testid='draft-chat-connect'>
                      <McpSuggestCard
                        title='Connect to unlock this'
                        connectors={cards.map(({ gap, entry }) => ({
                          serverType: entry.server?.type ?? entry.slug,
                          name: entry.label,
                          description: `Needed to ${gap.need.replace(/[.\s]+$/, '')}`,
                        }))}
                        fullWidth
                        linkRows={false}
                        attach={attach}
                      />
                    </div>
                  ) : null
                }
                connected={
                  offerConnect && cards.every(({ entry }) => onAgent(entry) && usable(entry))
                }
                onAskAgain={() => askAgain(request)}
              />
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
              avatar={<AgentBotAvatar agentKey={agentKey} busy size={22} />}
              replying={replying}
            />
          ) : showUnread ? (
            <UnreadStatus
              avatar={<AgentBotAvatar agentKey={agentKey} size={22} />}
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
