import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { cancelChatRun, sendChatMessage } from "../../lib/api";
import { resolveEffectiveParents } from "../../lib/branching";
import type { AttachedContextRef, ChatMsg, DebugEventRecord, PendingAction, PlanTodo, StreamCallbacks, ToolInvocation } from "../../lib/api";

/** Optional extras a single send() call can ride with. */
export interface SendOptions {
  attachmentIds?: string[];
  attachedContext?: AttachedContextRef[];
  /** Force a text-only run (no tool calls) for this turn. */
  disableTools?: boolean;
  /** Backend-only guidance that is not shown as user-facing chat text. */
  additionalInstructions?: string;
  /** Activates the server-owned Design Studio command contract for this turn. */
  studioMode?: "design";
  /** Latest delivered HTML, rehydrated server-side so revisions survive a
   * sandbox restart without relinking the historical attachment row. */
  designArtifactAttachmentId?: string;
  /** DOM node selected inside the isolated Design Studio preview. */
  designSelection?: {
    scope: "element" | "component" | "design-system";
    selector: string;
    tagName: string;
    label: string;
    id?: string;
    classes: string[];
    text: string;
    ancestors: string[];
    styles: Record<string, string>;
    rect: { x: number; y: number; width: number; height: number };
  };
  /** Per-chat LiteLLM model override — pins this model (off the agent's shared
   *  admin key) for this turn via the backend providerOverride. */
  modelOverride?: string;
  /** Repository selected in the SDLC Agent composer. */
  researchContext?: { type: "repository"; id: string; name?: string };
  /** Per-turn provider fast mode toggle (chat sidebar). Overrides the agent's
   *  saved modelSettings.speed for this run only. */
  speed?: "standard" | "fast";
  /** Per-turn thinking level (composer model menu). Overrides the agent's
   *  saved modelSettings.thinkingLevel for this run only. */
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high";
}

/** A live event delivered by the /live SSE for a conversation being viewed. */
export interface LiveEventInput {
  type: "snapshot" | "label" | "invocation" | "delta" | "done";
  toolLabel?: string | null;
  toolInvocation?: ToolInvocation;
  inProgress?: ToolInvocation[];
  /** Coalesced assistant answer/reasoning fragments for a viewed run. */
  textDelta?: string;
  reasoningDelta?: string;
  /** Answer-so-far from the /live snapshot (set, not appended — idempotent). */
  partial?: { msgId: string; content: string; reasoning: string };
}

/** Synthetic streaming-assistant placeholder id for a VIEWED (not driven) run.
 *  Lets liveInvocations/toolLabel render against an in-progress bubble before
 *  the real assistant ChatMessage is persisted. */
const LIVE_PLACEHOLDER_PREFIX = "live-placeholder:";

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
  livePlanTodos: PlanTodo[];
  liveReasoning: string;
  streamingMsgId: string | null;
  debugEvents: DebugEventRecord[];
  debugArtifactsReadyVersion: number;
  invocationsByMsgId: Map<string, ToolInvocation[]>;
  reasoningByMsgId: Map<string, string>;
  /** Branching selection: parentId → selectedChildId. Drives the visible path
   *  projection. Missing entry = pick the latest sibling at that fork. */
  branchSelection: Record<string, string>;
  pendingActionsByMsgId: Map<string, PendingAction[]>;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function pendingActionLogicalKey(action: PendingAction): string {
  return [
    action.serverType ?? "",
    action.tool ?? "",
    stableStringify(action.params ?? {}),
  ].join("|");
}

function dedupePendingActions(actions: PendingAction[]): PendingAction[] {
  const seen = new Set<string>();
  const out: PendingAction[] = [];
  for (const action of actions) {
    const key = pendingActionLogicalKey(action);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(action);
  }
  return out;
}

const EMPTY_SESSION: ChatSession = {
  conversationId: undefined,
  agentSlug: null,
  runSessionId: null,
  messages: [],
  sending: false,
  toolLabel: null,
  liveInvocations: [],
  livePlanTodos: [],
  liveReasoning: "",
  streamingMsgId: null,
  debugEvents: [],
  debugArtifactsReadyVersion: 0,
  invocationsByMsgId: new Map(),
  reasoningByMsgId: new Map(),
  branchSelection: {},
  pendingActionsByMsgId: new Map(),
};

/* ── Branching helpers ──────────────────────────────────────────────
 *
 * The DB stores the conversation as a tree (each ChatMessage has a
 * parentId). The UI projects ONE visible path through that tree. A fork
 * appears when a parent has more than one child — the user pages between
 * siblings with a `< x/y >` selector and the visible path swaps.
 * ─────────────────────────────────────────────────────────────────── */

export interface BranchChoice {
  id: string;
  label: string;
}

export interface MessageBranchInfo {
  parentId: string;
  currentId: string;
  choices: BranchChoice[];
}

function branchKey(parentId: string | null | undefined): string {
  return parentId ?? "__root__";
}

/** Walk the tree from root, choosing the selected child at every fork (or
 *  the latest sibling when no selection exists). Returns the projected
 *  visible list plus per-message branch info for the pager UI. */
function projectBranchMessages(
  messages: ChatMsg[],
  selection: Record<string, string>,
): { messages: ChatMsg[]; branchInfoByMsgId: Map<string, MessageBranchInfo> } {
  // Legacy conversations (pre-branching migration) have a null parentId on
  // every message; reconstruct effective parents so they project as a linear
  // thread instead of collapsing into one message with <x/y> variant pages.
  const effectiveParents = resolveEffectiveParents(messages);
  const byParent = new Map<string, ChatMsg[]>();
  for (const msg of messages) {
    const key = branchKey(effectiveParents.get(msg.id) ?? null);
    const list = byParent.get(key) ?? [];
    list.push(msg);
    byParent.set(key, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  const projected: ChatMsg[] = [];
  const branchInfoByMsgId = new Map<string, MessageBranchInfo>();
  const seen = new Set<string>();
  let parentId: string | null = null;

  while (true) {
    const parentKey = branchKey(parentId);
    const children = byParent.get(parentKey) ?? [];
    if (children.length === 0) break;

    const selectedId = selection[parentKey];
    const selected =
      children.find((child) => child.id === selectedId) ??
      children[children.length - 1];
    if (!selected || seen.has(selected.id)) break;

    projected.push(selected);
    seen.add(selected.id);
    if (children.length > 1) {
      branchInfoByMsgId.set(selected.id, {
        parentId: parentKey,
        currentId: selected.id,
        choices: children.map((child, idx) => ({
          id: child.id,
          label: `${idx + 1}/${children.length}`,
        })),
      });
    }
    parentId = selected.id;
  }

  return { messages: projected, branchInfoByMsgId };
}

function findVisibleParentAssistantId(messages: ChatMsg[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.role === "assistant") return msg.id;
  }
  return undefined;
}

/** Replace a local optimistic id with the backend-persisted id everywhere
 *  the local id appears (messages, invocation/reasoning maps, branch
 *  selection map, streamingMsgId). Stable swaps are critical because branch
 *  selection breaks if a parentId references a stale temp id. */
function replaceMessageId(session: ChatSession, localId: string, persistedId: string): ChatSession {
  if (!persistedId || persistedId === localId) return session;

  const invocationsByMsgId = new Map(session.invocationsByMsgId);
  const invocations = invocationsByMsgId.get(localId);
  if (invocations) {
    invocationsByMsgId.delete(localId);
    invocationsByMsgId.set(persistedId, invocations);
  }

  const reasoningByMsgId = new Map(session.reasoningByMsgId);
  const reasoning = reasoningByMsgId.get(localId);
  if (reasoning !== undefined) {
    reasoningByMsgId.delete(localId);
    reasoningByMsgId.set(persistedId, reasoning);
  }

  const pendingActionsByMsgId = new Map(session.pendingActionsByMsgId);
  const pendingActions = pendingActionsByMsgId.get(localId);
  if (pendingActions) {
    pendingActionsByMsgId.delete(localId);
    pendingActionsByMsgId.set(persistedId, pendingActions);
  }

  const branchSelection = Object.fromEntries(
    Object.entries(session.branchSelection).map(([parentId, selectedId]) => [
      parentId === localId ? persistedId : parentId,
      selectedId === localId ? persistedId : selectedId,
    ]),
  );

  return {
    ...session,
    invocationsByMsgId,
    reasoningByMsgId,
    pendingActionsByMsgId,
    branchSelection,
    streamingMsgId: session.streamingMsgId === localId ? persistedId : session.streamingMsgId,
    messages: session.messages.map((msg) => ({
      ...msg,
      id: msg.id === localId ? persistedId : msg.id,
      parentId: msg.parentId === localId ? persistedId : msg.parentId,
    })),
  };
}

/* ── Context shape ───────────────────────────────────────────────── */

interface ChatContextValue {
  messages: ChatMsg[];
  conversationId: string | undefined;
  sending: boolean;
  toolLabel: string | null;
  invocations: ToolInvocation[];
  planTodos: PlanTodo[];
  reasoning: string;
  reasoningByMsgId: Map<string, string>;
  invocationsByMsgId: Map<string, ToolInvocation[]>;
  /** Per-visible-message branch metadata — non-empty entries get a pager. */
  branchInfoByMsgId: Map<string, MessageBranchInfo>;
  pendingActionsByMsgId: Map<string, PendingAction[]>;
  streamingMsgId: string | null;
  debugEvents: DebugEventRecord[];
  debugArtifactsReadyVersion: number;
  activeAgentSlug: string | null;
  setActiveAgentSlug: (slug: string | null) => void;
  send: (agentSlug: string, userId: string, text: string, opts?: SendOptions) => Promise<void>;
  /** Branching: produce a sibling assistant under the same user parent.
   *  When assistantMessageId is provided, regenerates THAT assistant's reply;
   *  otherwise regenerates the latest visible assistant. */
  regenerate: (agentSlug: string, userId: string, assistantMessageId?: string, modelOverride?: string, speed?: "standard" | "fast", thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high") => Promise<void>;
  /** Branching: replace the latest visible user message with edited text and
   *  run a new turn as a sibling. Older messages cannot be edited (would
   *  require re-rooting the tree). */
  editLatestUserMessage: (agentSlug: string, userId: string, userMessageId: string, text: string, modelOverride?: string, speed?: "standard" | "fast", thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high") => Promise<void>;
  /** Branching: select which child of `parentId` should be visible. */
  selectBranch: (parentId: string, messageId: string) => void;
  /** Cancel the in-flight stream for the active session. No-op if nothing
   *  is sending. Hits the backend cancel endpoint so the agent stops doing work,
   *  then aborts the local fetch and marks the assistant message as cancelled. */
  stop: (userId: string) => Promise<void>;
  clear: () => void;
  loadConversation: (msgs: ChatMsg[], convId: string, invocationsByMsgId?: Map<string, ToolInvocation[]>, reasoningByMsgId?: Map<string, string>) => void;
  /** Feed a live event (from the /live SSE for a conversation this tab is
   *  VIEWING, not driving) into the session so the existing renderer shows tool
   *  calls + progress in real time. No-op for a session this tab is actively
   *  streaming. See ChatPageV3's live subscription effect. */
  applyLiveEvent: (convId: string, event: LiveEventInput) => void;
  /** Subscribe to "a new conversationId was assigned mid-stream" events.
   *  ChatPageV3 uses this to refresh its sidebar list so the in-flight draft
   *  appears immediately, not only after the stream completes. */
  onConversationCreated: (cb: (info: { agentSlug: string; conversationId: string }) => void) => () => void;
  approvePendingAction: (messageId: string, action: PendingAction, resultText: string) => void;
  declinePendingAction: (messageId: string, action: PendingAction) => void;
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

  const removePendingAction = useCallback((
    map: Map<string, PendingAction[]>,
    messageId: string,
    action: PendingAction,
  ): Map<string, PendingAction[]> => {
    const next = new Map(map);
    const current = next.get(messageId) ?? [];
    // Remove ONLY the exact action that was approved/declined — matched by its
    // unique HMAC signature. Dedup of duplicate cards is handled separately at
    // storage time (dedupePendingActions). Using logical-key removal here was
    // wrong: two different tools with empty params share the same logical key
    // and approving one would silently remove the other.
    const remaining = current.filter((pa) =>
      !(pa.serverType === action.serverType && pa.tool === action.tool && pa.signature === action.signature)
    );
    if (remaining.length > 0) next.set(messageId, remaining);
    else next.delete(messageId);
    return next;
  }, []);

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

      // Stitch the new user message under the visible last assistant so the
      // tree stays consistent — the backend uses parentAssistantMessageId to
      // decide which subtree to extend.
      const currentSession = sessions.get(key);
      const visible = currentSession
        ? projectBranchMessages(currentSession.messages, currentSession.branchSelection).messages
        : [];
      const parentAssistantMessageId = findVisibleParentAssistantId(visible);

      const userMsg: ChatMsg = {
        id: crypto.randomUUID(),
        conversationId: initialConvId ?? "",
        role: "user",
        content: text,
        status: "complete",
        createdAt: new Date().toISOString(),
        parentId: parentAssistantMessageId ?? null,
        // Show the attached-context pills on the just-sent turn immediately
        // (matches what a later reload renders from the persisted column).
        ...(opts?.attachedContext && opts.attachedContext.length > 0
          ? { contextItems: opts.attachedContext }
          : {}),
      };

      const assistantId = crypto.randomUUID();
      const assistantPlaceholder: ChatMsg = {
        id: assistantId,
        conversationId: initialConvId ?? "",
        role: "assistant",
        content: "",
        status: "streaming",
        createdAt: new Date().toISOString(),
        parentId: userMsg.id,
      };

      updateSession(key, (s) => ({
        ...s,
        agentSlug,
        runSessionId: null,
        sending: true,
        streamingMsgId: assistantId,
        liveInvocations: [],
        livePlanTodos: [],
        liveReasoning: "",
        toolLabel: null,
        debugEvents: [],
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
        onPlan: (todos) => updateSession(liveKey, (s) => ({ ...s, livePlanTodos: todos })),
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
        onDebugEvent: (event) =>
          updateSession(liveKey, (s) => ({
            ...s,
            debugEvents: [...s.debugEvents, event],
          })),
        onDebugArtifactsReady: () =>
          updateSession(liveKey, (s) => ({
            ...s,
            debugArtifactsReadyVersion: s.debugArtifactsReadyVersion + 1,
          })),
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
          undefined,                     // isRegenerate
          undefined,                     // parentUserMessageId
          parentAssistantMessageId,      // parentAssistantMessageIdOrSignal
          undefined,                     // signalOrIsEditUserMessage
          undefined,                     // editedUserMessageId
          controller.signal,             // signal
          {
            ...(opts?.disableTools ? { disableTools: true } : {}),
            ...(opts?.additionalInstructions ? { additionalInstructions: opts.additionalInstructions } : {}),
            ...(opts?.studioMode ? { studioMode: opts.studioMode } : {}),
            ...(opts?.designArtifactAttachmentId ? { designArtifactAttachmentId: opts.designArtifactAttachmentId } : {}),
            ...(opts?.designSelection ? { designSelection: opts.designSelection } : {}),
            ...(opts?.modelOverride ? { providerOverride: { provider: "litellm", model: opts.modelOverride } } : {}),
            ...(opts?.researchContext ? { researchContext: opts.researchContext } : {}),
            ...(opts?.speed ? { speed: opts.speed } : {}),
            ...(opts?.thinkingLevel ? { thinkingLevel: opts.thinkingLevel } : {}),
          },
        );

        const finalConvId = result.conversationId;
        // Belt-and-braces: if for some reason the meta event never fired
        // (older backend, parser glitch), migrate now using the result.
        migrateDraftToReal(finalConvId);

        updateSession(liveKey, (s) => {
          // Swap optimistic ids → persisted ids so branch selection,
          // invocation maps, and parent references stay coherent across reload.
          const withUserId = result.reply.userMessageId
            ? replaceMessageId(s, userMsg.id, result.reply.userMessageId)
            : s;
          const withAssistantId = replaceMessageId(withUserId, assistantId, result.reply.id ?? assistantId);
          const finalAssistantId = result.reply.id ?? assistantId;
          return {
            ...withAssistantId,
            conversationId: finalConvId,
            sending: false,
            streamingMsgId: null,
            liveInvocations: [],
            livePlanTodos: [],
            liveReasoning: "",
            toolLabel: null,
            debugEvents: [],
            messages: withAssistantId.messages.map((m) =>
              m.id === finalAssistantId
                ? {
                    ...m,
                    content: result.reply.content || m.content,
                    status: "complete",
                    parentId: result.reply.parentId ?? m.parentId,
                    // The final SSE event carries the durable GCS-backed
                    // attachment metadata. Keep it on the message so artifact
                    // surfaces (including Design) can render the generated
                    // file immediately without polling the transcript again.
                    attachments: result.reply.attachments ?? m.attachments,
                  }
                : m,
            ),
            pendingActionsByMsgId: (() => {
              const next = new Map(withAssistantId.pendingActionsByMsgId);
              next.delete(assistantId);
              if (result.reply.pendingActions && result.reply.pendingActions.length > 0) {
                next.set(finalAssistantId, dedupePendingActions(result.reply.pendingActions));
              } else {
                next.delete(finalAssistantId);
              }
              return next;
            })(),
          };
        });

        abortRefs.current.delete(liveKey);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          updateSession(liveKey, (s) => {
            const wasUserStopped = s.messages.some(
              (m) => m.id === assistantId && m.status === "cancelled",
            );
            return {
              ...s,
              sending: false,
              streamingMsgId: null,
              liveInvocations: [],
              livePlanTodos: [],
              liveReasoning: "",
              toolLabel: null,
              debugEvents: [],
              // If stop() already marked the message cancelled, keep it so the
              // UI can show a "Stopped" indicator. Otherwise (unexpected abort)
              // remove the empty placeholder silently.
              messages: wasUserStopped
                ? s.messages
                : s.messages.filter((m) => m.id !== assistantId),
              pendingActionsByMsgId: (() => {
                const next = new Map(s.pendingActionsByMsgId);
                next.delete(assistantId);
                return next;
              })(),
            };
          });
          return;
        }
        updateSession(liveKey, (s) => ({
          ...s,
          sending: false,
          streamingMsgId: null,
          liveInvocations: [],
          livePlanTodos: [],
          liveReasoning: "",
          toolLabel: null,
          debugEvents: [],
          messages: s.messages.map((m) =>
            m.id === assistantId ? { ...m, status: "error" } : m,
          ),
          pendingActionsByMsgId: (() => {
            const next = new Map(s.pendingActionsByMsgId);
            next.delete(assistantId);
            return next;
          })(),
        }));
        abortRefs.current.delete(liveKey);
      }
    },
    [activeKey, sessions, updateSession],
  );

  const regenerate = useCallback(
    async (agentSlug: string, userId: string, assistantMessageId?: string, modelOverride?: string, speed?: "standard" | "fast", thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high") => {
      const key = activeKey;
      if (!key) return;
      const current = sessions.get(key);
      if (!current || current.sending || !current.conversationId) return;

      const visible = projectBranchMessages(current.messages, current.branchSelection).messages;
      const assistantToRegenerate = assistantMessageId
        ? visible.find((msg) => msg.id === assistantMessageId && msg.role === "assistant")
        : [...visible].reverse().find((msg) => msg.role === "assistant");
      const parentUserMessageId = assistantToRegenerate?.parentId;
      const userMsg = parentUserMessageId
        ? current.messages.find((msg) => msg.id === parentUserMessageId && msg.role === "user")
        : undefined;
      if (!assistantToRegenerate || !parentUserMessageId || !userMsg) return;

      abortRefs.current.get(key)?.abort();
      const controller = new AbortController();
      abortRefs.current.set(key, controller);

      const assistantId = crypto.randomUUID();
      const assistantPlaceholder: ChatMsg = {
        id: assistantId,
        conversationId: current.conversationId,
        role: "assistant",
        content: "",
        status: "streaming",
        createdAt: new Date().toISOString(),
        parentId: parentUserMessageId,
      };

      updateSession(key, (s) => ({
        ...s,
        agentSlug,
        runSessionId: null,
        sending: true,
        streamingMsgId: assistantId,
        liveInvocations: [],
        livePlanTodos: [],
        liveReasoning: "",
        toolLabel: null,
        debugEvents: [],
        branchSelection: {
          ...s.branchSelection,
          [branchKey(parentUserMessageId)]: assistantId,
        },
        messages: [...s.messages, assistantPlaceholder],
      }));

      const callbacks: StreamCallbacks = {
        onRunMeta: ({ sessionId }) =>
          updateSession(key, (s) => ({ ...s, runSessionId: sessionId })),
        onProgress: (label) => updateSession(key, (s) => ({ ...s, toolLabel: label })),
        onPlan: (todos) => updateSession(key, (s) => ({ ...s, livePlanTodos: todos })),
        onInvocation: (inv) =>
          updateSession(key, (s) => {
            const nextLive = inv.toolCallId
              ? (() => {
                  const idx = s.liveInvocations.findIndex((p) => p.toolCallId === inv.toolCallId);
                  if (idx === -1) return [...s.liveInvocations, inv];
                  const updated = s.liveInvocations.slice();
                  updated[idx] = inv;
                  return updated;
                })()
              : [...s.liveInvocations, inv];
            const nextMap = new Map(s.invocationsByMsgId);
            const list = nextMap.get(assistantId) ?? [];
            if (!inv.toolCallId) {
              nextMap.set(assistantId, [...list, inv]);
            } else {
              const idx = list.findIndex((p) => p.toolCallId === inv.toolCallId);
              if (idx === -1) nextMap.set(assistantId, [...list, inv]);
              else {
                const updated = list.slice();
                updated[idx] = inv;
                nextMap.set(assistantId, updated);
              }
            }
            return { ...s, liveInvocations: nextLive, invocationsByMsgId: nextMap };
          }),
        onReasoningDelta: (delta) =>
          updateSession(key, (s) => {
            const nextMap = new Map(s.reasoningByMsgId);
            nextMap.set(assistantId, (nextMap.get(assistantId) ?? "") + delta);
            return { ...s, liveReasoning: s.liveReasoning + delta, reasoningByMsgId: nextMap };
          }),
        onTextDelta: (delta) =>
          updateSession(key, (s) => ({
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
          userMsg.content,
          userId,
          current.conversationId,
          callbacks,
          undefined,
          undefined,
          true,                          // isRegenerate
          parentUserMessageId,           // parentUserMessageId
          assistantToRegenerate.id,      // parentAssistantMessageId — the assistant
                                         // being replaced. Backend uses THIS as the
                                         // leaf for branch-session resolution, so a
                                         // regenerate after edit-user clones from
                                         // the edit branch (not the original).
          undefined,                     // signalOrIsEditUserMessage
          undefined,                     // editedUserMessageId
          controller.signal,             // explicit terminal signal
          // Carry the per-chat model pick + fast mode + thinking so regenerate reruns the same way.
          {
            ...(modelOverride ? { providerOverride: { provider: "litellm", model: modelOverride } } : {}),
            ...(speed ? { speed } : {}),
            ...(thinkingLevel ? { thinkingLevel } : {}),
          },
        );
        updateSession(key, (s) => {
          const withAssistantId = replaceMessageId(s, assistantId, result.reply.id ?? assistantId);
          const finalAssistantId = result.reply.id ?? assistantId;
          return {
            ...withAssistantId,
            conversationId: result.conversationId,
            sending: false,
            streamingMsgId: null,
            liveInvocations: [],
            livePlanTodos: [],
            liveReasoning: "",
            toolLabel: null,
            debugEvents: [],
            messages: withAssistantId.messages.map((m) =>
              m.id === finalAssistantId
                ? {
                    ...m,
                    content: result.reply.content || m.content,
                    status: "complete",
                    parentId: result.reply.parentId ?? m.parentId,
                  }
                : m,
            ),
            pendingActionsByMsgId: (() => {
              const next = new Map(withAssistantId.pendingActionsByMsgId);
              next.delete(assistantId);
              if (result.reply.pendingActions && result.reply.pendingActions.length > 0) {
                next.set(finalAssistantId, dedupePendingActions(result.reply.pendingActions));
              } else {
                next.delete(finalAssistantId);
              }
              return next;
            })(),
          };
        });
        abortRefs.current.delete(key);
      } catch (err) {
        updateSession(key, (s) => ({
          ...s,
          sending: false,
          streamingMsgId: null,
          liveInvocations: [],
          livePlanTodos: [],
          liveReasoning: "",
          toolLabel: null,
          debugEvents: [],
          messages: s.messages.map((m) =>
            m.id === assistantId
              ? { ...m, status: err instanceof Error && err.name === "AbortError" ? "cancelled" : "error" }
              : m,
          ),
        }));
        abortRefs.current.delete(key);
      }
    },
    [activeKey, sessions, updateSession],
  );

  const editLatestUserMessage = useCallback(
    async (agentSlug: string, userId: string, userMessageId: string, text: string, modelOverride?: string, speed?: "standard" | "fast", thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high") => {
      const key = activeKey;
      if (!key || !text.trim()) return;
      const current = sessions.get(key);
      if (!current || current.sending || !current.conversationId) return;

      const visible = projectBranchMessages(current.messages, current.branchSelection).messages;
      const latestUser = [...visible].reverse().find((msg) => msg.role === "user");
      const originalUser = current.messages.find((msg) => msg.id === userMessageId && msg.role === "user");
      // Only the latest visible user can be edited; older edits would require
      // re-rooting the tree, which is intentionally out of scope.
      if (!latestUser || latestUser.id !== userMessageId || !originalUser) return;

      abortRefs.current.get(key)?.abort();
      const controller = new AbortController();
      abortRefs.current.set(key, controller);

      const userIdLocal = crypto.randomUUID();
      const assistantId = crypto.randomUUID();
      const userMsg: ChatMsg = {
        id: userIdLocal,
        conversationId: current.conversationId,
        role: "user",
        content: text.trim(),
        status: "complete",
        createdAt: new Date().toISOString(),
        parentId: originalUser.parentId ?? null,
        // Editing keeps the same attached context — carry it onto the new turn.
        ...(originalUser.contextItems && originalUser.contextItems.length > 0
          ? { contextItems: originalUser.contextItems }
          : {}),
      };
      const assistantPlaceholder: ChatMsg = {
        id: assistantId,
        conversationId: current.conversationId,
        role: "assistant",
        content: "",
        status: "streaming",
        createdAt: new Date().toISOString(),
        parentId: userIdLocal,
      };

      updateSession(key, (s) => ({
        ...s,
        agentSlug,
        runSessionId: null,
        sending: true,
        streamingMsgId: assistantId,
        liveInvocations: [],
        livePlanTodos: [],
        liveReasoning: "",
        toolLabel: null,
        debugEvents: [],
        branchSelection: {
          ...s.branchSelection,
          [branchKey(originalUser.parentId ?? null)]: userIdLocal,
        },
        messages: [...s.messages, userMsg, assistantPlaceholder],
      }));

      const callbacks: StreamCallbacks = {
        onRunMeta: ({ sessionId }) =>
          updateSession(key, (s) => ({ ...s, runSessionId: sessionId })),
        onProgress: (label) => updateSession(key, (s) => ({ ...s, toolLabel: label })),
        onPlan: (todos) => updateSession(key, (s) => ({ ...s, livePlanTodos: todos })),
        onInvocation: (inv) =>
          updateSession(key, (s) => {
            const nextLive = inv.toolCallId
              ? (() => {
                  const idx = s.liveInvocations.findIndex((p) => p.toolCallId === inv.toolCallId);
                  if (idx === -1) return [...s.liveInvocations, inv];
                  const updated = s.liveInvocations.slice();
                  updated[idx] = inv;
                  return updated;
                })()
              : [...s.liveInvocations, inv];
            const nextMap = new Map(s.invocationsByMsgId);
            const list = nextMap.get(assistantId) ?? [];
            if (!inv.toolCallId) nextMap.set(assistantId, [...list, inv]);
            else {
              const idx = list.findIndex((p) => p.toolCallId === inv.toolCallId);
              if (idx === -1) nextMap.set(assistantId, [...list, inv]);
              else {
                const updated = list.slice();
                updated[idx] = inv;
                nextMap.set(assistantId, updated);
              }
            }
            return { ...s, liveInvocations: nextLive, invocationsByMsgId: nextMap };
          }),
        onReasoningDelta: (delta) =>
          updateSession(key, (s) => {
            const nextMap = new Map(s.reasoningByMsgId);
            nextMap.set(assistantId, (nextMap.get(assistantId) ?? "") + delta);
            return { ...s, liveReasoning: s.liveReasoning + delta, reasoningByMsgId: nextMap };
          }),
        onTextDelta: (delta) =>
          updateSession(key, (s) => ({
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
          text.trim(),
          userId,
          current.conversationId,
          callbacks,
          undefined,
          undefined,
          undefined,                     // isRegenerate
          undefined,                     // parentUserMessageId
          originalUser.parentId ?? undefined, // parentAssistantMessageId
          true,                          // isEditUserMessage flag
          originalUser.id,               // editedUserMessageId
          controller.signal,             // explicit terminal signal
          // Carry the per-chat model pick + fast mode + thinking so the edited turn reruns the same way.
          {
            ...(modelOverride ? { providerOverride: { provider: "litellm", model: modelOverride } } : {}),
            ...(speed ? { speed } : {}),
            ...(thinkingLevel ? { thinkingLevel } : {}),
          },
        );
        updateSession(key, (s) => {
          const withUserId = result.reply.userMessageId
            ? replaceMessageId(s, userIdLocal, result.reply.userMessageId)
            : s;
          const withAssistantId = replaceMessageId(withUserId, assistantId, result.reply.id ?? assistantId);
          const finalAssistantId = result.reply.id ?? assistantId;
          return {
            ...withAssistantId,
            conversationId: result.conversationId,
            sending: false,
            streamingMsgId: null,
            liveInvocations: [],
            livePlanTodos: [],
            liveReasoning: "",
            toolLabel: null,
            debugEvents: [],
            messages: withAssistantId.messages.map((m) =>
              m.id === finalAssistantId
                ? {
                    ...m,
                    content: result.reply.content || m.content,
                    status: "complete",
                    parentId: result.reply.parentId ?? m.parentId,
                  }
                : m,
            ),
            pendingActionsByMsgId: (() => {
              const next = new Map(withAssistantId.pendingActionsByMsgId);
              next.delete(assistantId);
              if (result.reply.pendingActions && result.reply.pendingActions.length > 0) {
                next.set(finalAssistantId, dedupePendingActions(result.reply.pendingActions));
              } else {
                next.delete(finalAssistantId);
              }
              return next;
            })(),
          };
        });
        abortRefs.current.delete(key);
      } catch (err) {
        updateSession(key, (s) => ({
          ...s,
          sending: false,
          streamingMsgId: null,
          liveInvocations: [],
          livePlanTodos: [],
          liveReasoning: "",
          toolLabel: null,
          debugEvents: [],
          messages: s.messages.map((m) =>
            m.id === assistantId
              ? { ...m, status: err instanceof Error && err.name === "AbortError" ? "cancelled" : "error" }
              : m,
          ),
        }));
        abortRefs.current.delete(key);
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
        livePlanTodos: [],
        liveReasoning: "",
        toolLabel: null,
        debugEvents: [],
        messages: s.messages.map((m) =>
          m.id === s.streamingMsgId ? { ...m, status: "cancelled" } : m,
        ),
      }));
    },
    [activeKey, sessions, updateSession],
  );

  const loadConversation = useCallback((msgs: ChatMsg[], convId: string, invocationsByMsgId?: Map<string, ToolInvocation[]>, reasoningByMsgId?: Map<string, string>) => {
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
        livePlanTodos: [],
        liveReasoning: "",
        streamingMsgId: null,
        debugEvents: [],
        debugArtifactsReadyVersion: 0,
        invocationsByMsgId: invocationsByMsgId ?? new Map(),
        reasoningByMsgId: reasoningByMsgId ?? new Map(),
        branchSelection: {},
        pendingActionsByMsgId: new Map(),
      });
      return next;
    });
    setActiveKey(convId);
  }, []);

  const approvePendingAction = useCallback((messageId: string, action: PendingAction, resultText: string) => {
    const key = activeKey;
    if (!key) return;
    const normalized = (resultText ?? "").trim();
    const truncated = normalized.length > 4000 ? `${normalized.slice(0, 4000)}\n... (truncated)` : normalized;
    const rendered = truncated.startsWith("{") || truncated.startsWith("[")
      ? `\n\n\`\`\`json\n${truncated}\n\`\`\``
      : `\n\n${truncated}`;
    updateSession(key, (s) => ({
      ...s,
      messages: s.messages.map((m) =>
        m.id === messageId
          ? { ...m, content: `${m.content}\n\n**${action.tool}** ->${rendered}`.trim() }
          : m,
      ),
      pendingActionsByMsgId: removePendingAction(s.pendingActionsByMsgId, messageId, action),
    }));
  }, [activeKey, removePendingAction, updateSession]);

  const declinePendingAction = useCallback((messageId: string, action: PendingAction) => {
    const key = activeKey;
    if (!key) return;
    updateSession(key, (s) => ({
      ...s,
      pendingActionsByMsgId: removePendingAction(s.pendingActionsByMsgId, messageId, action),
    }));
  }, [activeKey, removePendingAction, updateSession]);

  const applyLiveEvent = useCallback((convId: string, event: LiveEventInput) => {
    updateSession(convId, (s) => {
      // If THIS tab is driving the run (real streaming msg, not our placeholder),
      // its own SSE owns the live state — don't double-apply.
      if (s.sending && s.streamingMsgId && !s.streamingMsgId.startsWith(LIVE_PLACEHOLDER_PREFIX)) {
        return s;
      }
      const placeholderId = `${LIVE_PLACEHOLDER_PREFIX}${convId}`;
      const ensurePlaceholder = (sess: ChatSession): ChatSession => {
        if (sess.messages.some((m) => m.id === placeholderId)) return sess;
        const placeholder: ChatMsg = {
          id: placeholderId,
          conversationId: convId,
          role: "assistant",
          content: "",
          status: "streaming",
          createdAt: new Date().toISOString(),
        };
        // NOTE: do NOT set sending=true here. The render keys the live bubble off
        // status="streaming" / streamingMsgId, not sending. ChatPageV3's live
        // subscription effect depends on `sending` and bails when it's true (to
        // avoid double-subscribing while THIS tab drives a run) — flipping it
        // here would tear down the /live stream on the first event.
        return { ...sess, messages: [...sess.messages, placeholder], streamingMsgId: placeholderId };
      };
      const upsertInvocation = (list: ToolInvocation[], inv: ToolInvocation): ToolInvocation[] => {
        if (!inv.toolCallId) return [...list, inv];
        const idx = list.findIndex((p) => p.toolCallId === inv.toolCallId);
        if (idx === -1) return [...list, inv];
        const next = list.slice();
        next[idx] = inv;
        return next;
      };

      switch (event.type) {
        case "snapshot": {
          const inProg = event.inProgress ?? [];
          const partial = event.partial;
          // A live run exists if there are in-progress tools OR persisted partial
          // answer text. Seed the placeholder with both so a reloaded viewer sees
          // the answer-so-far + tools before the first live delta.
          if (inProg.length === 0 && !partial) return s; // no live run; transcript already loaded
          const hadPlaceholder = s.messages.some((m) => m.id === placeholderId);
          let seeded = ensurePlaceholder(s);
          // Seed the persisted partial ONLY when the bubble was just created. On a
          // reconnect re-snapshot the placeholder already holds live deltas that
          // are AHEAD of the (debounced ~1s) persisted partial, so overwriting
          // with the stale partial would truncate the visible answer.
          if (partial && !hadPlaceholder) {
            seeded = {
              ...seeded,
              messages: seeded.messages.map((m) => (m.id === placeholderId ? { ...m, content: partial.content } : m)),
              liveReasoning: partial.reasoning,
            };
          }
          return { ...seeded, liveInvocations: inProg.length ? inProg : seeded.liveInvocations };
        }
        case "label": {
          return { ...ensurePlaceholder(s), toolLabel: event.toolLabel ?? null };
        }
        case "invocation": {
          if (!event.toolInvocation) return s;
          const seeded = ensurePlaceholder(s);
          return { ...seeded, liveInvocations: upsertInvocation(seeded.liveInvocations, event.toolInvocation) };
        }
        case "delta": {
          // Append coalesced text/reasoning to the viewer's streaming bubble —
          // mirrors the driving tab's onTextDelta/onReasoningDelta reducers.
          const seeded = ensurePlaceholder(s);
          const next = { ...seeded };
          if (event.textDelta) {
            next.messages = seeded.messages.map((m) =>
              m.id === placeholderId ? { ...m, content: m.content + event.textDelta } : m,
            );
            next.toolLabel = null; // text is flowing → drop the "running tool" label
          }
          if (event.reasoningDelta) next.liveReasoning = seeded.liveReasoning + event.reasoningDelta;
          return next;
        }
        case "done": {
          // Tear down the placeholder + live state; ChatPageV3 refetches the
          // canonical transcript (assistant text + paired tool calls) next.
          return {
            ...s,
            sending: false,
            streamingMsgId: null,
            toolLabel: null,
            liveInvocations: [],
            livePlanTodos: [],
            messages: s.messages.filter((m) => m.id !== placeholderId),
          };
        }
        default:
          return s;
      }
    });
  }, [updateSession]);

  const selectBranch = useCallback(
    (parentId: string, messageId: string) => {
      const key = activeKey;
      if (!key) return;
      updateSession(key, (s) => ({
        ...s,
        branchSelection: {
          ...s.branchSelection,
          [parentId]: messageId,
        },
      }));
    },
    [activeKey, updateSession],
  );

  const active = activeKey ? sessions.get(activeKey) ?? EMPTY_SESSION : EMPTY_SESSION;
  const projected = useMemo(
    () => projectBranchMessages(active.messages, active.branchSelection),
    [active.messages, active.branchSelection],
  );

  const value = useMemo<ChatContextValue>(
    () => ({
      messages: projected.messages,
      conversationId: active.conversationId,
      sending: active.sending,
      toolLabel: active.toolLabel,
      invocations: active.liveInvocations,
      planTodos: active.livePlanTodos,
      reasoning: active.liveReasoning,
      reasoningByMsgId: active.reasoningByMsgId,
      invocationsByMsgId: active.invocationsByMsgId,
      branchInfoByMsgId: projected.branchInfoByMsgId,
      pendingActionsByMsgId: active.pendingActionsByMsgId,
      streamingMsgId: active.streamingMsgId,
      debugEvents: active.debugEvents,
      debugArtifactsReadyVersion: active.debugArtifactsReadyVersion,
      activeAgentSlug,
      setActiveAgentSlug,
      send,
      regenerate,
      editLatestUserMessage,
      selectBranch,
      stop,
      clear,
      loadConversation,
      applyLiveEvent,
      onConversationCreated,
      approvePendingAction,
      declinePendingAction,
    }),
    [
      active, projected,
      activeAgentSlug,
      send, regenerate, editLatestUserMessage, selectBranch,
      stop,
      clear,
      loadConversation,
      applyLiveEvent,
      onConversationCreated,
      approvePendingAction,
      declinePendingAction,
    ],
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
