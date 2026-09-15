import { useState, useEffect, useRef, useCallback, useMemo, type ReactElement } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Bug, ChevronLeft, Send, Square, Loader2, Plus, MessageSquare, ImagePlus, X, AtSign, Hash, Ticket, FileText, Phone, RefreshCw, GitBranch } from "lucide-react";
import {
  sendChatMessage,
  pollChatMessages,
  listChatConversations,
  listRuns,
  uploadChatAttachments,
  chatAttachmentDownloadUrl,
  listAgents,
  getUserAgentConfig,
  setUserAgentConfig,
  listProviderCredentials,
  upsertProviderCredential,
  listClaudeModelsForUser,
  listCopilotModelsForUser,
  listCodexModelsForUser,
  approveChatAction,
  cancelChatRun,
  type ChatMsg,
  type ConversationSummary,
  type AgentRun,
  type ToolInvocation,
  type DebugEventRecord,
  type UserAgentConfig,
  type ProviderCredential,
  type PendingAction,
  type ContextItem,
  type ContextSearchType,
  type AttachedContextRef,
} from "../lib/api";
import type { AgentLight } from "../lib/types";
import { resolveEffectiveParents } from "../lib/branching";
import { MessageBubble } from "./MessageBubble";
import { MessageRatingButtons } from "./MessageRatingButtons";
import { ContextPicker } from "./ContextPicker";
import { DebugDrawer } from "./DebugDrawer";

interface Props {
  userId: string;
}

function isCurrentAssistantTurn(messages: ChatMsg[], turnIndex: number, streamingMsgId: string | null): boolean {
  if (!streamingMsgId) return false;
  const streamingIndex = messages.findIndex((message) => message.id === streamingMsgId && message.role === "assistant");
  if (streamingIndex < 0) return false;
  return messages.slice(0, streamingIndex + 1).filter((message) => message.role === "assistant").length - 1 === turnIndex;
}

interface ProviderOption {
  id: string;
  label: string;
  needsCreds: boolean;
}

const PROVIDERS: ProviderOption[] = [
  { id: "spaces", label: "Spaces (Default)", needsCreds: false },
  { id: "copilot", label: "GitHub Copilot", needsCreds: true },
  { id: "claude", label: "Anthropic Claude", needsCreds: true },
  { id: "codex", label: "OpenAI (Codex)", needsCreds: true },
];

const MAX_CONTEXT_TOTAL = 20;
const MAX_CONTEXT_PER_TYPE = 5;

/** Re-key a Map<string, T> after an optimistic id is swapped for the persisted
 *  one. Used to keep per-message reasoning / streaming-attachment maps stable
 *  across the local→persisted id transition. */
function replaceMessageIdInMap<T>(map: Map<string, T>, localId: string, persistedId: string): Map<string, T> {
  if (!persistedId || persistedId === localId || !map.has(localId)) return map;
  const next = new Map(map);
  const value = next.get(localId)!;
  next.delete(localId);
  next.set(persistedId, value);
  return next;
}

/** Re-key the branchSelections map so a parentId/selectedId that referenced
 *  the old optimistic id continues to point at the persisted one. */
function replaceMessageIdInSelections(
  map: Map<string, string>,
  localId: string,
  persistedId: string,
): Map<string, string> {
  if (!persistedId || persistedId === localId) return map;
  const next = new Map<string, string>();
  for (const [parentId, selectedId] of map.entries()) {
    next.set(parentId === localId ? persistedId : parentId, selectedId === localId ? persistedId : selectedId);
  }
  return next;
}

export function AgentChat({ userId }: Props) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const slug = searchParams.get("agent") ?? "";

  const [agents, setAgents] = useState<AgentLight[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [providerConfig, setProviderConfig] = useState<UserAgentConfig | null>(null);
  const [providerCreds, setProviderCreds] = useState<ProviderCredential[]>([]);
  const [savingProvider, setSavingProvider] = useState(false);
  // Live model catalog for the active provider's credential.
  const [providerModels, setProviderModels] = useState<Array<{ id: string; name: string }>>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [showProviderMenu, setShowProviderMenu] = useState(false);
  const providerMenuRef = useRef<HTMLDivElement | null>(null);

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Auto-resize textarea to fit content, capped at ~8 lines. Re-runs every
  // keystroke; cheap because we just twiddle inline height.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);
  const [convId, setConvId] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  // Streaming state (Tier 1/2/3): populated from SSE events during an active run.
  // Scoped to the id of the currently-streaming assistant placeholder message.
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null);
  const [liveInvocations, setLiveInvocations] = useState<ToolInvocation[]>([]);
  const [liveReasoning, setLiveReasoning] = useState<string>("");
  const [liveDebugEvents, setLiveDebugEvents] = useState<DebugEventRecord[]>([]);
  const [debugArtifactsReadyVersion, setDebugArtifactsReadyVersion] = useState(0);
  // Per-message reasoning (client-side only — the backend doesn't persist it yet).
  // Survives after streaming ends so the collapsible "Thought" block stays on the bubble.
  // Keyed by assistant message id; cleared when the conversation is switched.
  const [reasoningByMsgId, setReasoningByMsgId] = useState<Map<string, string>>(new Map());
  // Per-message pending write-tool actions (client-side only — once approved
  // or declined they're removed from the map). Same Map pattern as reasoning.
  const [pendingActionsByMsgId, setPendingActionsByMsgId] = useState<Map<string, PendingAction[]>>(new Map());
  // Transient attachments streamed while the agent is still running (blob URLs
  // pointing at base64 payloads in memory). Cleared on finalize — the final
  // `done` event ships canonical GCS-backed attachments on the message itself.
  const [streamingAttachmentsByMsgId, setStreamingAttachmentsByMsgId] = useState<Map<string, Array<{ id: string; mimeType: string; originalFilename: string; size: number; blobUrl: string }>>>(new Map());
  // Branching: parentId → selected childId. Drives the visible path projection.
  // Persisted to localStorage so navigating away and back keeps the same branch.
  const [branchSelections, setBranchSelections] = useState<Map<string, string>>(new Map());
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingUserText, setEditingUserText] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [pendingFiles, setPendingFiles] = useState<Array<{ file: File; previewUrl: string }>>([]);
  const [showContextPicker, setShowContextPicker] = useState(false);
  const [contextQuery, setContextQuery] = useState("");
  const [contextTab, setContextTab] = useState<ContextSearchType>("all");
  const [selectedContext, setSelectedContext] = useState<ContextItem[]>([]);
  const [contextToast, setContextToast] = useState<string | null>(null);
  const contextToastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [localPreviews, setLocalPreviews] = useState<Map<string, string>>(new Map());
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [showDebugger, setShowDebugger] = useState(false);
  const [debugTurnIndex, setDebugTurnIndex] = useState<number | null>(null);
  // Branching-safe selector: pins debug drawer to the run with this sessionId.
  // Chronological turn order diverges from visible-path order once a turn has
  // siblings (regen / edit-user), so we look up via runByAssistantMsgId.
  const [debugSessionId, setDebugSessionId] = useState<string | null>(null);
  const [debuggerWidth, setDebuggerWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("legacy-chat-debugger-width");
      return saved ? parseInt(saved, 10) : 420;
    } catch {
      return 420;
    }
  });
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeAbortRef = useRef<AbortController | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);

  // Load agents once (all agents the user can chat with)
  useEffect(() => {
    listAgents(userId)
      .then((list) => {
        const visible = list.filter((a) => a.enabled);
        setAgents(visible);
        // If URL has no agent, pick the first one
        if (!slug && visible.length > 0) {
          const first = visible[0]!;
          setSearchParams({ agent: first.slug }, { replace: true });
        }
      })
      .catch((err) => console.error("[agent-chat] listAgents error:", err))
      .finally(() => setAgentsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per userId
  }, [userId]);

  // When the selected agent changes, reset chat state and load fresh data.
  useEffect(() => {
    if (!slug) return;
    activeAbortRef.current?.abort();
    activeAbortRef.current = null;
    activeSessionIdRef.current = null;
    setMessages([]);
    setRuns([]);
    setConvId(null);
    setWaiting(false);
    setProgress(null);
    setStreamingMsgId(null);
    setLiveReasoning("");
    setLiveInvocations([]);
    setLiveDebugEvents([]);
    setReasoningByMsgId(new Map());
    setDebugSessionId(null);
    setShowContextPicker(false);
    setContextQuery("");
    setContextTab("all");
    setSelectedContext([]);
    setContextToast(null);
    setLoadingHistory(true);

    Promise.all([
      listChatConversations(slug, userId).catch(() => []),
      getUserAgentConfig(slug, userId).catch(() => null),
      listProviderCredentials(userId).catch(() => []),
    ])
      .then(([convs, cfg, creds]) => {
        setConversations(convs);
        setProviderConfig(cfg);
        setProviderCreds(creds);
        // Deep-link: ?conv=<id> lands on a specific conversation (e.g. from Control Center "Open chat")
        const deepLinked = searchParams.get("conv");
        const target = deepLinked && convs.some((c) => c.conversationId === deepLinked)
          ? deepLinked
          : (convs[0]?.conversationId ?? null);
        if (target) loadConversation(target);
      })
      .finally(() => setLoadingHistory(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when selected agent changes
  }, [slug, userId]);

  // Scroll to bottom on new messages
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // Load saved branch selections when the conversation changes; persist on
  // change. Keeps the user on the same branch across refresh / re-open.
  useEffect(() => {
    if (!convId) {
      setBranchSelections(new Map());
      return;
    }
    const saved = localStorage.getItem(`xyne-ai-branch:${convId}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as [string, string][];
        setBranchSelections(new Map(parsed));
      } catch {
        setBranchSelections(new Map());
      }
    } else {
      setBranchSelections(new Map());
    }
  }, [convId]);

  useEffect(() => {
    if (!convId) return;
    if (branchSelections.size > 0) {
      localStorage.setItem(`xyne-ai-branch:${convId}`, JSON.stringify([...branchSelections]));
    } else {
      localStorage.removeItem(`xyne-ai-branch:${convId}`);
    }
  }, [branchSelections, convId]);

  useEffect(() => {
    return () => {
      if (contextToastTimeoutRef.current) {
        clearTimeout(contextToastTimeoutRef.current);
      }
      activeAbortRef.current?.abort();
    };
  }, []);

  // Close provider menu on outside click or Escape
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!showProviderMenu) return;
      if (!providerMenuRef.current) return;
      if (e.target instanceof Node && providerMenuRef.current.contains(e.target)) return;
      setShowProviderMenu(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShowProviderMenu(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [showProviderMenu]);

  const loadConversation = useCallback(async (id: string) => {
    if (!slug) return;
    setConvId(id);
    setReasoningByMsgId(new Map()); // reasoning is per-session, not persisted in DB
    setLiveDebugEvents([]);
    try {
      const [history, runList] = await Promise.all([
        pollChatMessages(slug, id),
        listRuns(userId, { conversationId: id, agentSlug: slug, limit: 100 }).catch(() => []),
      ]);
      setMessages(history.messages);
      setRuns(runList);
    } catch {
      setMessages([]);
      setRuns([]);
    }
  }, [slug, userId]);

  const handleApproveAction = useCallback(async (msgId: string, pa: PendingAction) => {
    if (!slug) return;
    // Execute the action on the server. On success, append the tool's result
    // to the assistant message's content so the user sees what happened, and
    // remove the action from the pending map so the buttons collapse.
    const resultText = await approveChatAction(slug, userId, pa);
    setMessages((prev) => prev.map((m) => m.id === msgId
      ? { ...m, content: `${m.content}\n\n**${pa.tool}** → ${resultText}`.trim() }
      : m,
    ));
    setPendingActionsByMsgId((prev) => {
      const next = new Map(prev);
      const rest = (next.get(msgId) ?? []).filter((p) => p.signature !== pa.signature);
      if (rest.length === 0) next.delete(msgId); else next.set(msgId, rest);
      return next;
    });
  }, [slug, userId]);

  const handleDeclineAction = useCallback((msgId: string, pa: PendingAction) => {
    // No server call for decline — the signed action just gets dropped locally.
    setPendingActionsByMsgId((prev) => {
      const next = new Map(prev);
      const rest = (next.get(msgId) ?? []).filter((p) => p.signature !== pa.signature);
      if (rest.length === 0) next.delete(msgId); else next.set(msgId, rest);
      return next;
    });
  }, []);

  const handleDebuggerResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = debuggerWidth;
    let currentWidth = startWidth;

    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX;
      currentWidth = Math.max(320, Math.min(760, startWidth + delta));
      setDebuggerWidth(currentWidth);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      try {
        localStorage.setItem("legacy-chat-debugger-width", String(currentWidth));
      } catch {}
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [debuggerWidth]);

  const refreshRuns = useCallback(async (id: string) => {
    if (!slug) return;
    try {
      const runList = await listRuns(userId, { conversationId: id, agentSlug: slug, limit: 100 });
      setRuns(runList);
    } catch { /* no-op */ }
  }, [slug, userId]);

  const runByAssistantMsgId = useMemo(() => {
    const map = new Map<string, AgentRun>();
    // Direct linkage via chatMessageId (set by the chat callback). Required
    // for branching — chronology pairing breaks once a user message has
    // multiple assistant siblings.
    for (const run of runs) {
      if (run.chatMessageId) map.set(run.chatMessageId, run);
    }
    // Fallback for legacy rows missing chatMessageId. Filter both lists on
    // the SAME predicate so positions match.
    const mappedIds = new Set(map.keys());
    const unmappedAssistants = messages
      .filter((m) => m.role === "assistant" && !mappedIds.has(m.id))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const unmappedRuns = runs
      .filter((r) => !r.chatMessageId)
      .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
    const pairCount = Math.min(unmappedAssistants.length, unmappedRuns.length);
    for (let i = 0; i < pairCount; i++) {
      map.set(unmappedAssistants[i]!.id, unmappedRuns[i]!);
    }
    return map;
  }, [messages, runs]);

  // Legacy conversations (pre-branching migration) have a null parentId on every
  // message; reconstruct effective parents so they project as a linear thread
  // instead of collapsing into one message with <x/y> variant pages. Shared by
  // both the adjacency build and the per-message sibling lookup in render.
  const effectiveParentById = useMemo(() => resolveEffectiveParents(messages), [messages]);

  // Tree-projection: build adjacency, then walk the selected path from root.
  const childrenByParent = useMemo(() => {
    const map = new Map<string, ChatMsg[]>();
    for (const msg of messages) {
      const parentId = effectiveParentById.get(msg.id) ?? "root";
      const siblings = map.get(parentId) ?? [];
      siblings.push(msg);
      siblings.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      map.set(parentId, siblings);
    }
    return map;
  }, [messages, effectiveParentById]);

  const activePath = useMemo(() => {
    const path: ChatMsg[] = [];
    let currentParentId = "root";
    const seen = new Set<string>();
    while (true) {
      const children = childrenByParent.get(currentParentId);
      if (!children || children.length === 0) break;
      const selectedId = branchSelections.get(currentParentId);
      const activeChild = selectedId ? children.find((c) => c.id === selectedId) : undefined;
      const child = activeChild ?? children[children.length - 1];
      if (!child || seen.has(child.id)) break;
      path.push(child);
      seen.add(child.id);
      currentParentId = child.id;
    }
    return path;
  }, [childrenByParent, branchSelections]);

  const latestAssistantMsgId = useMemo(() => {
    for (let i = activePath.length - 1; i >= 0; i--) {
      if (activePath[i]!.role === "assistant") return activePath[i]!.id;
    }
    return null;
  }, [activePath]);
  const latestUserMsgId = useMemo(() => {
    for (let i = activePath.length - 1; i >= 0; i--) {
      if (activePath[i]!.role === "user") return activePath[i]!.id;
    }
    return null;
  }, [activePath]);

  const startNewChat = () => {
    activeAbortRef.current?.abort();
    activeAbortRef.current = null;
    activeSessionIdRef.current = null;
    setConvId(null);
    setMessages([]);
    setProgress(null);
    setWaiting(false);
    setStreamingMsgId(null);
    setSelectedContext([]);
    setShowContextPicker(false);
    setContextQuery("");
    setContextTab("all");
    setContextToast(null);
    setLiveDebugEvents([]);
  };

  const refreshConversations = useCallback(() => {
    if (!slug) return;
    listChatConversations(slug, userId).then(setConversations).catch((err) => console.error("[agent-chat] refresh error:", err));
  }, [slug, userId]);

  const handleAgentChange = useCallback((nextSlug: string) => {
    if (!nextSlug || nextSlug === slug) return;
    setSearchParams({ agent: nextSlug }, { replace: true });
  }, [slug, setSearchParams]);

  const handleProviderChange = useCallback(async (nextProvider: string) => {
    if (!slug || !nextProvider || nextProvider === providerConfig?.provider) return;
    setSavingProvider(true);
    try {
      const updated = await setUserAgentConfig(slug, userId, { provider: nextProvider });
      setProviderConfig(updated);
    } catch (err) {
      console.error("[agent-chat] provider save error:", err);
    } finally {
      setSavingProvider(false);
    }
  }, [slug, userId, providerConfig?.provider]);

  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const additions: Array<{ file: File; previewUrl: string }> = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      if (file.size > 25 * 1024 * 1024) { console.warn("[agent-chat] skipping image > 25MB"); continue; }
      additions.push({ file, previewUrl: URL.createObjectURL(file) });
    }
    setPendingFiles((prev) => [...prev, ...additions]);
    e.target.value = "";
  }, []);

  const removeImage = useCallback((idx: number) => {
    setPendingFiles((prev) => {
      const removed = prev[idx];
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  const showContextOverflowToast = useCallback((message: string) => {
    setContextToast(message);
    if (contextToastTimeoutRef.current) {
      clearTimeout(contextToastTimeoutRef.current);
    }
    contextToastTimeoutRef.current = setTimeout(() => setContextToast(null), 2500);
  }, []);

  const addSelectedContext = useCallback((item: ContextItem) => {
    if (selectedContext.some((ctx) => ctx.type === item.type && ctx.id === item.id)) return;
    if (item.type === "repository") {
      setSelectedContext((prev) => [...prev.filter((ctx) => ctx.type !== "repository"), item]);
      return;
    }
    if (selectedContext.length >= MAX_CONTEXT_TOTAL) {
      showContextOverflowToast(`Maximum ${MAX_CONTEXT_TOTAL} context items reached.`);
      return;
    }
    const sameTypeCount = selectedContext.filter((ctx) => ctx.type === item.type).length;
    if (sameTypeCount >= MAX_CONTEXT_PER_TYPE) {
      showContextOverflowToast(`Maximum ${MAX_CONTEXT_PER_TYPE} ${item.type} items allowed.`);
      return;
    }
    setSelectedContext((prev) => [...prev, item]);
  }, [selectedContext, showContextOverflowToast]);

  const removeSelectedContext = useCallback((item: Pick<ContextItem, "type" | "id">) => {
    setSelectedContext((prev) => prev.filter((ctx) => !(ctx.type === item.type && ctx.id === item.id)));
  }, []);

  const isAbortError = useCallback((err: unknown): boolean => {
    if (err instanceof DOMException && err.name === "AbortError") return true;
    return err instanceof Error && err.name === "AbortError";
  }, []);

  const handleStop = useCallback(async () => {
    if (!waiting || !slug) return;
    const sessionId = activeSessionIdRef.current;
    let conversationIdForRefresh = convId;

    if (sessionId) {
      try {
        const cancelled = await cancelChatRun(slug, userId, sessionId);
        if (cancelled.conversationId) {
          conversationIdForRefresh = cancelled.conversationId;
          setConvId(cancelled.conversationId);
        }
      } catch (err) {
        console.error("[agent-chat] cancel failed:", err);
      }
    }

    activeAbortRef.current?.abort();
    activeAbortRef.current = null;
    activeSessionIdRef.current = null;
    setWaiting(false);
    setProgress(null);

    if (streamingMsgId) {
      setMessages((prev) => prev.map((m) => m.id === streamingMsgId
        ? { ...m, status: "cancelled" }
        : m));
      setStreamingAttachmentsByMsgId((prev) => {
        const list = prev.get(streamingMsgId);
        if (!list) return prev;
        list.forEach((e) => URL.revokeObjectURL(e.blobUrl));
        const next = new Map(prev);
        next.delete(streamingMsgId);
        return next;
      });
    }

    setStreamingMsgId(null);
    setLiveReasoning("");
    setLiveInvocations([]);
    setLiveDebugEvents([]);

    refreshConversations();
    if (conversationIdForRefresh) {
      const refreshId = conversationIdForRefresh;
      await refreshRuns(refreshId);
      setTimeout(() => {
        loadConversation(refreshId).catch(() => {});
      }, 1000);
    }
  }, [waiting, slug, convId, userId, streamingMsgId, refreshConversations, refreshRuns, loadConversation]);

  // Branching: regenerate the latest visible assistant. Creates a sibling
  // assistant under the same user parent (driven server-side via /clone-session
  // + isRegenerate). The selected branch is moved to the new assistant so the
  // pager shows the fresh attempt by default.
  const handleRegenerate = useCallback(async () => {
    const originalConvId = convId;
    if (!slug || !originalConvId || waiting) return;

    const assistantToRegenerate = latestAssistantMsgId
      ? activePath.find((m) => m.id === latestAssistantMsgId && m.role === "assistant")
      : null;
    const parentUserMessageId = assistantToRegenerate?.parentId ?? null;
    const replayMessage = parentUserMessageId
      ? messages.find((m) => m.id === parentUserMessageId && m.role === "user")?.content
      : undefined;
    if (!assistantToRegenerate || !parentUserMessageId || !replayMessage) return;

    setWaiting(true);
    setProgress(null);

    const asstId = `asst-${Date.now()}`;
    setStreamingMsgId(asstId);
    setMessages((prev) => [
      ...prev,
      { id: asstId, conversationId: originalConvId, role: "assistant", content: "", status: "running", createdAt: new Date().toISOString(), parentId: parentUserMessageId },
    ]);
    setBranchSelections((prev) => new Map(prev).set(parentUserMessageId, asstId));

    setLiveInvocations([]);
    setLiveReasoning("");

    const controller = new AbortController();
    activeAbortRef.current = controller;
    activeSessionIdRef.current = null;

    sendChatMessage(slug, replayMessage, userId, originalConvId, {
      onRunMeta: ({ sessionId }) => { activeSessionIdRef.current = sessionId; },
      onProgress: (toolLabel) => setProgress(toolLabel),
      onInvocation: (inv) => setLiveInvocations((prev) => {
        if (!inv.toolCallId) return [...prev, inv];
        const idx = prev.findIndex((p) => p.toolCallId === inv.toolCallId);
        if (idx === -1) return [...prev, inv];
        const next = prev.slice();
        next[idx] = inv;
        return next;
      }),
      onReasoningDelta: (delta) => {
        setLiveReasoning((prev) => prev + delta);
        setReasoningByMsgId((prev) => {
          const next = new Map(prev);
          next.set(asstId, (next.get(asstId) ?? "") + delta);
          return next;
        });
      },
      onTextDelta: (delta) => {
        setMessages((prev) => prev.map((m) => m.id === asstId ? { ...m, content: m.content + delta } : m));
      },
    }, undefined, undefined, true, parentUserMessageId, assistantToRegenerate.id, controller.signal).then(async (res) => {
      // Pass assistantToRegenerate.id as `parentAssistantMessageId` so the
      // backend resolves the source PI session from the assistant being
      // replaced — not the parent user. Without this, regenerating after an
      // edit-user clones from the original conversation and the new turn
      // replays every user variant.
      setProgress(null);
      refreshConversations();
      await refreshRuns(res.conversationId);

      const persistedAssistantId = res.reply?.id ?? asstId;
      setMessages((prev) => prev.map((m) => {
        if (m.id !== asstId) return m;
        return {
          ...m,
          id: persistedAssistantId,
          content: res.reply?.content ?? m.content,
          status: (res.reply?.status as "completed" | "failed" | "cancelled" | undefined) ?? "completed",
          parentId: res.reply?.parentId ?? m.parentId,
          ...(res.reply?.attachments?.length ? { attachments: res.reply.attachments } : {}),
        };
      }));
      setBranchSelections((prev) => replaceMessageIdInSelections(prev, asstId, persistedAssistantId));
      setReasoningByMsgId((prev) => replaceMessageIdInMap(prev, asstId, persistedAssistantId));
      setStreamingAttachmentsByMsgId((prev) => replaceMessageIdInMap(prev, asstId, persistedAssistantId));

      if (res.reply?.pendingActions?.length) {
        setPendingActionsByMsgId((prev) => {
          const next = new Map(prev);
          next.set(persistedAssistantId, res.reply!.pendingActions!);
          return next;
        });
      }
      activeAbortRef.current = null;
      activeSessionIdRef.current = null;
      setStreamingMsgId(null);
      setWaiting(false);
      setLiveReasoning("");
      setLiveInvocations([]);
    }).catch((err) => {
      activeAbortRef.current = null;
      activeSessionIdRef.current = null;
      setProgress(null);
      setWaiting(false);
      setStreamingMsgId(null);
      setLiveReasoning("");
      setLiveInvocations([]);

      if (isAbortError(err)) {
        setMessages((prev) => prev.map((m) => m.id === asstId ? { ...m, status: "cancelled" } : m));
        return;
      }

      setMessages((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, conversationId: originalConvId, role: "assistant", content: "Failed to get response", status: "failed", createdAt: new Date().toISOString() },
      ]);
    });
  }, [slug, userId, convId, waiting, latestAssistantMsgId, activePath, messages, refreshConversations, refreshRuns, isAbortError]);

  // Branching: replace the latest visible user message with edited text and
  // run a new turn as a sibling branch.
  const handleEditLatestUser = useCallback(async (userMessageId: string, text: string) => {
    const originalConvId = convId;
    const nextText = text.trim();
    if (!slug || !originalConvId || waiting || !nextText) return;

    const latestUser = activePath.find((m) => m.id === userMessageId && m.role === "user");
    const originalUser = messages.find((m) => m.id === userMessageId && m.role === "user");
    if (!latestUser || latestUser.id !== latestUserMsgId || !originalUser || originalUser.content.trim() === nextText) return;

    setWaiting(true);
    setProgress(null);

    const userIdLocal = `tmp-${Date.now()}`;
    const asstId = `asst-${Date.now()}`;
    setStreamingMsgId(asstId);
    setMessages((prev) => [
      ...prev,
      {
        id: userIdLocal,
        conversationId: originalConvId,
        role: "user",
        content: nextText,
        status: "completed",
        createdAt: new Date().toISOString(),
        parentId: originalUser.parentId ?? null,
      },
      {
        id: asstId,
        conversationId: originalConvId,
        role: "assistant",
        content: "",
        status: "running",
        createdAt: new Date().toISOString(),
        parentId: userIdLocal,
      },
    ]);
    setBranchSelections((prev) => new Map(prev).set(originalUser.parentId ?? "root", userIdLocal));
    setLiveInvocations([]);
    setLiveReasoning("");

    const controller = new AbortController();
    activeAbortRef.current = controller;
    activeSessionIdRef.current = null;

    sendChatMessage(slug, nextText, userId, originalConvId, {
      onRunMeta: ({ sessionId }) => { activeSessionIdRef.current = sessionId; },
      onProgress: (toolLabel) => setProgress(toolLabel),
      onInvocation: (inv) => setLiveInvocations((prev) => {
        if (!inv.toolCallId) return [...prev, inv];
        const idx = prev.findIndex((p) => p.toolCallId === inv.toolCallId);
        if (idx === -1) return [...prev, inv];
        const next = prev.slice();
        next[idx] = inv;
        return next;
      }),
      onReasoningDelta: (delta) => {
        setLiveReasoning((prev) => prev + delta);
        setReasoningByMsgId((prev) => {
          const next = new Map(prev);
          next.set(asstId, (next.get(asstId) ?? "") + delta);
          return next;
        });
      },
      onTextDelta: (delta) => {
        setMessages((prev) => prev.map((m) => m.id === asstId ? { ...m, content: m.content + delta } : m));
      },
    }, undefined, undefined, undefined, undefined, originalUser.parentId ?? undefined, true, originalUser.id, controller.signal).then(async (res) => {
      setProgress(null);
      refreshConversations();
      await refreshRuns(res.conversationId);

      const persistedUserId = res.reply?.userMessageId ?? userIdLocal;
      const persistedAssistantId = res.reply?.id ?? asstId;
      setMessages((prev) => prev.map((m) => {
        if (m.id === userIdLocal) return { ...m, id: persistedUserId, conversationId: res.conversationId };
        if (m.id === asstId) {
          return {
            ...m,
            id: persistedAssistantId,
            conversationId: res.conversationId,
            content: res.reply?.content ?? m.content,
            status: (res.reply?.status as "completed" | "failed" | "cancelled" | undefined) ?? "completed",
            parentId: res.reply?.parentId ?? persistedUserId,
            ...(res.reply?.attachments?.length ? { attachments: res.reply.attachments } : {}),
          };
        }
        return {
          ...m,
          parentId: m.parentId === userIdLocal ? persistedUserId : m.parentId === asstId ? persistedAssistantId : m.parentId,
        };
      }));
      setBranchSelections((prev) =>
        replaceMessageIdInSelections(replaceMessageIdInSelections(prev, userIdLocal, persistedUserId), asstId, persistedAssistantId),
      );
      setReasoningByMsgId((prev) => replaceMessageIdInMap(prev, asstId, persistedAssistantId));

      if (res.reply?.pendingActions?.length) {
        setPendingActionsByMsgId((prev) => {
          const next = new Map(prev);
          next.set(persistedAssistantId, res.reply!.pendingActions!);
          return next;
        });
      }
      activeAbortRef.current = null;
      activeSessionIdRef.current = null;
      setStreamingMsgId(null);
      setWaiting(false);
      setLiveReasoning("");
      setLiveInvocations([]);
    }).catch((err) => {
      activeAbortRef.current = null;
      activeSessionIdRef.current = null;
      setProgress(null);
      setWaiting(false);
      setStreamingMsgId(null);
      setLiveReasoning("");
      setLiveInvocations([]);

      if (isAbortError(err)) {
        setMessages((prev) => prev.map((m) => m.id === asstId ? { ...m, status: "cancelled" } : m));
        return;
      }

      setMessages((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, conversationId: originalConvId, role: "assistant", content: "Failed to get response", status: "failed", createdAt: new Date().toISOString() },
      ]);
    });
  }, [slug, userId, convId, waiting, activePath, messages, latestUserMsgId, refreshConversations, refreshRuns, isAbortError]);

  const handleSend = useCallback(async () => {
    if ((!input.trim() && pendingFiles.length === 0 && selectedContext.length === 0) || !slug || waiting) return;
    const msg = input.trim()
      || (pendingFiles.length > 0
        ? `Sent ${pendingFiles.length} image(s)`
        : `Attached ${selectedContext.length} context item(s)`);
    const files = pendingFiles.map((p) => p.file);
    const previews = pendingFiles.map((p) => p.previewUrl);
    const repositoryContext = selectedContext.find((item) => item.type === "repository");
    const contextToSend: AttachedContextRef[] = selectedContext
      .filter((item) => item.type !== "repository")
      .map((item) => ({
      type: item.type,
      id: item.id,
      title: item.title,
      ...(typeof item.meta?.["conversationId"] === "string" && item.meta["conversationId"].trim().length > 0
        ? { threadId: item.meta["conversationId"].trim() }
        : {}),
    } as AttachedContextRef));
    setInput("");
    setPendingFiles([]);
    setShowContextPicker(false);
    setContextQuery("");
    setContextTab("all");
    setContextToast(null);
    setWaiting(true);
    setProgress(null);

    let uploaded: Awaited<ReturnType<typeof uploadChatAttachments>> = [];
    if (files.length > 0) {
      try {
        uploaded = await uploadChatAttachments(slug, userId, files);
      } catch (err) {
        previews.forEach((u) => URL.revokeObjectURL(u));
        setWaiting(false);
        setMessages((prev) => [
          ...prev,
          { id: `err-${Date.now()}`, conversationId: convId ?? "", role: "assistant", content: err instanceof Error ? err.message : "Upload failed", status: "failed", createdAt: new Date().toISOString() },
        ]);
        return;
      }
    }

    if (uploaded.length > 0) {
      setLocalPreviews((prev) => {
        const next = new Map(prev);
        uploaded.forEach((a, i) => { if (previews[i]) next.set(a.id, previews[i]!); });
        return next;
      });
    } else {
      previews.forEach((u) => URL.revokeObjectURL(u));
    }

    // Branching: stitch the new user message under the visible last assistant.
    // The backend reads parentAssistantMessageId to decide which subtree to
    // extend (this mirrors V3 / useChat.send).
    const parentAssistantMessageId = latestAssistantMsgId ?? undefined;
    const tempId = `tmp-${Date.now()}`;
    const tempUser: ChatMsg = {
      id: tempId,
      conversationId: convId ?? "",
      role: "user",
      content: msg,
      status: "completed",
      createdAt: new Date().toISOString(),
      parentId: parentAssistantMessageId ?? null,
      ...(contextToSend.length > 0 ? { contextItems: contextToSend } : {}),
      ...(uploaded.length ? { attachments: uploaded } : {}),
    };

    // Create the assistant placeholder RIGHT ALONGSIDE the user message.
    // It stays at this id through streaming AND final — no unmount, no flash.
    // Content fills in from onTextDelta; invocations/reasoning render in the footer
    // via live state that's keyed to this id while `streamingMsgId === asstId`.
    const asstId = `asst-${Date.now()}`;
    setStreamingMsgId(asstId);
    setLiveDebugEvents([]);
    setMessages((prev) => [
      ...prev,
      tempUser,
      { id: asstId, conversationId: convId ?? "", role: "assistant", content: "", status: "running", createdAt: new Date().toISOString(), parentId: tempUser.id },
    ]);

    // Reset streaming state for the new request.
    setLiveInvocations([]);
    setLiveReasoning("");

    const attachmentIds = uploaded.map((a) => a.id);
    const controller = new AbortController();
    activeAbortRef.current = controller;
    activeSessionIdRef.current = null;

    sendChatMessage(slug, msg, userId, convId ?? undefined, {
      onRunMeta: ({ sessionId }) => {
        activeSessionIdRef.current = sessionId;
      },
      onConversationId: (conversationId) => {
        setConvId(conversationId);
        refreshConversations();
      },
      onProgress: (toolLabel) => setProgress(toolLabel),
      onInvocation: (inv) => setLiveInvocations((prev) => {
        // Merge semantics keyed by toolCallId:
        //   - First message (tool_execution_start) → pending row appears
        //   - Second message (tool_execution_end) → replaces with completed row
        //   - Retries / duplicates with same id → keep the most recent
        // No toolCallId (legacy) → append as-is.
        if (!inv.toolCallId) return [...prev, inv];
        const idx = prev.findIndex((p) => p.toolCallId === inv.toolCallId);
        if (idx === -1) return [...prev, inv];
        const next = prev.slice();
        next[idx] = inv;
        return next;
      }),
      onReasoningDelta: (delta) => {
        setLiveReasoning((prev) => prev + delta);
        // Also persist on the per-message map so the block stays visible AFTER
        // streaming ends (the backend doesn't currently save reasoning, so this
        // is a client-side memory of it that lives as long as the session).
        setReasoningByMsgId((prev) => {
          const next = new Map(prev);
          next.set(asstId, (next.get(asstId) ?? "") + delta);
          return next;
        });
      },
      onTextDelta: (delta) => {
        // Write the text delta directly onto the assistant placeholder so
        // the bubble is rendered through <MessageBubble> (same Markdown pipeline)
        // from the very first character. No separate streaming card, no swap.
        setMessages((prev) => prev.map((m) => m.id === asstId ? { ...m, content: m.content + delta } : m));
      },
      onAttachment: (att) => {
        // Turn the base64 payload into a same-tab blob URL so the bubble can
        // download it immediately. The final `done` event ships the persisted
        // GCS-backed version, at which point this entry is discarded.
        try {
          const byteChars = atob(att.data);
          const byteNumbers = new Array(byteChars.length);
          for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
          const bytes = new Uint8Array(byteNumbers);
          const blob = new Blob([bytes], { type: att.mimeType });
          const blobUrl = URL.createObjectURL(blob);
          const entry = {
            id: `streaming-${asstId}-${att.fileName}`,
            mimeType: att.mimeType,
            originalFilename: att.fileName,
            size: bytes.length,
            blobUrl,
          };
          setStreamingAttachmentsByMsgId((prev) => {
            const next = new Map(prev);
            const list = next.get(asstId) ?? [];
            if (list.some((e) => e.originalFilename === att.fileName)) return prev;
            next.set(asstId, [...list, entry]);
            return next;
          });
        } catch (err) {
          console.warn("[chat] streamed attachment decode failed:", err);
        }
      },
      onDebugEvent: (event) => {
        setLiveDebugEvents((prev) => [...prev, event]);
      },
      onDebugArtifactsReady: () => {
        setDebugArtifactsReadyVersion((version) => version + 1);
      },
    }, attachmentIds.length > 0 ? attachmentIds : undefined, contextToSend.length > 0 ? contextToSend : undefined, undefined, undefined, parentAssistantMessageId, controller.signal, undefined, undefined, repositoryContext ? {
      researchContext: { type: "repository", id: repositoryContext.id, name: repositoryContext.title },
    } : undefined).then(async (res) => {
      setConvId(res.conversationId);
      setProgress(null);
      refreshConversations();

      // Fetch runs first so the placeholder's footer can switch from live
      // invocations to the persisted AgentRun data in the same render.
      await refreshRuns(res.conversationId);

      // Finalize the placeholder IN-PLACE: same id, updated content + status.
      // The bubble stays mounted; only its content/status/footer re-render.
      // Branching: swap optimistic ids → persisted ids so parent/child links,
      // branch selections, and invocation maps stay coherent across reload.
      const persistedUserId = res.reply?.userMessageId ?? tempUser.id;
      const persistedAssistantId = res.reply?.id ?? asstId;
      setMessages((prev) => prev.map((m) => {
        if (m.id === tempUser.id) {
          return { ...m, id: persistedUserId, conversationId: res.conversationId };
        }
        if (m.id === asstId) {
          return {
            ...m,
            id: persistedAssistantId,
            conversationId: res.conversationId,
            content: res.reply?.content ?? m.content,
            status: (res.reply?.status as "completed" | "failed" | "cancelled" | undefined) ?? "completed",
            parentId: res.reply?.parentId ?? persistedUserId,
            ...(res.reply?.attachments?.length ? { attachments: res.reply.attachments } : {}),
          };
        }
        // Other rows may have referenced the temp ids as parents (rare on
        // V1 since we don't track follow-ups mid-stream, but harmless).
        return {
          ...m,
          parentId: m.parentId === tempUser.id ? persistedUserId : m.parentId === asstId ? persistedAssistantId : m.parentId,
        };
      }));
      setBranchSelections((prev) =>
        replaceMessageIdInSelections(replaceMessageIdInSelections(prev, tempUser.id, persistedUserId), asstId, persistedAssistantId),
      );
      setReasoningByMsgId((prev) => replaceMessageIdInMap(prev, asstId, persistedAssistantId));
      setStreamingAttachmentsByMsgId((prev) => replaceMessageIdInMap(prev, asstId, persistedAssistantId));
      // Attach any pending write-tool approvals to this message so MessageBubble
      // can render Approve/Decline cards under the reply. Same pattern Spaces
      // uses for its thread-message approval buttons.
      if (res.reply?.pendingActions?.length) {
        setPendingActionsByMsgId((prev) => {
          const next = new Map(prev);
          next.set(persistedAssistantId, res.reply!.pendingActions!);
          return next;
        });
      }
      activeAbortRef.current = null;
      activeSessionIdRef.current = null;
      setStreamingMsgId(null);
      setWaiting(false);
      setLiveReasoning("");
      setLiveInvocations([]);
      setLiveDebugEvents([]);
      // Streamed attachments are now redundant (the canonical persisted
      // versions rode in on res.reply.attachments and were merged onto the
      // assistant message). Revoke the blob URLs and drop the entry. NB:
      // the map was re-keyed above (replaceMessageIdInMap), so the entry now
      // lives under persistedAssistantId, not asstId.
      setStreamingAttachmentsByMsgId((prev) => {
        const list = prev.get(persistedAssistantId);
        if (!list) return prev;
        list.forEach((e) => URL.revokeObjectURL(e.blobUrl));
        const next = new Map(prev);
        next.delete(persistedAssistantId);
        return next;
      });
    }).catch((err) => {
      activeAbortRef.current = null;
      activeSessionIdRef.current = null;
      setProgress(null);
      setWaiting(false);
      setStreamingMsgId(null);
      setLiveReasoning("");
      setLiveInvocations([]);
      setLiveDebugEvents([]);
      setStreamingAttachmentsByMsgId((prev) => {
        const list = prev.get(asstId);
        if (!list) return prev;
        list.forEach((e) => URL.revokeObjectURL(e.blobUrl));
        const next = new Map(prev);
        next.delete(asstId);
        return next;
      });

      if (isAbortError(err)) {
        setMessages((prev) => prev.map((m) => m.id === asstId
          ? { ...m, status: "cancelled" }
          : m));
        return;
      }

      setMessages((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, conversationId: convId ?? "", role: "assistant", content: "Failed to get response", status: "failed", createdAt: new Date().toISOString() },
      ]);
    });
  }, [input, pendingFiles, selectedContext, slug, userId, convId, waiting, latestAssistantMsgId, refreshConversations, refreshRuns, isAbortError]);

  const selectedContextKeys = useMemo(
    () => new Set(selectedContext.map((item) => `${item.type}:${item.id}`)),
    [selectedContext],
  );

  const credByProvider = useMemo(() => new Map(providerCreds.map((c) => [c.provider, c] as const)), [providerCreds]);
  const currentProvider = providerConfig?.provider ?? "spaces";
  const currentCred = credByProvider.get(currentProvider);
  const currentModel = currentCred?.model ?? "";
  const showModelPicker = currentProvider !== "spaces" && Boolean(currentCred?.hasApiKey);

  // Fetch the live model list whenever the active provider has configured credentials.
  useEffect(() => {
    if (!showModelPicker) { setProviderModels([]); return; }
    setModelsLoading(true);
    const fetcher =
      currentProvider === "claude" ? listClaudeModelsForUser :
      currentProvider === "codex" ? listCodexModelsForUser :
      currentProvider === "copilot" ? listCopilotModelsForUser :
      null;
    if (!fetcher) { setProviderModels([]); setModelsLoading(false); return; }
    fetcher(userId)
      .then((rows) => setProviderModels(rows.map((r) => ({ id: (r as { id: string }).id, name: ((r as { name?: string; displayName?: string }).displayName ?? (r as { name?: string }).name ?? (r as { id: string }).id) }))))
      .catch(() => setProviderModels([]))
      .finally(() => setModelsLoading(false));
  }, [currentProvider, userId, showModelPicker]);

  const handleModelChange = useCallback(async (nextModel: string) => {
    if (!nextModel || nextModel === currentModel) return;
    setSavingModel(true);
    try {
      await upsertProviderCredential(userId, currentProvider, { model: nextModel });
      // Refresh local creds so the dropdown reflects the new model.
      const fresh = await listProviderCredentials(userId);
      setProviderCreds(fresh);
    } catch (err) {
      console.error("[agent-chat] model save error:", err);
    } finally {
      setSavingModel(false);
    }
  }, [userId, currentProvider, currentModel]);

  if (agentsLoading) {
    return (
      <div className="flex h-[calc(100vh-120px)] items-center justify-center text-sm text-zinc-500">
        <Loader2 size={14} className="mr-2 animate-spin" /> Loading agents…
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="flex h-[calc(100vh-120px)] items-center justify-center text-sm text-zinc-500">
        No agents available. Create one from the Dashboard first.
      </div>
    );
  }

  return (
    <>
    <div className="flex h-[calc(100vh-120px)] flex-col">
      {/* Header: back, agent picker, provider picker */}
      <div className="flex items-center gap-3 border-b border-zinc-800 pb-4">
        <button onClick={() => navigate("/v1")} className="text-zinc-400 hover:text-zinc-200">
          <ChevronLeft size={20} />
        </button>
        <h2 className="text-lg font-semibold">Chat</h2>

        <div className="ml-2 flex items-center gap-2">
          <label className="text-xs text-zinc-500">Agent</label>
          <select
            value={slug}
            onChange={(e) => handleAgentChange(e.target.value)}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200 focus:border-purple-500 focus:outline-none"
          >
            {agents.map((a) => (
              <option key={a.slug} value={a.slug}>{a.name}</option>
            ))}
          </select>
        </div>

        <div className="relative flex items-center gap-2">
          <label className="text-xs text-zinc-500">Provider</label>
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowProviderMenu((s) => !s)}
              disabled={savingProvider}
              className="flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200 focus:border-purple-500 focus:outline-none disabled:opacity-50"
            >
              <span>{(PROVIDERS.find((p) => p.id === currentProvider)?.label) ?? currentProvider}</span>
              <svg width="12" height="12" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="ml-1">
                <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {showProviderMenu && (
              <div ref={providerMenuRef} className="absolute left-0 z-50 mt-1 w-56 rounded-md border border-zinc-700 bg-zinc-900 shadow-lg">
                <ul className="max-h-56 overflow-auto">
                  {PROVIDERS.map((p) => {
                    const available = !p.needsCreds || Boolean(credByProvider.get(p.id)?.hasApiKey);
                    return (
                      <li key={p.id} className="">
                        <button
                          type="button"
                          onClick={() => { if (available) { void handleProviderChange(p.id); setShowProviderMenu(false); } }}
                          disabled={!available || savingProvider}
                          className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-800 ${available ? "text-zinc-200" : "text-zinc-500 opacity-50 italic cursor-default"}`}
                        >
                          <span>{p.label}</span>
                          {!available && <span className="text-xs text-zinc-500">not configured</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
          {savingProvider && <Loader2 size={12} className="animate-spin text-zinc-400" />}
        </div>

        {showModelPicker && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-zinc-500">Model</label>
            <select
              value={currentModel}
              onChange={(e) => handleModelChange(e.target.value)}
              disabled={savingModel || modelsLoading}
              className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200 focus:border-purple-500 focus:outline-none disabled:opacity-50"
            >
              {currentModel && !providerModels.some((m) => m.id === currentModel) && (
                <option value={currentModel}>{currentModel}</option>
              )}
              {providerModels.length === 0 && !currentModel && (
                <option value="" disabled>{modelsLoading ? "Loading…" : "No models"}</option>
              )}
              {providerModels.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            {(savingModel || modelsLoading) && <Loader2 size={12} className="animate-spin text-zinc-400" />}
          </div>
        )}

        <button
          type="button"
          onClick={() => { setDebugTurnIndex(null); setDebugSessionId(null); setShowDebugger(true); }}
          disabled={!convId && !waiting}
          className="ml-auto rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm font-medium text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
          title="Open debugger"
        >
          Debug
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 shrink-0 border-r border-zinc-800 overflow-y-auto">
          <div className="p-3">
            <button onClick={startNewChat}
              className="flex w-full items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-300 transition hover:border-zinc-600 hover:text-zinc-100">
              <Plus size={14} /> New Chat
            </button>
          </div>

          {loadingHistory ? (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-zinc-500">
              <Loader2 size={12} className="animate-spin" /> Loading...
            </div>
          ) : conversations.length === 0 ? (
            <p className="px-3 py-2 text-xs text-zinc-600">No conversations yet.</p>
          ) : (
            <div className="space-y-0.5 px-2">
              {conversations.map((c) => (
                <button key={c.conversationId} onClick={() => loadConversation(c.conversationId)}
                  className={`flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left transition ${
                    convId === c.conversationId ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-300"
                  }`}>
                  <MessageSquare size={14} className="mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{c.title || "Untitled"}</p>
                    <p className="text-xs text-zinc-600">{c.messageCount} msgs · {new Date(c.lastMessageAt).toLocaleDateString()}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Chat area */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {messages.length === 0 && !waiting && (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-zinc-600">Send a message to start chatting.</p>
              </div>
            )}

            <div className="space-y-3">
              {/* Branching: render the projected visible path (selected branch
                  through the tree), not the raw message list. The unprojected
                  list lives in `messages` for parent/sibling lookups. */}
              {activePath.map((m, messageIndex) => {
                const isStreaming = m.id === streamingMsgId;
                const assistantTurnIndex = m.role === "assistant"
                  ? activePath.slice(0, messageIndex + 1).filter((message) => message.role === "assistant").length - 1
                  : -1;
                // Invocation source: live while streaming, persisted after.
                const run = runByAssistantMsgId.get(m.id);
                const msgInvocations = isStreaming ? liveInvocations : (run?.toolInvocations ?? []);
                // Reasoning: live state while streaming, otherwise the sidecar map.
                // The map outlives streaming so the collapsed "Thought" block persists.
                const msgReasoning = isStreaming ? liveReasoning : reasoningByMsgId.get(m.id);
                const imageUrls = m.attachments
                  ?.filter((a) => a.mimeType.startsWith("image/"))
                  .map((a) => localPreviews.get(a.id) ?? chatAttachmentDownloadUrl(a.id));
                const fileAttachments = m.attachments
                  ?.filter((a) => !a.mimeType.startsWith("image/"))
                  .map((a) => ({
                    id: a.id,
                    name: a.originalFilename,
                    mimeType: a.mimeType,
                    ...(typeof a.size === "number" ? { size: a.size } : {}),
                    url: chatAttachmentDownloadUrl(a.id),
                  })) ?? [];
                // Merge in any mid-session streamed attachments (not yet
                // persisted). Filtered to ones whose filename isn't already
                // in m.attachments — the final `done` event rewrites the
                // message with the canonical GCS-backed versions.
                const persistedNames = new Set(fileAttachments.map((a) => a.name));
                const streamingEntries = (streamingAttachmentsByMsgId.get(m.id) ?? [])
                  .filter((e) => !persistedNames.has(e.originalFilename))
                  .map((e) => ({
                    id: e.id,
                    name: e.originalFilename,
                    mimeType: e.mimeType,
                    size: e.size,
                    url: e.blobUrl,
                  }));
                const allFileAttachments = [...fileAttachments, ...streamingEntries];

                const msgPending = pendingActionsByMsgId.get(m.id);
                // Branch / regenerate / edit affordances are gated by:
                //   - not currently streaming (no in-flight runs)
                //   - position on the active path (only the latest visible user
                //     gets edit; only the latest assistant gets regenerate)
                //   - sibling presence in the underlying tree (drives the pager)
                const showRegenerate = !waiting && !streamingMsgId && m.role === "assistant" && m.id === latestAssistantMsgId && m.status === "completed";
                const showEditUser = !waiting && !streamingMsgId && m.role === "user" && m.id === latestUserMsgId;
                const isEditingUser = editingUserId === m.id;
                const parentId = effectiveParentById.get(m.id) ?? "root";
                const siblings = childrenByParent.get(parentId) ?? [];
                const currentIndex = siblings.findIndex((s) => s.id === m.id);
                const showVersionNav = (m.role === "assistant" || m.role === "user") && siblings.length > 1 && currentIndex >= 0;
                return (
                  <div key={m.id}>
                    <MessageBubble
                      message={{
                        id: m.id,
                        role: m.role as "user" | "assistant",
                        content: m.content,
                        status: m.status as "completed" | "failed" | "running" | "cancelled" | undefined,
                        ...(m.contextItems?.length ? { contextItems: m.contextItems } : {}),
                        ...(imageUrls?.length ? { images: imageUrls } : {}),
                        ...(allFileAttachments.length ? { files: allFileAttachments } : {}),
                        ...(msgReasoning ? { reasoning: msgReasoning } : {}),
                        ...(msgInvocations.length > 0 ? { invocations: msgInvocations } : {}),
                        ...(isStreaming ? { streaming: true } : {}),
                        ...(m.role === "assistant" ? {
                          footer: (
                            <span className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  // Branching-safe: pin to this assistant's run by
                                  // sessionId rather than chronological index.
                                  setDebugTurnIndex(assistantTurnIndex);
                                  setDebugSessionId(runByAssistantMsgId.get(m.id)?.sessionId ?? null);
                                  setShowDebugger(true);
                                }}
                                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
                              >
                                <Bug size={11} /> Debug this response
                              </button>
                              {/* Per-message 👍/👎 — only once the run is linked
                                  (chatMessageId set on finalize). */}
                              {(() => {
                                const run = runByAssistantMsgId.get(m.id);
                                return run ? (
                                  <MessageRatingButtons
                                    userId={userId}
                                    sessionId={run.sessionId}
                                    rating={run.rating}
                                    ratingComment={run.ratingComment}
                                    onRated={() => { if (convId) refreshRuns(convId); }}
                                  />
                                ) : null;
                              })()}
                            </span>
                          ),
                        } : {}),
                        ...(msgPending?.length ? {
                          pendingActions: msgPending,
                          onApproveAction: (pa) => handleApproveAction(m.id, pa),
                          onDeclineAction: (pa) => handleDeclineAction(m.id, pa),
                        } : {}),
                      }}
                      userId={userId}
                    />
                    {showEditUser && (
                      <div className="mt-1 flex justify-end">
                        {isEditingUser ? (
                          <div className="flex w-full max-w-xl flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900 p-2">
                            <textarea
                              value={editingUserText}
                              onChange={(e) => setEditingUserText(e.target.value)}
                              className="min-h-[76px] resize-y rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 outline-none"
                              autoFocus
                            />
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                                onClick={() => {
                                  setEditingUserId(null);
                                  setEditingUserText("");
                                }}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                className="rounded bg-purple-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                                disabled={!editingUserText.trim() || editingUserText.trim() === m.content.trim()}
                                onClick={() => {
                                  handleEditLatestUser(m.id, editingUserText);
                                  setEditingUserId(null);
                                  setEditingUserText("");
                                }}
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingUserId(m.id);
                              setEditingUserText(m.content);
                            }}
                            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
                            title="Edit message"
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    )}
                    {showRegenerate && (
                      <div className="mt-1 flex">
                        <button
                          onClick={handleRegenerate}
                          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
                          title="Regenerate response"
                        >
                          <RefreshCw size={12} />
                          Regenerate
                        </button>
                      </div>
                    )}
                    {showVersionNav && (
                      <div className="mt-1 flex items-center gap-2">
                        <button
                          onClick={() => setBranchSelections(prev => new Map(prev).set(parentId, siblings[currentIndex - 1]!.id))}
                          disabled={currentIndex === 0}
                          className="rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-30"
                          title="Previous branch"
                        >
                          &lt;
                        </button>
                        <span className="min-w-[42px] text-center text-xs text-zinc-500">{currentIndex + 1}/{siblings.length}</span>
                        <button
                          onClick={() => setBranchSelections(prev => new Map(prev).set(parentId, siblings[currentIndex + 1]!.id))}
                          disabled={currentIndex === siblings.length - 1}
                          className="rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-30"
                          title="Next branch"
                        >
                          &gt;
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              <div ref={bottomRef} />
            </div>
          </div>

          {/* Input */}
          <div className="border-t border-zinc-800 px-4 py-4">
            {contextToast && (
              <div className="mb-2 rounded-lg border border-amber-700/70 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                {contextToast}
              </div>
            )}

            {selectedContext.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {selectedContext.map((item) => (
                  <div key={`${item.type}:${item.id}`} className={`flex max-w-full items-center gap-2 rounded-full border px-2.5 py-1 text-xs ${contextBadgeClass(item.type)}`}>
                    {contextIcon(item.type)}
                    <span className="truncate">{item.title}</span>
                    <button
                      onClick={() => removeSelectedContext(item)}
                      className="rounded-full p-0.5 text-zinc-300 transition hover:bg-zinc-700 hover:text-white"
                      title="Remove context"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Image previews */}
            {pendingFiles.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {pendingFiles.map((p, idx) => (
                  <div key={idx} className="group relative">
                    <img src={p.previewUrl} alt={p.file.name} className="h-16 w-16 rounded-lg border border-zinc-700 object-cover" />
                    <button
                      onClick={() => removeImage(idx)}
                      className="absolute -right-1.5 -top-1.5 hidden rounded-full bg-zinc-700 p-0.5 text-zinc-300 hover:bg-red-600 hover:text-white group-hover:block"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="relative">
              {showContextPicker && (
                <div className="absolute bottom-full left-0 z-30 mb-2">
                  <ContextPicker
                    slug={slug}
                    userId={userId}
                    open={showContextPicker}
                    tab={contextTab}
                    query={contextQuery}
                    selectedKeys={selectedContextKeys}
                    onTabChange={setContextTab}
                    onQueryChange={setContextQuery}
                    onSelect={addSelectedContext}
                    onClose={() => setShowContextPicker(false)}
                  />
                </div>
              )}

              <div className="flex items-end gap-2">
                <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleImageSelect} className="hidden" />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={waiting}
                  className="flex items-center rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200 disabled:opacity-50"
                  title="Attach images"
                >
                  <ImagePlus size={16} />
                </button>
                <button
                  onClick={() => setShowContextPicker((prev) => !prev)}
                  disabled={waiting}
                  className={`relative flex items-center rounded-lg border px-3 py-2.5 text-zinc-400 transition disabled:opacity-50 ${
                    showContextPicker
                      ? "border-cyan-600 bg-cyan-500/10 text-cyan-300"
                      : "border-zinc-700 bg-zinc-800 hover:border-zinc-600 hover:text-zinc-200"
                  }`}
                  title="Attach context"
                >
                  <AtSign size={16} />
                  {selectedContext.length > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 rounded-full bg-cyan-500 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-950">
                      {selectedContext.length}
                    </span>
                  )}
                </button>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter alone → send. Shift/Meta/Ctrl+Enter → newline
                    // (default browser textarea behavior).
                    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Type a message... (Shift+Enter for new line)"
                  disabled={waiting}
                  rows={1}
                  className="max-h-[200px] flex-1 resize-none overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm leading-relaxed text-zinc-200 placeholder-zinc-600 focus:border-purple-500 focus:outline-none disabled:opacity-50"
                  autoFocus
                />
                {waiting ? (
                  <button
                    onClick={handleStop}
                    className="flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-500"
                  >
                    <Square size={14} />
                    Stop
                  </button>
                ) : (
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() && pendingFiles.length === 0 && selectedContext.length === 0}
                    className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-purple-500 disabled:opacity-50"
                  >
                    <Send size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {showDebugger && (
          <>
            <div
              data-id="legacy-chat-debugger-resizer"
              className="group relative flex w-1 shrink-0 cursor-col-resize items-center justify-center"
              onMouseDown={handleDebuggerResizeStart}
            >
              <div className="h-full w-px bg-zinc-800 group-hover:w-0.5 group-hover:bg-zinc-700 transition-all" />
            </div>
            <DebugDrawer
              open={showDebugger}
              inline
              width={debuggerWidth}
              agentSlug={slug}
              conversationId={convId}
              liveEvents={liveDebugEvents}
              running={waiting}
              artifactsReadyVersion={debugArtifactsReadyVersion}
              selectedTurnIndex={debugTurnIndex}
              selectedTurnLive={debugTurnIndex != null && isCurrentAssistantTurn(activePath, debugTurnIndex, streamingMsgId)}
              selectedSessionId={debugSessionId}
              onClose={() => setShowDebugger(false)}
            />
          </>
        )}
      </div>
    </div>
    </>
  );
}

function contextBadgeClass(type: ContextItem["type"]): string {
  if (type === "channel") return "border-cyan-700/70 bg-cyan-500/10 text-cyan-300";
  if (type === "ticket") return "border-amber-700/70 bg-amber-500/10 text-amber-300";
  if (type === "canvas") return "border-emerald-700/70 bg-emerald-500/10 text-emerald-300";
  if (type === "repository") return "border-blue-700/70 bg-blue-500/10 text-blue-300";
  return "border-fuchsia-700/70 bg-fuchsia-500/10 text-fuchsia-300";
}

function contextIcon(type: ContextItem["type"]): ReactElement {
  if (type === "channel") return <Hash size={12} className="shrink-0" />;
  if (type === "ticket") return <Ticket size={12} className="shrink-0" />;
  if (type === "canvas") return <FileText size={12} className="shrink-0" />;
  if (type === "repository") return <GitBranch size={12} className="shrink-0" />;
  return <Phone size={12} className="shrink-0" />;
}
