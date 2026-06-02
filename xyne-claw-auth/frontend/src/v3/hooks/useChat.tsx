import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { cancelChatRun, sendChatMessage } from "../../lib/api";
import type { AttachedContextRef, ChatMsg, StreamCallbacks, ToolInvocation } from "../../lib/api";

/** Optional extras a single send() call can ride with. */
export interface SendOptions {
  attachmentIds?: string[];
  attachedContext?: AttachedContextRef[];
}

/* ── Per-conversation session ────────────────────────────────────── */
//
// Why: switching conversations mid-stream should NOT abort the in-flight
// request. The user needs to be able to send in conv A, click conv B,
// then return to conv A and still see the loading bubble / tool cards.
//
// Each conversation (and each "new chat" draft) gets its own session entry.
// Drafts use a `draft:<agent>:<uuid>` key until the server returns a real
// conversationId, then we migrate the entry under that real id.

interface ChatSession {
  conversationId: string | undefined;
  /** Agent that started/owns this session — needed for backend cancel calls. */
  agentSlug: string | null;
  /** Backend run sessionId (from SSE `run` event) — required to cancel a stream. */
  runSessionId: string | null;
  messages: ChatMsg[];
  sending: boolean;
  toolLabel: string | null;
  liveInvocations: ToolInvocation[];
  liveReasoning: string;
  streamingMsgId: string | null;
  invocationsByMsgId: Map<string, ToolInvocation[]>;
  reasoningByMsgId: Map<string, string>;
}

const EMPTY_SESSION: ChatSession = {
  conversationId: undefined,
  agentSlug: null,
  runSessionId: null,
  messages: [],
  sending: false,
  toolLabel: null,
  liveInvocations: [],
  liveReasoning: "",
  streamingMsgId: null,
  invocationsByMsgId: new Map(),
  reasoningByMsgId: new Map(),
};

/* ── Context shape ───────────────────────────────────────────────── */

interface ChatContextValue {
  messages: ChatMsg[];
  conversationId: string | undefined;
  sending: boolean;
  toolLabel: string | null;
  invocations: ToolInvocation[];
  reasoning: string;
  reasoningByMsgId: Map<string, string>;
  invocationsByMsgId: Map<string, ToolInvocation[]>;
  streamingMsgId: string | null;
  activeAgentSlug: string | null;
  setActiveAgentSlug: (slug: string | null) => void;
  send: (agentSlug: string, userId: string, text: string, opts?: SendOptions) => Promise<void>;
  /** Cancel the in-flight stream for the active session. No-op if nothing
   *  is sending. Hits the backend cancel endpoint so the agent stops doing work,
   *  then aborts the local fetch and marks the assistant message as cancelled. */
  stop: (userId: string) => Promise<void>;
  clear: () => void;
  loadConversation: (msgs: ChatMsg[], convId: string, invocationsByMsgId?: Map<string, ToolInvocation[]>) => void;
  /** Subscribe to "a new conversationId was assigned mid-stream" events.
   *  ChatPageV3 uses this to refresh its sidebar list so the in-flight draft
   *  appears immediately, not only after the stream completes. */
  onConversationCreated: (cb: (info: { agentSlug: string; conversationId: string }) => void) => () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

/* ── Provider ────────────────────────────────────────────────────── */

export function ChatProvider({ children }: { children: ReactNode }) {
  // Map keyed by conversationId (real) or `draft:<agent>:<uuid>` (in-flight new chat).
  const [sessions, setSessions] = useState<Map<string, ChatSession>>(new Map());
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [activeAgentSlug, setActiveAgentSlug] = useState<string | null>(null);
  // Per-session abort controllers — keyed by the same session key. Switching
  // sessions does NOT touch these; each stream owns its own controller.
  const abortRefs = useRef<Map<string, AbortController>>(new Map());
  // Subscribers for "conversation row was just created" — used by ChatPageV3
  // to refresh its sidebar list immediately when SSE delivers the meta event.
  const convCreatedSubsRef = useRef<Set<(info: { agentSlug: string; conversationId: string }) => void>>(new Set());

  const onConversationCreated = useCallback(
    (cb: (info: { agentSlug: string; conversationId: string }) => void) => {
      convCreatedSubsRef.current.add(cb);
      return () => {
        convCreatedSubsRef.current.delete(cb);
      };
    },
    [],
  );

  const updateSession = useCallback(
    (key: string, updater: (s: ChatSession) => ChatSession) => {
      setSessions((prev) => {
        const next = new Map(prev);
        next.set(key, updater(next.get(key) ?? EMPTY_SESSION));
        return next;
      });
    },
    [],
  );

  const send = useCallback(
    async (agentSlug: string, userId: string, text: string, opts?: SendOptions) => {
      // Pick the session to stream into: reuse the currently-active one if
      // there is one, otherwise spin up a draft.
      let sessionKey = activeKey;
      let initialConvId: string | undefined;
      if (sessionKey) {
        initialConvId = sessions.get(sessionKey)?.conversationId;
      } else {
        sessionKey = `draft:${agentSlug}:${crypto.randomUUID()}`;
        setActiveKey(sessionKey);
      }
      const key: string = sessionKey;

      // Only abort an in-flight send IN THIS SAME SESSION — other sessions
      // keep streaming unaffected.
      abortRefs.current.get(key)?.abort();
      const controller = new AbortController();
      abortRefs.current.set(key, controller);

      const userMsg: ChatMsg = {
        id: crypto.randomUUID(),
        conversationId: initialConvId ?? "",
        role: "user",
        content: text,
        status: "complete",
        createdAt: new Date().toISOString(),
      };

      const assistantId = crypto.randomUUID();
      const assistantPlaceholder: ChatMsg = {
        id: assistantId,
        conversationId: initialConvId ?? "",
        role: "assistant",
        content: "",
        status: "streaming",
        createdAt: new Date().toISOString(),
      };

      updateSession(key, (s) => ({
        ...s,
        agentSlug,
        runSessionId: null,
        sending: true,
        streamingMsgId: assistantId,
        liveInvocations: [],
        liveReasoning: "",
        toolLabel: null,
        messages: [...s.messages, userMsg, assistantPlaceholder],
      }));

      // Tracks the live session key — flips from the draft key to the real
      // conversationId the moment the SSE `meta` event fires, so subsequent
      // SSE callbacks write into the migrated session entry.
      let liveKey = key;

      const migrateDraftToReal = (realConvId: string) => {
        if (!liveKey.startsWith("draft:")) return;
        const oldKey = liveKey;
        liveKey = realConvId;
        setSessions((prev) => {
          // If we've already migrated, no-op (meta could fire twice in theory).
          if (prev.has(realConvId) && !prev.has(oldKey)) return prev;
          const next = new Map(prev);
          const sess = next.get(oldKey) ?? EMPTY_SESSION;
          next.delete(oldKey);
          next.set(realConvId, {
            ...sess,
            conversationId: realConvId,
            messages: sess.messages.map((m) => ({
              ...m,
              conversationId: m.conversationId || realConvId,
            })),
          });
          return next;
        });
        // Carry over the abort controller so cancellation still works.
        const ctrl = abortRefs.current.get(oldKey);
        if (ctrl) {
          abortRefs.current.set(realConvId, ctrl);
          abortRefs.current.delete(oldKey);
        }
        // If the user is still looking at this draft, switch the active
        // pointer to the real id so the sidebar can highlight it correctly.
        setActiveKey((prev) => (prev === oldKey ? realConvId : prev));
        // Notify subscribers so the sidebar refreshes.
        convCreatedSubsRef.current.forEach((cb) => {
          try {
            cb({ agentSlug, conversationId: realConvId });
          } catch (e) {
            console.warn("[useChat] onConversationCreated subscriber threw:", e);
          }
        });
      };

      const callbacks: StreamCallbacks = {
        onConversationId: (realConvId) => migrateDraftToReal(realConvId),
        onRunMeta: ({ sessionId }) =>
          updateSession(liveKey, (s) => ({ ...s, runSessionId: sessionId })),
        onProgress: (label) => updateSession(liveKey, (s) => ({ ...s, toolLabel: label })),
        onInvocation: (inv) =>
          updateSession(liveKey, (s) => {
            let nextLive: ToolInvocation[];
            if (!inv.toolCallId) {
              nextLive = [...s.liveInvocations, inv];
            } else {
              const idx = s.liveInvocations.findIndex((p) => p.toolCallId === inv.toolCallId);
              if (idx === -1) {
                nextLive = [...s.liveInvocations, inv];
              } else {
                nextLive = s.liveInvocations.slice();
                nextLive[idx] = inv;
              }
            }
            const nextMap = new Map(s.invocationsByMsgId);
            const list = nextMap.get(assistantId) ?? [];
            if (!inv.toolCallId) {
              nextMap.set(assistantId, [...list, inv]);
            } else {
              const idx = list.findIndex((p) => p.toolCallId === inv.toolCallId);
              if (idx === -1) {
                nextMap.set(assistantId, [...list, inv]);
              } else {
                const updated = list.slice();
                updated[idx] = inv;
                nextMap.set(assistantId, updated);
              }
            }
            return { ...s, liveInvocations: nextLive, invocationsByMsgId: nextMap };
          }),
        onReasoningDelta: (delta) =>
          updateSession(liveKey, (s) => {
            const nextMap = new Map(s.reasoningByMsgId);
            nextMap.set(assistantId, (nextMap.get(assistantId) ?? "") + delta);
            return { ...s, liveReasoning: s.liveReasoning + delta, reasoningByMsgId: nextMap };
          }),
        onTextDelta: (delta) =>
          updateSession(liveKey, (s) => ({
            ...s,
            toolLabel: null,
            messages: s.messages.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + delta } : m,
            ),
          })),
      };

      try {
        const result = await sendChatMessage(
          agentSlug,
          text,
          userId,
          initialConvId,
          callbacks,
          opts?.attachmentIds && opts.attachmentIds.length > 0 ? opts.attachmentIds : undefined,
          opts?.attachedContext && opts.attachedContext.length > 0 ? opts.attachedContext : undefined,
          controller.signal,
        );

        const finalConvId = result.conversationId;
        // Belt-and-braces: if for some reason the meta event never fired
        // (older backend, parser glitch), migrate now using the result.
        migrateDraftToReal(finalConvId);

        updateSession(liveKey, (s) => ({
          ...s,
          conversationId: finalConvId,
          sending: false,
          streamingMsgId: null,
          liveInvocations: [],
          liveReasoning: "",
          toolLabel: null,
          messages: s.messages.map((m) =>
            m.id === assistantId
              ? { ...m, content: result.reply.content || m.content, status: "complete" }
              : m,
          ),
        }));

        abortRefs.current.delete(liveKey);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          updateSession(liveKey, (s) => ({
            ...s,
            sending: false,
            streamingMsgId: null,
            liveInvocations: [],
            liveReasoning: "",
            toolLabel: null,
            messages: s.messages.filter((m) => m.id !== assistantId),
          }));
          return;
        }
        updateSession(liveKey, (s) => ({
          ...s,
          sending: false,
          streamingMsgId: null,
          liveInvocations: [],
          liveReasoning: "",
          toolLabel: null,
          messages: s.messages.map((m) =>
            m.id === assistantId ? { ...m, status: "error" } : m,
          ),
        }));
        abortRefs.current.delete(liveKey);
      }
    },
    [activeKey, sessions, updateSession],
  );

  const clear = useCallback(() => {
    // "New conversation": switch to an empty view. The previous session keeps
    // running in the background if it's still streaming.
    setActiveKey(null);
  }, []);

  const stop = useCallback(
    async (userId: string) => {
      const key = activeKey;
      if (!key) return;
      const session = sessions.get(key);
      if (!session?.sending) return;

      // Tell the backend to cancel the run so the agent stops doing work.
      // Best-effort — even if it fails (network, already done), we still abort
      // the local fetch and finalize the message UI.
      if (session.runSessionId && session.agentSlug) {
        try {
          await cancelChatRun(session.agentSlug, userId, session.runSessionId);
        } catch (err) {
          console.warn("[useChat] cancel run failed (continuing local abort):", err);
        }
      }

      abortRefs.current.get(key)?.abort();
      abortRefs.current.delete(key);

      updateSession(key, (s) => ({
        ...s,
        sending: false,
        streamingMsgId: null,
        liveInvocations: [],
        liveReasoning: "",
        toolLabel: null,
        messages: s.messages.map((m) =>
          m.id === s.streamingMsgId ? { ...m, status: "cancelled" } : m,
        ),
      }));
    },
    [activeKey, sessions, updateSession],
  );

  const loadConversation = useCallback((msgs: ChatMsg[], convId: string, invocationsByMsgId?: Map<string, ToolInvocation[]>) => {
    setSessions((prev) => {
      const existing = prev.get(convId);
      // If this conversation is currently streaming, leave its live state alone —
      // just make it the active session.
      if (existing?.sending) return prev;
      const next = new Map(prev);
      next.set(convId, {
        conversationId: convId,
        agentSlug: null,
        runSessionId: null,
        messages: msgs,
        sending: false,
        toolLabel: null,
        liveInvocations: [],
        liveReasoning: "",
        streamingMsgId: null,
        invocationsByMsgId: invocationsByMsgId ?? new Map(),
        reasoningByMsgId: new Map(),
      });
      return next;
    });
    setActiveKey(convId);
  }, []);

  const active = activeKey ? sessions.get(activeKey) ?? EMPTY_SESSION : EMPTY_SESSION;

  const value = useMemo<ChatContextValue>(
    () => ({
      messages: active.messages,
      conversationId: active.conversationId,
      sending: active.sending,
      toolLabel: active.toolLabel,
      invocations: active.liveInvocations,
      reasoning: active.liveReasoning,
      reasoningByMsgId: active.reasoningByMsgId,
      invocationsByMsgId: active.invocationsByMsgId,
      streamingMsgId: active.streamingMsgId,
      activeAgentSlug,
      setActiveAgentSlug,
      send,
      stop,
      clear,
      loadConversation,
      onConversationCreated,
    }),
    [active, activeAgentSlug, send, stop, clear, loadConversation, onConversationCreated],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

/* ── Hook ────────────────────────────────────────────────────────── */

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) {
    throw new Error("useChat must be used inside <ChatProvider>");
  }
  return ctx;
}
