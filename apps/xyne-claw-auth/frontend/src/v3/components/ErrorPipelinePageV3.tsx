/**
 * ErrorPipelinePageV3 — standalone page for the Grafana → Claw error pipeline
 * (moved out of the Admin Panel tab; same admin-only gating via routing).
 *
 * Grafana dedupes errors → claw routes each into a lane by the DB bucket rules
 * (keywords + regex; no match → default) → durable Redis streams → one
 * doctor-agent per stream works them. This page is the whole cockpit: summary
 * tiles, editable bucket rules (keyword chips + advanced regex), per-lane item
 * inspector, and (via /fixes) what the agents did.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { SpinnerGapIcon, PencilSimpleIcon, TrashIcon, CopySimpleIcon, CheckIcon, PaperclipIcon, LinkSimpleIcon, CaretRightIcon } from "@phosphor-icons/react";
import { useAdminStatus } from "../hooks/useAdminStatus";
import { useAuth } from "../../hooks/useAuth";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Dialog } from "./ui/Dialog";
import { SidePanel } from "./ui/SidePanel";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { useSnackbar } from "./ui/Snackbar";
import {
  getErrorPipelineBuckets,
  listErrorPipelineItems,
  listErrorPipelineRules,
  listErrorPipelineFixes,
  saveErrorPipelineRule,
  deleteErrorPipelineRule,
  type ErrorPipelineBucketStat,
  type ErrorPipelineItem,
  type ErrorPipelineRule,
  type ErrorPipelineFix,
  type ChatAttachmentMeta,
  type ChatMsg,
  type ToolInvocation,
  type ContextItem,
  type ContextSearchType,
  type AttachedContextRef,
  pollChatMessages,
  chatAttachmentDownloadUrl,
  sendChatMessage,
  subscribeLiveConversation,
  uploadChatAttachments,
  forkErrorPipelineConversation,
} from "../../lib/api";
// Reuse the main chat's composer verbatim — same look, same keyboard rules,
// same attach (+) / mention (@) affordances.
import { InputArea, InvocationBlocks, ReasoningBlock, type PendingFile } from "./ChatPageV3";
import { ContextPicker } from "../../components/ContextPicker";

type RuleDraft = { name: string; description: string; keywords: string[]; markers: string; matchOrder: number; enabled: boolean; isNew: boolean };
type ItemsTab = "pending" | "retrying" | "failed" | "done";

/** Saved detail-panel width. Suffixed `-v2`: the pre-existing key held the old
 *  560px value, which pinned everyone to the narrow panel and hid the wider
 *  default. Bumping it lets the new default apply once; later drags persist. */
const DETAIL_WIDTH_KEY = "errpipe-detail-width-v2";

const chip = (sig: string) =>
  sig === "rule" ? "bg-sky-500/15 text-sky-300"
  : sig === "default" ? "bg-amber-500/15 text-amber-300"
  : "bg-xyne-surface-subtle text-xyne-fg-tertiary";

function Tile({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-xl border border-xyne-border bg-xyne-surface p-4">
      <p className="text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">{label}</p>
      <p className={`mt-1.5 font-mono text-[32px] leading-none ${tone ?? "text-xyne-fg-primary"}`}>{value}</p>
    </div>
  );
}

function AgentStatusChip({ status }: { status?: ErrorPipelineFix["status"] }) {
  if (!status) return <span className="text-[11px] text-xyne-fg-muted">—</span>;
  const cls =
    status === "running" ? "bg-amber-500/15 text-amber-300"
    : status === "completed" ? "bg-emerald-500/15 text-emerald-300"
    : "bg-red-500/15 text-red-300";
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${cls}`}>
      {status === "running" && <SpinnerGapIcon size={11} className="animate-spin" />}
      {status}
    </span>
  );
}

function AgentResponse({ children }: { children: string }) {
  return (
    <div className={
      "prose prose-sm max-w-none min-w-0 break-words [overflow-wrap:anywhere] dark:prose-invert text-[12.5px] leading-relaxed " +
      "prose-strong:font-medium prose-headings:font-medium prose-pre:bg-xyne-surface-subtle prose-pre:text-[11.5px]"
    }>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Links in the RCA (Grafana, PRs, dashboards) open in a new tab so
          // the reader never loses the pipeline page.
          a: ({ href, children: linkChildren, ...rest }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
              {linkChildren}
            </a>
          ),
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}

/** Copy-to-clipboard button pinned to the top-right of a content block
 *  (wrap the block in a `relative` container). Flashes a check on success. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      title={`Copy ${label}`}
      className="absolute right-2 top-2 z-10 rounded-md p-1.5 text-xyne-fg-tertiary transition hover:bg-xyne-surface hover:text-xyne-fg-primary"
    >
      {copied ? <CheckIcon size={14} className="text-emerald-400" /> : <CopySimpleIcon size={14} />}
    </button>
  );
}

// NOTE: we deliberately do NOT inject the app's dark theme into attachment
// previews. RCA reports are self-contained light-theme documents — they set
// their own text colors on inner elements. Forcing the app's dark background
// onto `body` won that cascade (equal specificity, injected last) while the
// report's higher-specificity text rules kept the text dark → dark-on-dark,
// i.e. an invisible/blank preview. The iframe stays sandboxed for security;
// we just let the document render as authored, on a white page (below).

/**
 * One-click collapse for a turn's whole activity trail (reasoning + every tool
 * row). The individual rows collapse on their own, but a long turn still
 * stacked 10+ headers and pushed the actual answer off-screen in this narrow
 * panel — so the group is folded by default and opens when you're debugging.
 */
function ActivityGroup({ steps, children }: { steps: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-[11px] text-xyne-fg-tertiary transition hover:text-xyne-fg-secondary"
      >
        <CaretRightIcon size={11} className={`transition-transform ${open ? "rotate-90" : ""}`} />
        <span>{open ? "Hide" : "Show"} agent activity</span>
        <span className="text-xyne-fg-muted">· {steps} {steps === 1 ? "step" : "steps"}</span>
      </button>
      {open && <div className="mt-1.5 space-y-1.5">{children}</div>}
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center gap-2 py-8 text-[13px] text-xyne-fg-muted">
      <SpinnerGapIcon size={16} className="animate-spin" /> Loading…
    </div>
  );
}

/**
 * Inline attachment list with click-to-expand preview — used for BOTH the RCA
 * run's attachments and the files a follow-up turn attaches. Click expands the
 * file (accordion), ↗ opens it in a new tab. HTML/other render in a sandboxed
 * iframe on a white page (a report is a light-theme document); images inline.
 */
function AttachmentList({
  attachments,
  expandedId,
  onToggle,
  heading,
}: {
  attachments: ChatAttachmentMeta[];
  expandedId: string | null;
  onToggle: (id: string | null) => void;
  heading?: boolean;
}) {
  if (!attachments.length) return null;
  return (
    <div className="mt-3 space-y-2">
      {heading && <h5 className="text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">Attachments</h5>}
      {attachments.map((a) => {
        const expanded = expandedId === a.id;
        return (
          <div key={a.id} className="overflow-hidden rounded-lg border border-xyne-border-subtle bg-xyne-surface-subtle">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px]">
              <button
                onClick={() => onToggle(expanded ? null : a.id)}
                title={expanded ? "Collapse" : "Expand preview"}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xyne-fg-secondary transition hover:text-xyne-fg-primary"
              >
                <CaretRightIcon size={12} className={`shrink-0 text-xyne-fg-tertiary transition-transform ${expanded ? "rotate-90" : ""}`} />
                <PaperclipIcon size={13} className="shrink-0 text-xyne-fg-tertiary" />
                <span className="truncate">{a.originalFilename}</span>
                {typeof a.size === "number" && a.size > 0 && (
                  <span className="shrink-0 text-[10px] text-xyne-fg-muted">
                    {a.size >= 1024 * 1024 ? `${(a.size / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(a.size / 1024))} KB`}
                  </span>
                )}
              </button>
              <a
                href={chatAttachmentDownloadUrl(a.id)}
                target="_blank"
                rel="noopener noreferrer"
                title="Open in new tab"
                className="shrink-0 rounded-md p-1 text-xyne-fg-tertiary transition hover:bg-xyne-surface hover:text-xyne-fg-primary"
              >
                ↗
              </a>
            </div>
            {expanded && (
              <div className="border-t border-xyne-border-subtle p-2">
                {a.mimeType.startsWith("image/") ? (
                  <img src={chatAttachmentDownloadUrl(a.id)} alt={a.originalFilename} className="mx-auto max-h-[60vh] max-w-full rounded" />
                ) : (
                  <iframe
                    src={chatAttachmentDownloadUrl(a.id)}
                    title={a.originalFilename}
                    sandbox="allow-same-origin"
                    className="h-[60vh] w-full rounded bg-white"
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ErrorPipelinePageV3({ userId }: { userId: string }) {
  const { show: showSnackbar } = useSnackbar();
  // Everyone can VIEW the pipeline; bucket controls are admin-only (grayed out
  // for members — the backend rejects the writes anyway).
  const { isAdmin } = useAdminStatus();
  const [searchParams, setSearchParams] = useSearchParams();
  // Avatar initials from the signed-in user's name/email — same derivation the
  // chat page uses (NOT the user id, whose first char is a meaningless "c").
  const auth = useAuth();
  const userAbbr = auth.status === "authenticated"
    ? (auth.user.name || auth.user.email || "?")
        .split(" ").slice(0, 2).map((p: string) => p[0]?.toUpperCase() ?? "").join("")
    : "?";

  const [buckets, setBuckets] = useState<Record<string, ErrorPipelineBucketStat>>({});
  const [rules, setRules] = useState<ErrorPipelineRule[]>([]);
  const [fixes, setFixes] = useState<ErrorPipelineFix[]>([]);
  const [detail, setDetail] = useState<{ item?: ErrorPipelineItem; fix?: ErrorPipelineFix } | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [items, setItems] = useState<ErrorPipelineItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  // Tab + lane are mirrored into the URL (see selectTab / openBucket) so a
  // refresh — or a shared link — restores exactly what you were looking at
  // instead of snapping back to Pending.
  const [itemsTab, setItemsTab] = useState<ItemsTab>(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    return t === "retrying" || t === "failed" || t === "done" ? t : "pending";
  });
  const [itemsShown, setItemsShown] = useState(100);
  // Detail panel width — user-resizable by dragging the panel's left edge
  // (same pattern as the chat page panels), persisted across sessions.
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    try {
      const v = Number(window.localStorage.getItem(DETAIL_WIDTH_KEY));
      // Default: a 50/50 split — RCA reports and inline attachment previews
      // deserve as much room as the list. Floor keeps it usable on narrow
      // windows; drag still overrides and persists.
      const fallback = Math.max(560, Math.round(window.innerWidth * 0.52));
      return Number.isFinite(v) && v >= 420 && v <= 1400 ? v : fallback;
    } catch { return 720; }
  });
  const [isResizing, setIsResizing] = useState(false);
  // Keep the panel inside the viewport when the window shrinks (or on small
  // screens) — clamping the STATE keeps wrapper, inner container, and
  // SidePanel in agreement.
  useEffect(() => {
    const clamp = () => setPanelWidth((w) => Math.min(w, Math.max(360, Math.round(window.innerWidth * 0.8))));
    clamp();
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, []);
  const handlePanelResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panelWidth;
    let current = startWidth;
    setIsResizing(true);
    const onMove = (ev: MouseEvent) => {
      // Panel is on the right: dragging left grows it.
      current = Math.max(420, Math.min(Math.round(window.innerWidth * 0.7), startWidth + (startX - ev.clientX)));
      setPanelWidth(current);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setIsResizing(false);
      try { window.localStorage.setItem(DETAIL_WIDTH_KEY, String(current)); } catch { /* best-effort */ }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [panelWidth]);
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [kwInput, setKwInput] = useState("");
  const [advOpen, setAdvOpen] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    // Settle independently: the bucket rules (config) must render even if the
    // queue-stats proxy is down.
    const [bucketsRes, rulesRes, fixesRes] = await Promise.allSettled([
      getErrorPipelineBuckets(userId),
      listErrorPipelineRules(userId),
      listErrorPipelineFixes(userId),
    ]);
    if (bucketsRes.status === "fulfilled") setBuckets(bucketsRes.value);
    else { console.error("[error-pipeline] stats failed:", bucketsRes.reason); setBuckets({}); }
    if (rulesRes.status === "fulfilled") setRules(rulesRes.value);
    else console.error("[error-pipeline] rules failed:", rulesRes.reason);
    if (fixesRes.status === "fulfilled") setFixes(fixesRes.value);
    else console.error("[error-pipeline] fixes failed:", fixesRes.reason);
    setLoading(false);
  }, [userId]);
  useEffect(() => { void load(); }, [load]);

  // Live mode: ALWAYS poll silently — 8s while an agent run is in flight, 15s
  // when idle — so new ingests, status flips, and queue counts appear without
  // the Refresh button. Also keeps the open lane's items current.
  const anyRunning = fixes.some((f) => f.status === "running");
  useEffect(() => {
    const t = setInterval(() => {
      void load(true);
      if (selected) {
        listErrorPipelineItems(userId, selected, 500).then(setItems).catch(() => {});
      }
    }, anyRunning ? 8000 : 15000);
    return () => clearInterval(t);
  }, [anyRunning, load, selected, userId]);

  // Attachments the agent produced during the run (doctor-agent often writes
  // .html reports etc.). They live on the conversation's assistant messages,
  // so fetch the conversation whenever the open detail has one. Re-runs when
  // the run status flips (running → completed) so late attachments appear.
  const [detailAttachments, setDetailAttachments] = useState<ChatAttachmentMeta[]>([]);
  /** Attachment expanded INLINE in the panel (id), null = all collapsed. */
  const [expandedAttId, setExpandedAttId] = useState<string | null>(null);
  const detailConversationId = detail?.fix?.conversationId ?? null;
  const detailFixStatus = detail?.fix?.status ?? null;

  // ── Follow-up chat, inline in the panel ───────────────────────────
  // Continues the run's OWN conversation, so the agent keeps the RCA context
  // (headless turns are chained now — see chatMessageRepository.latestMessageId).
  const [followUps, setFollowUps] = useState<ChatMsg[]>([]);
  /**
   * The conversation the FOLLOW-UP thread lives in — a private per-user fork
   * (`<runConv>__u__<userId>`), never the run's own conversation. The pipeline
   * conversation is shared across everyone viewing the error, and claw keys
   * agent sessions by conversation, so chatting there would put several users
   * in ONE session (the model seeing everyone's turns). Resolved on open;
   * created on first send.
   */
  const [threadConversationId, setThreadConversationId] = useState<string | null>(null);
  // Which run conversation is open RIGHT NOW. A send captures this; its stream
  // callbacks no-op once it changes, so switching errors mid-turn can't paint
  // one error's thinking/tools into another's panel.
  const activeConvRef = useRef<string | null>(null);
  // Per-message tool calls + reasoning, so the panel can show HOW the agent
  // reached an answer (the chat page's debugging affordance).
  const [invocationsByMsgId, setInvocationsByMsgId] = useState<Map<string, ToolInvocation[]>>(new Map());
  const [reasoningByMsgId, setReasoningByMsgId] = useState<Map<string, string>>(new Map());
  /** Tool calls streamed during the in-flight turn (cleared when it settles). */
  const [liveInvocations, setLiveInvocations] = useState<ToolInvocation[]>([]);
  /** The run's OWN reasoning + tool calls (the "Open chat" trail the RCA was
   *  produced from) — pulled from the first assistant message of the run's
   *  conversation, shown collapsed under the RCA response. */
  const [runReasoning, setRunReasoning] = useState<string | null>(null);
  const [runInvocations, setRunInvocations] = useState<ToolInvocation[]>([]);
  /** Reasoning streamed during the in-flight turn — the agent "thinks" for a
   *  while before its first tool call, so without this the panel sat on a bare
   *  "Thinking…" pill while the chat was already showing the Thought block. */
  const [liveReasoning, setLiveReasoning] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatStream, setChatStream] = useState("");
  const [chatLabel, setChatLabel] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  /** A turn that's still running server-side which THIS tab is not driving —
   *  e.g. you sent a follow-up, switched errors, and came back. We resubscribe
   *  to the fork's /live stream and re-stream it here (partial answer-so-far
   *  from the snapshot, then live deltas), so the reply is never "lost" on a
   *  switch. Null when nothing is resuming. */
  const [resume, setResume] = useState<{ content: string; reasoning: string; invocations: ToolInvocation[]; active: boolean } | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const panelBodyRef = useRef<HTMLDivElement | null>(null);
  // Whether the thread is "pinned" to the bottom. Auto-scroll during streaming
  // ONLY happens while pinned — if the user scrolls up to read, we leave their
  // position alone instead of yanking them back to the latest tokens. Starts
  // pinned; a send re-pins (see sendFollowUp).
  const stickBottomRef = useRef(true);
  // Track the user's scroll to decide whether to keep following the stream.
  // Direction-aware on purpose: only an actual scroll UP into the middle unpins
  // — reaching the bottom always re-pins. This matters on a chat switch, where
  // moving into a shorter thread clamps scrollTop DOWNWARD and fires a `scroll`
  // event that would otherwise look like "user scrolled up" and wrongly stop the
  // working reply from auto-following.
  useEffect(() => {
    const box = panelBodyRef.current;
    if (!box || !detailConversationId) return;
    let lastTop = box.scrollTop;
    const onScroll = () => {
      const top = box.scrollTop;
      const nearBottom = box.scrollHeight - top - box.clientHeight < 80;
      if (nearBottom) stickBottomRef.current = true;
      else if (top < lastTop - 2) stickBottomRef.current = false; // scrolled up
      lastTop = top;
    };
    box.addEventListener("scroll", onScroll, { passive: true });
    return () => box.removeEventListener("scroll", onScroll);
  }, [detailConversationId]);
  useEffect(() => {
    // Instant (not smooth) so a burst of deltas can't leave a half-finished
    // animation mid-scroll — and so it never reads as "near bottom" transiently.
    if (stickBottomRef.current) chatEndRef.current?.scrollIntoView({ block: "nearest" });
    // chatSending included: the "working" row appears the instant you send, so
    // scroll it into view rather than leaving it below the fold.
  }, [followUps.length, chatStream, chatSending, chatLabel, liveInvocations.length, liveReasoning, resume]);

  // Composer extras, mirroring the chat page: image attachments queued for
  // upload, and @-mentioned context items.
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [selectedContext, setSelectedContext] = useState<ContextItem[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [contextQuery, setContextQuery] = useState("");
  const [contextTab, setContextTab] = useState<ContextSearchType>("all");
  const selectedContextKeys = useMemo(
    () => new Set(selectedContext.map((c) => `${c.type}:${c.id}`)),
    [selectedContext],
  );
  const addFiles = useCallback((files: File[]) => {
    const additions = files
      .filter((f) => f.type.startsWith("image/") && f.size <= 25 * 1024 * 1024)
      .map((file) => ({ file, previewUrl: URL.createObjectURL(file) }));
    if (additions.length) setPendingFiles((prev) => [...prev, ...additions]);
  }, []);
  const removeFile = useCallback((idx: number) => {
    setPendingFiles((prev) => {
      const removed = prev[idx];
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  const sendFollowUp = async () => {
    const text = chatInput.trim();
    if (!text || chatSending || !detailConversationId) return;
    // Bound the panel we started in — every state write below is gated on the
    // user still viewing this error, so switching mid-turn can't paint one
    // error's thinking/tools/stream into another's panel.
    const startedConv = detailConversationId;
    // The user just sent — re-pin to the bottom so their message and the reply
    // are in view (even if they'd scrolled up while reading the last answer).
    stickBottomRef.current = true;
    setChatInput("");
    setChatError(null);
    setChatSending(true);
    setChatStream("");
    setChatLabel("");
    setLiveInvocations([]);
    setLiveReasoning("");
    // Optimistic user bubble — replaced by the server rows on reload below.
    const optimistic: ChatMsg = {
      id: `local-${Date.now()}`,
      conversationId: detailConversationId,
      role: "user",
      content: text,
      status: "completed",
      createdAt: new Date().toISOString(),
    } as ChatMsg;
    setFollowUps((prev) => [...prev, optimistic]);
    try {
      // Upload queued images first — the send takes attachment IDs, not files.
      let attachmentIds: string[] | undefined;
      if (pendingFiles.length) {
        const metas = await uploadChatAttachments("doctor-agent", userId, pendingFiles.map((p) => p.file));
        attachmentIds = metas.map((m) => m.id);
        pendingFiles.forEach((p) => { if (p.previewUrl) URL.revokeObjectURL(p.previewUrl); });
        setPendingFiles([]);
      }
      const attachedContext: AttachedContextRef[] = selectedContext
        .filter((c) => c.type !== "repository")
        .map((c) => ({ type: c.type, id: c.id, title: c.title } as AttachedContextRef));
      setSelectedContext([]);
      // Ensure the private fork exists (clones the run's session on first call)
      // and talk to IT — never the shared pipeline conversation.
      const convId = await forkErrorPipelineConversation(userId, detailConversationId);
      setThreadConversationId(convId);
      await sendChatMessage(
        "doctor-agent", text, userId, convId,
        {
          onTextDelta: (d) => { if (activeConvRef.current === startedConv) setChatStream((s) => s + d); },
          onProgress: (label) => { if (activeConvRef.current === startedConv) setChatLabel(label); },
          // Live tool rows while the turn runs — replaced by the persisted
          // invocations once the thread reloads below. Upsert by toolCallId:
          // a call arrives first as "running", then again with its result.
          onInvocation: (inv) => {
            if (activeConvRef.current !== startedConv) return;
            setLiveInvocations((prev) => {
              if (!inv.toolCallId) return [...prev, inv];
              const idx = prev.findIndex((p) => p.toolCallId === inv.toolCallId);
              if (idx === -1) return [...prev, inv];
              const next = prev.slice();
              next[idx] = inv;
              return next;
            });
          },
          onReasoningDelta: (d) => { if (activeConvRef.current === startedConv) setLiveReasoning((r) => r + d); },
        },
        attachmentIds,
        attachedContext.length ? attachedContext : undefined,
      );
      // Re-read the persisted thread so ids/attachments/tools are authoritative
      // — but only if the user is still on this error.
      if (activeConvRef.current !== startedConv) return;
      const h = await pollChatMessages("doctor-agent", convId);
      setFollowUps(h.messages.filter((m) => m.status !== "running"));
      setInvocationsByMsgId(h.invocationsByMsgId);
      setReasoningByMsgId(h.reasoningByMsgId);
    } catch (err) {
      if (activeConvRef.current === startedConv) setChatError(err instanceof Error ? err.message : "Send failed");
    } finally {
      // Only clear if still on the error we sent from — otherwise we'd wipe the
      // freshly-opened panel's own state.
      if (activeConvRef.current === startedConv) {
        setChatSending(false);
        setChatStream("");
        setChatLabel("");
        setLiveInvocations([]);
        setLiveReasoning("");
      }
    }
  };
  // Synchronous reset on error switch. useLayoutEffect runs BEFORE paint, so the
  // new panel never flashes a frame of the error you just left (thread + live
  // stream). Keyed on the conversation ONLY — a fix status flip (running →
  // completed) must refresh data without wiping an in-flight turn.
  useLayoutEffect(() => {
    // Track which error's conversation is on screen. Every live streaming
    // callback in sendFollowUp is gated on `activeConvRef.current === startedConv`
    // so a mid-turn switch can't paint the old turn's thinking/tools/text into
    // the new panel. We deliberately do NOT abort the in-flight turn here: it
    // keeps running server-side (claw → /webhook/result persists the reply onto
    // the fork), so switching away never loses the response — the async loader
    // below re-shows it (and streams the partial via poll) when you return.
    activeConvRef.current = detailConversationId;
    setDetailAttachments([]);
    setFollowUps([]);
    setThreadConversationId(null);
    setRunReasoning(null);
    setRunInvocations([]);
    setChatSending(false);
    setChatStream("");
    setChatLabel("");
    setLiveInvocations([]);
    setLiveReasoning("");
    setResume(null);
    setChatError(null);
    setChatInput("");
    // A freshly opened error starts pinned to the bottom (show the latest).
    stickBottomRef.current = true;
  }, [detailConversationId]);

  // Async loads for the open error. Kept on [detailConversationId, detailFixStatus]
  // so a status flip refreshes the thread/attachments — the reset above is
  // deliberately NOT here, so that refresh can't wipe a live turn.
  useEffect(() => {
    if (!detailConversationId) return;
    let cancelled = false;
    // Deterministic id — mirrors the backend, so an existing fork's history
    // loads without a round-trip; the POST only happens on first send.
    const forkId = `${detailConversationId}__u__${userId}`;
    setThreadConversationId(forkId);
    // The fork holds ONLY follow-ups (the run's turns live in the source
    // conversation), so every message here is thread content. A turn still
    // running server-side isn't returned here (the /messages endpoint hides
    // running assistant rows) — the /live subscription effect below re-streams
    // it instead, so switching away and back never loses the reply.
    pollChatMessages("doctor-agent", forkId)
      .then((h) => {
        if (cancelled) return;
        setFollowUps(h.messages);
        setInvocationsByMsgId(h.invocationsByMsgId);
        setReasoningByMsgId(h.reasoningByMsgId);
      })
      .catch(() => { /* no fork yet — thread starts empty */ });
    pollChatMessages("doctor-agent", detailConversationId)
      .then((h) => {
        if (cancelled) return;
        const atts = h.messages
          .filter((m) => m.role === "assistant")
          .flatMap((m) => m.attachments ?? []);
        setDetailAttachments(atts);
        // Run's own thinking + tool calls: the first assistant message of the
        // run's conversation is the RCA turn. Surfacing its activity restores
        // what "Open chat" used to show — how the RCA was reached.
        const rcaMsg = h.messages.find((m) => m.role === "assistant");
        setRunReasoning(rcaMsg ? h.reasoningByMsgId.get(rcaMsg.id) ?? null : null);
        setRunInvocations(rcaMsg ? h.invocationsByMsgId.get(rcaMsg.id) ?? [] : []);
      })
      .catch((err) => {
        // Don't swallow: a failed load silently emptied the thread and the
        // attachments list, which looked like "my chat disappeared".
        if (cancelled) return;
        console.error("[error-pipeline] conversation load failed:", err);
        setChatError("Couldn't load this error's conversation — retry or reopen.");
      });
    return () => { cancelled = true; };
  }, [detailConversationId, detailFixStatus]);

  // Live resume: subscribe to the fork's /live SSE whenever an error is open and
  // THIS panel isn't the one driving the turn (chatSending). This is what makes
  // a reply survive a switch — the /messages endpoint hides running assistant
  // rows, but /live ships the persisted answer-so-far in its `snapshot`, then
  // streams deltas/tool-calls. Mirrors the main chat's viewer subscription.
  useEffect(() => {
    if (!threadConversationId || chatSending) return;
    const forkId = threadConversationId;
    const upsert = (list: ToolInvocation[], inv: ToolInvocation): ToolInvocation[] => {
      if (!inv.toolCallId) return [...list, inv];
      const idx = list.findIndex((p) => p.toolCallId === inv.toolCallId);
      if (idx === -1) return [...list, inv];
      const next = list.slice();
      next[idx] = inv;
      return next;
    };
    const close = subscribeLiveConversation("doctor-agent", forkId, userId, {
      onSnapshot: ({ inProgress, partial }) => {
        const content = partial?.content ?? "";
        const reasoning = partial?.reasoning ?? "";
        const invs = inProgress ?? [];
        // Nothing in flight → don't render a phantom empty reply block.
        if (!content && !reasoning && invs.length === 0) return;
        setResume({ content, reasoning, invocations: invs, active: true });
      },
      onInvocation: (inv) =>
        setResume((r) => ({ content: r?.content ?? "", reasoning: r?.reasoning ?? "", invocations: upsert(r?.invocations ?? [], inv), active: true })),
      onTextDelta: (d) =>
        setResume((r) => ({ content: (r?.content ?? "") + d, reasoning: r?.reasoning ?? "", invocations: r?.invocations ?? [], active: true })),
      onReasoningDelta: (d) =>
        setResume((r) => ({ content: r?.content ?? "", reasoning: (r?.reasoning ?? "") + d, invocations: r?.invocations ?? [], active: true })),
      onDone: () => {
        // Pull the finalized thread (the assistant save is fire-and-forget, so
        // retry until the reply lands), then drop the live-resume block.
        let attempts = 0;
        const tryLoad = () => {
          pollChatMessages("doctor-agent", forkId)
            .then((h) => {
              const last = h.messages[h.messages.length - 1];
              if (last?.role !== "assistant" && attempts < 4) { attempts++; window.setTimeout(tryLoad, 700); return; }
              setFollowUps(h.messages);
              setInvocationsByMsgId(h.invocationsByMsgId);
              setReasoningByMsgId(h.reasoningByMsgId);
              setResume(null);
            })
            .catch(() => setResume((r) => (r ? { ...r, active: false } : r)));
        };
        tryLoad();
      },
    });
    return close;
  }, [threadConversationId, chatSending, userId]);

  // Keep an open detail dialog in sync as fixes refresh (running → completed
  // flips live, response appears the moment the agent finishes).
  useEffect(() => {
    setDetail((d) => {
      if (!d) return d;
      const key = d.fix?.errorKey ?? d.item?.errorKey;
      if (!key) return d;
      const fresh = fixes.find((f) => f.errorKey === key);
      if (!fresh || fresh === d.fix) return d;
      return { ...(d.item ? { item: d.item } : {}), fix: fresh };
    });
  }, [fixes]);

  /** Switch tab and mirror it into the URL so a refresh keeps it. */
  const selectTab = (tab: ItemsTab) => {
    setItemsTab(tab);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", tab);
      return next;
    }, { replace: true });
  };

  // One-shot: once the restored lane's rows are on screen, bring the open
  // error into view (and make sure it's in the visible page of "Show more").
  useEffect(() => {
    if (!restoreScrollPending.current || itemsLoading) return;
    const el = selectedRowRef.current;
    // Give up once the rows are on screen — the target may sit in another tab
    // or past the "Show more" window; a stale flag must never hijack a later
    // scroll the user initiated.
    restoreScrollPending.current = false;
    el?.scrollIntoView({ block: "center" });
  }, [itemsLoading, items, itemsTab, itemsShown]);

  const openBucket = async (bucket: string) => {
    setSelected(bucket);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("lane", bucket);
      next.delete("error"); // switching lanes closes the detail
      return next;
    }, { replace: true });
    setItemsShown(100);
    setItemsLoading(true);
    try { setItems(await listErrorPipelineItems(userId, bucket, 500)); }
    catch { setItems([]); }
    finally { setItemsLoading(false); }
  };
  // Reset the "Show more" window whenever the tab changes, and scroll the list
  // back to the top — otherwise the previous tab's scroll offset carried over
  // and the first rows read as "stuck".
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    setItemsShown(100);
    listScrollRef.current?.scrollTo({ top: 0 });
  }, [itemsTab]);

  // ── Shareable error links ─────────────────────────────────────────
  // Opening a detail stamps ?lane=&error= into the URL so the address bar is
  // always a shareable deep link; closing clears it.
  const openDetail = (row: { errorKey: string; item?: ErrorPipelineItem; fix?: ErrorPipelineFix }) => {
    setDetail({ ...(row.item ? { item: row.item } : {}), ...(row.fix ? { fix: row.fix } : {}) });
    const lane = selected ?? row.item?.classification.bucket ?? row.fix?.bucket;
    setSearchParams({ ...(lane ? { lane } : {}), error: row.errorKey }, { replace: true });
  };
  const closeDetail = () => { setDetail(null); setSearchParams({}, { replace: true }); };
  const [linkCopied, setLinkCopied] = useState(false);
  // Deep link entry: open the lane + the error's panel. If the error is gone
  // (out of the queue and its 7-day record expired), say what happened and
  // leave the user on the pipeline page.
  const deepLinkHandled = useRef(false);
  // Restoring a deep link (or a refresh) reopens the panel, but the LIST stayed
  // scrolled at the top so the open error was nowhere to be seen. Scroll the
  // selected row into view once, after its rows render.
  const selectedRowRef = useRef<HTMLTableRowElement | null>(null);
  const restoreScrollPending = useRef(false);
  useEffect(() => {
    if (loading || deepLinkHandled.current) return;
    const lane = searchParams.get("lane");
    const ek = searchParams.get("error");
    if (!lane && !ek) { deepLinkHandled.current = true; return; }
    deepLinkHandled.current = true;
    restoreScrollPending.current = true;
    void (async () => {
      const bucket = lane ?? "default";
      setSelected(bucket);
      setItemsLoading(true);
      let its: ErrorPipelineItem[] = [];
      try { its = await listErrorPipelineItems(userId, bucket, 500); setItems(its); } catch { setItems([]); }
      setItemsLoading(false);
      if (!ek) return;
      const item = its.find((i) => i.errorKey === ek);
      const fix = fixes.find((f) => f.errorKey === ek);
      if (item || fix) {
        setDetail({ ...(item ? { item } : {}), ...(fix ? { fix } : {}) });
        // Land on the tab that actually contains this error, unless the URL
        // pinned one — otherwise the panel reopens while the list shows a tab
        // the row isn't in, and the highlight/scroll has nothing to target.
        if (!searchParams.get("tab")) {
          const st = fix?.status;
          const queued = Boolean(item);
          setItemsTab(st === "completed" ? "done" : st === "failed" ? (queued ? "retrying" : "failed") : "pending");
        }
      } else {
        showSnackbar({
          variant: "warning",
          title: "This error is no longer in the pipeline",
          description: "It existed when the link was shared, but it's out of the queue and its record (kept 7 days) has expired.",
          duration: 8000,
        });
        setSearchParams({}, { replace: true });
      }
    })();
  }, [loading, searchParams, fixes, userId, setSearchParams, showSnackbar]);
  const fixByKey = useMemo(() => {
    const m = new Map<string, ErrorPipelineFix>();
    for (const f of fixes) m.set(f.errorKey, f);
    return m;
  }, [fixes]);

  const openEditor = (rule?: ErrorPipelineRule) => {
    setSaveError(null);
    setKwInput("");
    setAdvOpen(Boolean(rule?.markers));
    setDraft(rule
      ? { name: rule.name, description: rule.description, keywords: rule.keywords ?? [], markers: rule.markers, matchOrder: rule.matchOrder, enabled: rule.enabled, isNew: false }
      : { name: "", description: "", keywords: [], markers: "", matchOrder: 20, enabled: true, isNew: true });
  };
  const addKeyword = () => {
    const v = kwInput.trim();
    if (!v || !draft) { setKwInput(""); return; }
    if (!draft.keywords.includes(v)) setDraft({ ...draft, keywords: [...draft.keywords, v] });
    setKwInput("");
  };
  const removeKeyword = (k: string) => {
    if (!draft) return;
    setDraft({ ...draft, keywords: draft.keywords.filter((x) => x !== k) });
  };
  const saveDraft = async () => {
    if (!draft) return;
    const name = draft.name.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) { setSaveError("Name: lowercase letters, digits and dashes only."); return; }
    const pending = kwInput.trim();
    const keywords = pending && !draft.keywords.includes(pending) ? [...draft.keywords, pending] : draft.keywords;
    if (draft.markers.trim()) {
      try { new RegExp(draft.markers); } catch (e) { setSaveError(`Invalid advanced regex: ${e instanceof Error ? e.message : "bad pattern"}`); return; }
    }
    if (keywords.length === 0 && !draft.markers.trim() && name !== "default") {
      setSaveError("Add at least one keyword (or an advanced regex) so the bucket can match something."); return;
    }
    setSaving(true); setSaveError(null);
    try {
      await saveErrorPipelineRule(userId, name, {
        description: draft.description, keywords, markers: draft.markers, matchOrder: draft.matchOrder, enabled: draft.enabled,
      });
      setKwInput("");
      showSnackbar({ variant: "success", title: `Bucket "${name}" saved` });
      setDraft(null);
      await load();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally { setSaving(false); }
  };
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteErrorPipelineRule(userId, deleteTarget);
      showSnackbar({ variant: "success", title: `Bucket "${deleteTarget}" deleted` });
      setDeleteTarget(null);
      await load();
    } catch (err) {
      showSnackbar({ variant: "error", title: err instanceof Error ? err.message : "Delete failed" });
      setDeleteTarget(null);
    }
  };

  const lanes = Object.entries(buckets).filter(([n]) => n !== "needs-human");
  const total = lanes.reduce((a, [, s]) => a + s.queued, 0);
  // All-lane run outcomes from the 7-day fix records.
  const completedAll = fixes.filter((f) => f.status === "completed").length;
  const failedAll = fixes.filter((f) => f.status === "failed").length;
  const dflt = buckets["default"]?.queued ?? 0;
  const dead = buckets["needs-human"]?.queued ?? 0;
  const active = lanes.filter(([, s]) => s.queued > 0).length;
  const maxQ = Math.max(1, ...rules.map((r) => buckets[r.name]?.queued ?? 0));
  const orderedRules = [...rules].sort((a, b) => a.matchOrder - b.matchOrder);
  const gapPct = total ? Math.round((dflt / total) * 100) : 0;
  const mix = items.reduce<Record<string, number>>((m, it) => {
    const k = it.classification.signal; m[k] = (m[k] ?? 0) + 1; return m;
  }, {});

  // Two data sources with different lifetimes:
  //   • the LIVE Redis queue (`items`) — everything currently in the stream.
  //   • the fix RECORDS (7-day TTL, one per errorKey) — what the agent did.
  // Every key lands in EXACTLY ONE tab (they're disjoint by construction):
  //   Pending  = in queue, no record or `running` (the ≤1 running one pinned on top)
  //   Retrying = in queue, record `failed` (prior attempt failed; queued again)
  //   Done     = record `completed` (in queue or not — the runner cooldown-skips
  //              a completed key, so "still queued" doesn't make it pending)
  //   Failed   = record `failed` AND no longer queued (gave up / dead-lettered,
  //              and the error hasn't re-fired)
  // laneFixes takes records tagged with this lane OR records for a key queued in
  // this lane — the latter catches a shape that was worked in another lane and
  // re-routed here after a rule change (otherwise its item vanishes from every
  // tab: excluded from Pending by its record, excluded from Done by the bucket
  // tag).
  type Row = { errorKey: string; message: string; timeMs: number; signal?: string; fix?: ErrorPipelineFix; item?: ErrorPipelineItem };
  const itemByKey = new Map(items.map((it) => [it.errorKey, it] as const));
  const laneFixes = fixes.filter((f) => f.bucket === selected || itemByKey.has(f.errorKey));
  const toItemRow = (it: ErrorPipelineItem): Row => { const fix = fixByKey.get(it.errorKey); return { errorKey: it.errorKey, message: it.error.message, timeMs: it.enqueuedAt, signal: it.classification.signal, item: it, ...(fix ? { fix } : {}) }; };
  const pendingRows: Row[] = items
    .filter((it) => { const st = fixByKey.get(it.errorKey)?.status; return st !== "failed" && st !== "completed"; })
    .sort((a, b) => {
      // Running pinned first, then newest.
      const ra = fixByKey.get(a.errorKey)?.status === "running" ? 0 : 1;
      const rb = fixByKey.get(b.errorKey)?.status === "running" ? 0 : 1;
      return ra !== rb ? ra - rb : b.enqueuedAt - a.enqueuedAt;
    })
    .map(toItemRow);
  const retryingRows: Row[] = items
    .filter((it) => fixByKey.get(it.errorKey)?.status === "failed")
    .sort((a, b) => b.enqueuedAt - a.enqueuedAt)
    .map(toItemRow);
  const fixToRow = (f: ErrorPipelineFix): Row => { const item = itemByKey.get(f.errorKey); return { errorKey: f.errorKey, message: f.message, timeMs: f.updatedAt, fix: f, ...(item ? { item } : {}) }; };
  const failedRows = laneFixes.filter((f) => f.status === "failed" && !itemByKey.has(f.errorKey)).sort((a, b) => b.updatedAt - a.updatedAt).map(fixToRow);
  const doneRows = laneFixes.filter((f) => f.status === "completed").sort((a, b) => b.updatedAt - a.updatedAt).map(fixToRow);
  const counts = { pending: pendingRows.length, retrying: retryingRows.length, done: doneRows.length, failed: failedRows.length };
  const tabRows: Row[] =
    itemsTab === "retrying" ? retryingRows :
    itemsTab === "failed" ? failedRows :
    itemsTab === "done" ? doneRows :
    pendingRows;
  const hasAnything = items.length > 0 || laneFixes.length > 0;
  // Client-side "Show more" so a deep lane doesn't dump everything at once.
  const visibleRows = tabRows.slice(0, itemsShown);
  const detailKey = detail?.item?.errorKey ?? detail?.fix?.errorKey ?? null;

  return (
    // flex-1 + min-h-0 (not h-full): the route container is a flex column, so
    // this is what actually bounds the page height — required for both the
    // list column and the detail panel to scroll instead of overflowing.
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <header className="border-b border-xyne-border px-6 py-5">
        <h1 className="text-[18px] font-semibold text-xyne-fg-primary">Error Pipeline</h1>
        <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-xyne-fg-muted">
          Grafana dedupes errors → routed into a lane by the bucket rules (keywords + regex; no match → <span className="text-xyne-fg-secondary">default</span>)
          → one fix-agent per stream works them. <span className="text-xyne-fg-secondary">needs-human</span> = dead-letter (3 failed attempts).
        </p>
      </header>

      {/* @container: the tiles/buttons respond to THIS column's width (it
          shrinks when the detail panel opens), not the viewport. */}
      <div className="@container space-y-6 px-6 py-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="grid flex-1 grid-cols-2 gap-3 @6xl:grid-cols-4">
            <Tile label="In queue (all lanes)" value={total} />
            <Tile label="Routing gaps (default)" value={
              <>{dflt} <span className="text-[15px] text-xyne-fg-muted">· {gapPct}%</span></>
            } tone={gapPct > 15 ? "text-amber-400" : undefined} />
            {/* Completed across ALL lanes (7-day fix records). Failures appear
                as a small chip ONLY when non-zero — a "0 failed" suffix is
                noise. Dead-letter still surfaces as the needs-human row in the
                bucket table when it's non-empty. */}
            <Tile label="Completed (7d)" value={
              <span className="flex items-baseline gap-2">
                <span className={completedAll > 0 ? "text-emerald-400" : undefined}>{completedAll}</span>
                {failedAll > 0 && (
                  <span className="rounded-md bg-red-500/10 px-1.5 py-0.5 font-sans text-[11px] font-medium text-red-400">{failedAll} failed</span>
                )}
              </span>
            } />
            <Tile label="Active lanes" value={`${active} / ${lanes.length}`} />
          </div>
          <div className="ml-auto flex shrink-0 gap-2">
            <button onClick={() => openEditor()} disabled={!isAdmin}
              title={isAdmin ? undefined : "Admin only"}
              className="rounded-lg bg-xyne-brand px-3 py-1.5 text-[12px] font-medium text-xyne-fg-inverse hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:opacity-40">+ Add bucket</button>
            <button onClick={() => void load()} disabled={loading}
              className="rounded-lg border border-xyne-border px-3 py-1.5 text-[12px] text-xyne-fg-secondary hover:bg-xyne-surface-subtle disabled:opacity-50">
              {loading ? "…" : "Refresh"}
            </button>
          </div>
        </div>

        {loading && rules.length === 0 ? (
          <Loading />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-xyne-border">
            {/* table-fixed + no hard min-width: content can't force h-scroll;
                the Volume bar column drops out when the column narrows. */}
            <table className="w-full table-fixed text-[13px]">
              <thead>
                <tr className="border-b border-xyne-border bg-xyne-surface-subtle text-left text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">
                  <th className="px-3 py-2 font-medium">Bucket</th>
                  <th className="hidden w-56 px-3 py-2 font-medium @2xl:table-cell">Volume</th>
                  <th className="w-20 px-3 py-2 text-right font-medium">In queue</th>
                  <th className="w-28 px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {orderedRules.map((r) => {
                  const isDefault = r.name === "default";
                  const q = buckets[r.name]?.queued ?? 0;
                  return (
                    <tr key={r.name} onClick={() => void openBucket(r.name)}
                      className={`cursor-pointer border-b border-xyne-border-subtle transition hover:bg-xyne-surface-subtle/50 ${selected === r.name ? "bg-xyne-surface-subtle/70" : ""} ${!r.enabled ? "opacity-50" : ""}`}>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2 font-medium">
                          <span className={isDefault ? "text-amber-400" : "text-xyne-fg-primary"}>{r.name}</span>
                          {!r.enabled && <span className="rounded bg-xyne-surface-subtle px-1 text-[10px] uppercase text-xyne-fg-tertiary">off</span>}
                        </div>
                        {r.description && <div className="line-clamp-1 text-[11px] text-xyne-fg-muted">{r.description}</div>}
                      </td>
                      <td className="hidden px-3 py-2 @2xl:table-cell">
                        <div className="h-1.5 w-full max-w-[200px] overflow-hidden rounded-full bg-xyne-surface-subtle">
                          <div className={`h-full rounded-full ${isDefault ? "bg-amber-500/70" : "bg-sky-500/60"}`}
                            style={{ width: `${Math.round((q / maxQ) * 100)}%` }} />
                        </div>
                      </td>
                      <td className={`px-3 py-2 text-right font-mono ${q > 0 ? (isDefault ? "text-amber-400" : "text-xyne-fg-primary") : "text-xyne-fg-muted"}`}>{q}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); openEditor(r); }}
                            disabled={!isAdmin}
                            title={isAdmin ? "Edit bucket" : "Admin only"}
                            className="rounded-md p-1.5 text-xyne-fg-tertiary transition hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-xyne-fg-tertiary">
                            <PencilSimpleIcon size={15} />
                          </button>
                          {!isDefault && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setDeleteTarget(r.name); }}
                              disabled={!isAdmin}
                              title={isAdmin ? "Delete bucket" : "Admin only"}
                              className="rounded-md p-1.5 text-xyne-fg-tertiary transition hover:bg-red-500/10 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-xyne-fg-tertiary">
                              <TrashIcon size={15} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {dead > 0 && (
                  <tr onClick={() => void openBucket("needs-human")}
                    className={`cursor-pointer border-t border-red-900/40 bg-red-950/20 transition hover:bg-red-950/30 ${selected === "needs-human" ? "bg-red-950/40" : ""}`}>
                    <td className="px-3 py-2">
                      <span className="font-medium text-red-400">needs-human</span>
                      <div className="text-[11px] text-red-400/70">dead-letter (not editable)</div>
                    </td>
                    <td className="hidden px-3 py-2 @2xl:table-cell" />
                    <td className="px-3 py-2 text-right font-mono text-red-400">{dead}</td>
                    <td className="px-3 py-2" />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {selected && (
          <section className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">
                Items in {selected}{!itemsLoading && ` (${items.length})`}
              </h3>
              {!itemsLoading && items.length > 0 && (
                <div className="flex gap-1.5 text-[11px]">
                  {Object.entries(mix).sort((a, b) => b[1] - a[1]).map(([sig, n]) => (
                    <span key={sig} className={`rounded px-1.5 py-0.5 ${chip(sig)}`}>{sig} {n}</span>
                  ))}
                </div>
              )}
              {!itemsLoading && hasAnything && (
                <div className="flex gap-1 rounded-lg border border-xyne-border p-0.5 text-[11px]">
                  {([
                    ["pending", `Pending ${counts.pending}`],
                    ["retrying", `Retrying ${counts.retrying}`],
                    ["done", `Done (7d) ${counts.done}`],
                    ["failed", `Failed (7d) ${counts.failed}`],
                  ] as const).map(([key, label]) => (
                    <button key={key} onClick={() => selectTab(key)}
                      className={`rounded-md px-2 py-0.5 transition ${itemsTab === key ? "bg-xyne-surface-subtle text-xyne-fg-primary" : "text-xyne-fg-muted hover:text-xyne-fg-secondary"}`}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
              <button onClick={() => setSelected(null)} title="Close"
                className="ml-auto rounded-md p-1.5 text-xyne-fg-tertiary transition hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary">
                ✕
              </button>
            </div>
            {itemsLoading ? (
              <Loading />
            ) : !hasAnything ? (
              <div className="rounded-xl border border-xyne-border bg-xyne-surface p-6 text-center text-[13px] text-xyne-fg-muted">Empty.</div>
            ) : tabRows.length === 0 ? (
              <div className="rounded-xl border border-xyne-border bg-xyne-surface p-6 text-center text-[13px] text-xyne-fg-muted">Nothing in {itemsTab}.</div>
            ) : (
              <div ref={listScrollRef} className="max-h-[560px] overflow-y-auto overflow-x-auto rounded-xl border border-xyne-border">
                {/* table-fixed: content can never force the table wider than
                    the column (break-words does NOT shrink a table's
                    min-content — a long `prisma.foo.bar()` token was forcing
                    h-scroll). "Routed by" additionally drops below @2xl. */}
                <table className="w-full table-fixed text-[13px]">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-xyne-border bg-xyne-surface-subtle text-left text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">
                      <th className="w-24 px-3 py-2 font-medium">Time</th>
                      <th className="px-3 py-2 font-medium">Error</th>
                      <th className="hidden w-32 px-3 py-2 font-medium @2xl:table-cell">Routed by</th>
                      <th className="w-28 px-3 py-2 font-medium">Agent</th>
                    </tr>
                  </thead>
                  {/* key={itemsTab}: remount the whole body on tab change so React can
                      never reconcile one tab's rows into another (that reuse is what
                      showed a tab's rows under the next tab, stuck at the top). */}
                  <tbody key={itemsTab}>
                    {visibleRows.map((row) => (
                      <tr key={`${itemsTab}:${row.errorKey}`} onClick={() => openDetail(row)}
                        {...(row.errorKey === detailKey ? { ref: selectedRowRef } : {})}
                        className={`cursor-pointer border-b border-xyne-border-subtle align-top transition hover:bg-xyne-surface-subtle/50 ${row.errorKey === detailKey ? "bg-xyne-surface-subtle/70" : ""}`}>
                        <td className="px-3 py-2 text-[11px] text-xyne-fg-muted">
                          {new Date(row.timeMs).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="px-3 py-2">
                          <div className="line-clamp-2 font-mono text-[11px] text-xyne-fg-secondary [overflow-wrap:anywhere]">{row.message}</div>
                          <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-xyne-fg-muted">
                            <span className="truncate">{row.errorKey}</span>
                            {typeof row.item?.error.count === "number" && (
                              <span className="rounded bg-amber-500/15 px-1 py-px text-amber-300" title="Occurrences in the alert window">×{row.item.error.count}</span>
                            )}
                          </div>
                        </td>
                        <td className="hidden px-3 py-2 text-[11px] @2xl:table-cell">
                          {row.signal
                            ? <span className={`rounded px-1.5 py-0.5 ${chip(row.signal)}`}>{row.signal}</span>
                            : <span className="text-[11px] text-xyne-fg-muted">—</span>}
                        </td>
                        <td className="px-3 py-2"><AgentStatusChip {...(row.fix ? { status: row.fix.status } : {})} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {tabRows.length > visibleRows.length && (
                  <button onClick={() => setItemsShown((n) => n + 100)}
                    className="w-full border-t border-xyne-border bg-xyne-surface-subtle/40 py-2 text-[12px] text-xyne-fg-secondary transition hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary">
                    Show more · {visibleRows.length} of {tabRows.length}
                  </button>
                )}
              </div>
            )}
          </section>
        )}

      </div>
      </div>

      {/* Detail slide-over on the right (replaces the old modal) — the list
          stays visible and the selected row is highlighted. Same tinted-tray +
          floating SidePanel idiom as the MCP / agent slide-overs. */}
      <div
        className={`h-full shrink-0 overflow-hidden ${isResizing ? "" : "transition-[width] duration-200 ease-in"}`}
        style={{ width: detail ? panelWidth : 0 }}
      >
        {detail && (
          <div className="relative h-full overflow-hidden border-l border-xyne-border-subtle" style={{ width: panelWidth }}>
            {/* Drag handle: the panel's left edge. */}
            <div
              onMouseDown={handlePanelResizeStart}
              title="Drag to resize"
              className="group absolute inset-y-0 left-0 z-10 flex w-1.5 cursor-col-resize justify-start"
            >
              <div className="h-full w-px bg-transparent transition-all group-hover:w-[3px] group-hover:bg-xyne-border-strong" />
            </div>
            <SidePanel
              width={panelWidth}
              bodyRef={panelBodyRef}
              onClose={closeDetail}
              title={detail.fix?.status === "running" ? "Agent working…" : "Error detail"}
              subtitle={detailKey}
              badge={<AgentStatusChip {...(detail.fix ? { status: detail.fix.status } : {})} />}
              // Composer in the FOOTER: SidePanel renders it outside the
              // scrolling body, so it stays pinned to the bottom while the RCA
              // scrolls — same as the main chat.
              {...(detailConversationId ? {
                footer: (
                  <div className="w-full">
                    <InputArea
                      agentName="Xyne Doctor"
                      value={chatInput}
                      onChange={setChatInput}
                      onSend={() => void sendFollowUp()}
                      onStop={() => { /* streaming abort not wired in the panel */ }}
                      sending={chatSending}
                      disabled={!detailConversationId}
                      pendingFiles={pendingFiles}
                      onAddFiles={addFiles}
                      onRemoveFile={removeFile}
                      selectedContext={selectedContext}
                      onRemoveContext={(item) =>
                        setSelectedContext((prev) => prev.filter((c) => !(c.type === item.type && c.id === item.id)))
                      }
                      mentionOpen={mentionOpen}
                      onToggleMention={() => setMentionOpen((v) => !v)}
                      renderMentionPicker={() => (
                        <ContextPicker
                          slug="doctor-agent"
                          userId={userId}
                          open={mentionOpen}
                          tab={contextTab}
                          query={contextQuery}
                          selectedKeys={selectedContextKeys}
                          onTabChange={setContextTab}
                          onQueryChange={setContextQuery}
                          onSelect={(item) =>
                            setSelectedContext((prev) =>
                              prev.some((c) => c.type === item.type && c.id === item.id) ? prev : [...prev, item],
                            )
                          }
                          onClose={() => setMentionOpen(false)}
                        />
                      )}
                    />
                  </div>
                ),
              } : {})}
              actions={
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(window.location.href).then(() => {
                      setLinkCopied(true);
                      setTimeout(() => setLinkCopied(false), 1500);
                    });
                  }}
                  title="Copy shareable link to this error"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-xyne-surface-subtle text-xyne-fg-secondary transition-colors hover:bg-xyne-border-subtle hover:text-xyne-fg-primary"
                >
                  {linkCopied ? <CheckIcon size={15} className="text-emerald-400" /> : <LinkSimpleIcon size={15} />}
                </button>
              }
            >
              <div className="space-y-5">
                <section>
                  <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">Error log</h4>
                  {/* Content-sized with a floor: min-height so a one-liner still
                      reads as a block, full text wrapped (the panel scrolls). */}
                  <div className="relative">
                    <CopyButton text={detail.item?.error.message ?? detail.fix?.message ?? ""} label="error log" />
                    <pre className="min-h-24 whitespace-pre-wrap rounded-lg border border-xyne-border-subtle bg-xyne-surface-subtle p-3 pr-10 font-mono text-[11.5px] leading-relaxed text-xyne-fg-secondary [overflow-wrap:anywhere]">
                      {detail.item?.error.message ?? detail.fix?.message ?? ""}
                    </pre>
                  </div>
                </section>

                {/* Metadata as a bordered definition list — aligned label/value
                    rows read cleaner in the narrow panel than a loose grid. The
                    error key lives in the panel subtitle, not repeated here. */}
                <section className="overflow-hidden rounded-lg border border-xyne-border-subtle text-[12px]">
                  {([
                    ["Lane", <span key="l" className="text-xyne-fg-primary">{detail.item?.classification.bucket ?? detail.fix?.bucket}</span>],
                    detail.item ? ["Routed by", <span key="r"><span className={`rounded px-1.5 py-0.5 text-[11px] ${chip(detail.item.classification.signal)}`}>{detail.item.classification.signal}</span> <span className="text-xyne-fg-muted">{detail.item.classification.reason.replace(/^(rule|default):/, "")}</span></span>] : null,
                    detail.item?.error.sampleRequestId ? ["Request ID", <span key="q" className="break-all font-mono text-[11px] text-xyne-fg-secondary">{detail.item.error.sampleRequestId}</span>] : null,
                    typeof detail.item?.error.count === "number" ? ["Occurrences", <span key="c" className="text-xyne-fg-secondary">{detail.item.error.count.toLocaleString()} <span className="text-xyne-fg-muted">in the alert window</span></span>] : null,
                    detail.item?.error.occurredAt ? ["Error at", <span key="o" className="text-xyne-fg-secondary">{new Date(detail.item.error.occurredAt).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>] : null,
                    detail.item ? ["Queued", <span key="t" className="text-xyne-fg-secondary">{new Date(detail.item.enqueuedAt).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>] : null,
                    detail.fix?.sessionId ? ["Agent session", <span key="s" className="break-all font-mono text-[11px] text-xyne-fg-secondary">{detail.fix.sessionId}</span>] : null,
                  ] as const)
                    .filter((row): row is [string, React.ReactElement] => row !== null)
                    .map(([label, value], i) => (
                      <div key={label} className={`flex items-baseline gap-4 px-3 py-2 ${i > 0 ? "border-t border-xyne-border-subtle" : ""}`}>
                        <span className="w-24 shrink-0 text-xyne-fg-tertiary">{label}</span>
                        <div className="min-w-0">{value}</div>
                      </div>
                    ))}
                </section>

                <section>
                  <div className="mb-1.5 flex items-center gap-2">
                    <h4 className="text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">Agent response</h4>
                    {detail.fix && <span className="text-[10px] text-xyne-fg-muted">{new Date(detail.fix.updatedAt).toLocaleString()}</span>}
                  </div>
                  {!detail.fix ? (
                    <p className="min-h-24 rounded-lg border border-xyne-border-subtle bg-xyne-surface-subtle p-3 text-[12px] text-xyne-fg-muted">
                      No agent run for this error yet — it's waiting in the queue.
                    </p>
                  ) : detail.fix.status === "running" ? (
                    <p className="flex min-h-24 items-start gap-2 rounded-lg border border-xyne-border-subtle bg-xyne-surface-subtle p-3 text-[12px] text-xyne-fg-muted">
                      <SpinnerGapIcon size={14} className="mt-0.5 shrink-0 animate-spin" /> The agent is working on this error right now — check back shortly.
                    </p>
                  ) : detail.fix.summary ? (
                    // Content-sized, full text wrapped — the panel body scrolls,
                    // no nested scrollbox.
                    <div className="space-y-2">
                      {/* The run's own thinking + tool calls — collapsed by
                          default, restoring what "Open chat" used to show. */}
                      {(runReasoning || runInvocations.length > 0) && (
                        <ActivityGroup steps={runInvocations.length + (runReasoning ? 1 : 0)}>
                          {runReasoning && <ReasoningBlock text={runReasoning} streaming={false} />}
                          {runInvocations.length > 0 && <InvocationBlocks invocations={runInvocations} />}
                        </ActivityGroup>
                      )}
                      <div className="relative">
                        <CopyButton text={detail.fix.summary} label="agent response" />
                        <div className="min-h-24 rounded-lg border border-xyne-border-subtle bg-xyne-surface-subtle p-4 pr-10">
                          <AgentResponse>{detail.fix.summary}</AgentResponse>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="min-h-24 rounded-lg border border-xyne-border-subtle bg-xyne-surface-subtle p-3 text-[12px] text-xyne-fg-muted">
                      The run finished but returned no text. If this keeps happening, check the agent's provider/model configuration — a run with no working model completes empty.
                    </p>
                  )}

                  <AttachmentList attachments={detailAttachments} expandedId={expandedAttId} onToggle={setExpandedAttId} heading />
                </section>

                {/* Follow-up thread — the composer itself lives in the
                    panel FOOTER so it stays pinned while this scrolls. */}
                {threadConversationId && (followUps.length > 0 || chatSending || chatError || resume) && (
                  <section className="space-y-3 border-t border-xyne-border-subtle pt-4">
                    {/* Same shape as the main chat: user = solid brand bubble
                        with avatar, assistant = plain prose (no card — a
                        bordered box around every reply reads as a form). */}
                    {followUps.map((m) => (
                      m.role === "user" ? (
                        <div key={m.id} className="flex flex-row-reverse items-end gap-2 pt-1">
                          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-xyne-fg-primary text-[9px] font-bold text-xyne-fg-inverse">
                            {userAbbr}
                          </div>
                          <div
                            className="whitespace-pre-wrap rounded-[14px] rounded-tr-[4px] bg-xyne-brand px-3.5 py-2 text-[12.5px] leading-relaxed text-xyne-fg-inverse [overflow-wrap:anywhere]"
                            style={{ maxWidth: "80%" }}
                          >
                            {m.content}
                          </div>
                        </div>
                      ) : (
                        <div key={m.id} className="space-y-1.5 pb-1">
                          {/* Reasoning + tool calls that produced this reply —
                              collapsed by default, same rows as the chat. */}
                          {(() => {
                            const invs = invocationsByMsgId.get(m.id) ?? [];
                            const reasoning = reasoningByMsgId.get(m.id);
                            const steps = invs.length + (reasoning ? 1 : 0);
                            if (steps === 0) return null;
                            return (
                              <ActivityGroup steps={steps}>
                                {reasoning && <ReasoningBlock text={reasoning} streaming={false} />}
                                {invs.length > 0 && <InvocationBlocks invocations={invs} />}
                              </ActivityGroup>
                            );
                          })()}
                          <AgentResponse>{m.content}</AgentResponse>
                          {/* Files the agent attached in this follow-up turn —
                              same inline preview as the RCA attachments. */}
                          <AttachmentList attachments={m.attachments ?? []} expandedId={expandedAttId} onToggle={setExpandedAttId} />
                        </div>
                      )
                    ))}
                    {/* In-flight turn: render exactly like the chat — live
                        tool/reasoning blocks and streamed text appear directly;
                        the bouncing-dots pill shows ONLY until the first
                        activity lands (chat's showThinkingPill rule). */}
                    {chatSending && (
                      <div className="space-y-1.5 pb-1">
                        {liveReasoning && <ReasoningBlock text={liveReasoning} streaming />}
                        {liveInvocations.length > 0 && <InvocationBlocks invocations={liveInvocations} />}
                        {chatStream && <AgentResponse>{chatStream}</AgentResponse>}
                        {liveInvocations.length === 0 && !liveReasoning && !chatStream && (
                          // Dots only — the label ("Thinking…") added nothing
                          // the animation doesn't already say, and this sits in
                          // a narrow panel.
                          <div className="inline-flex w-fit items-center gap-1.5 px-1 py-1.5" title={chatLabel || "Thinking…"}>
                            <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-xyne-fg-muted [animation-delay:-0.3s]" />
                            <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-xyne-fg-muted [animation-delay:-0.15s]" />
                            <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-xyne-fg-muted" />
                          </div>
                        )}
                      </div>
                    )}
                    {/* Live resume: a turn still running server-side that this
                        panel isn't driving (you sent, switched, came back). Same
                        blocks as the in-flight render, fed by the /live stream. */}
                    {!chatSending && resume && (resume.content || resume.reasoning || resume.invocations.length > 0) && (
                      <div className="space-y-1.5 pb-1">
                        {resume.reasoning && <ReasoningBlock text={resume.reasoning} streaming={resume.active} />}
                        {resume.invocations.length > 0 && <InvocationBlocks invocations={resume.invocations} />}
                        {resume.content && <AgentResponse>{resume.content}</AgentResponse>}
                        {resume.active && (
                          <div className="inline-flex w-fit items-center gap-1.5 px-1 py-1.5">
                            <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-xyne-fg-muted [animation-delay:-0.3s]" />
                            <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-xyne-fg-muted [animation-delay:-0.15s]" />
                            <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-xyne-fg-muted" />
                          </div>
                        )}
                      </div>
                    )}
                    {chatError && <p className="text-[11px] text-red-400">{chatError}</p>}
                    <div ref={chatEndRef} />
                  </section>
                )}
              </div>
            </SidePanel>
          </div>
        )}
      </div>

      <Dialog
        open={Boolean(draft)}
        onOpenChange={(open) => { if (!open) setDraft(null); }}
        title={draft?.isNew ? "Add bucket" : `Edit bucket: ${draft?.name ?? ""}`}
        maxWidth={640}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setDraft(null)}
              className="rounded-lg border border-xyne-border px-3 py-1.5 text-[13px] text-xyne-fg-secondary hover:bg-xyne-surface-subtle">Cancel</button>
            <button onClick={() => void saveDraft()} disabled={saving}
              className="rounded-lg bg-xyne-brand px-3 py-1.5 text-[13px] font-medium text-xyne-fg-inverse hover:opacity-90 disabled:opacity-50">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        }
      >
        {draft && (
          <div className="space-y-4">
            <p className="text-[12px] text-xyne-fg-muted">
              Buckets route errors by matching the message. First match by order wins; the classifier picks up changes within ~60s.
            </p>
            <div className="grid grid-cols-3 gap-3">
              <label className="col-span-2 block">
                <span className="text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">Name</span>
                <input value={draft.name} disabled={!draft.isNew}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="e.g. billing"
                  className="mt-1 h-8 w-full rounded-lg border border-xyne-border bg-xyne-surface px-2 text-[13px] text-xyne-fg-primary placeholder:text-xyne-fg-tertiary focus:border-xyne-brand focus:outline-none disabled:opacity-60" />
              </label>
              <label className="block">
                <span className="text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">Match order</span>
                <input type="number" value={draft.matchOrder}
                  onChange={(e) => setDraft({ ...draft, matchOrder: Number(e.target.value) })}
                  className="mt-1 h-8 w-full rounded-lg border border-xyne-border bg-xyne-surface px-2 text-[13px] text-xyne-fg-primary focus:border-xyne-brand focus:outline-none" />
              </label>
            </div>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">Description</span>
              <input value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="one line: what belongs in this lane"
                className="mt-1 h-8 w-full rounded-lg border border-xyne-border bg-xyne-surface px-2 text-[13px] text-xyne-fg-primary placeholder:text-xyne-fg-tertiary focus:border-xyne-brand focus:outline-none" />
            </label>
            <div className="block">
              <span className="text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">Keywords <span className="normal-case text-xyne-fg-muted">(route here if the message contains any of these — case-insensitive)</span></span>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 rounded-lg border border-xyne-border bg-xyne-surface p-2">
                {draft.keywords.map((k) => (
                  <span key={k} className="inline-flex items-center gap-1 rounded bg-xyne-brand/15 px-1.5 py-0.5 text-[12px] text-xyne-brand">
                    {k}
                    <button onClick={() => removeKeyword(k)} className="text-xyne-brand/70 hover:text-xyne-brand">×</button>
                  </span>
                ))}
                <input
                  value={kwInput}
                  onChange={(e) => setKwInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addKeyword(); }
                    else if (e.key === "Backspace" && !kwInput && draft.keywords.length) { const last = draft.keywords[draft.keywords.length - 1]; if (last) removeKeyword(last); }
                  }}
                  onBlur={addKeyword}
                  placeholder={draft.keywords.length ? "add another…" : "e.g. payment failed"}
                  className="min-w-[8rem] flex-1 bg-transparent text-[13px] text-xyne-fg-primary placeholder:text-xyne-fg-tertiary focus:outline-none" />
              </div>
              <p className="mt-1 text-[10px] text-xyne-fg-muted">Type a phrase and press Enter. Matched literally — no regex needed.</p>
            </div>
            <div className="block">
              <button type="button" onClick={() => setAdvOpen((v) => !v)}
                className="text-[11px] uppercase tracking-wide text-xyne-fg-tertiary hover:text-xyne-fg-secondary">
                {advOpen ? "▾" : "▸"} Advanced: raw regex {draft.markers.trim() && !advOpen ? "(set)" : ""}
              </button>
              {advOpen && (
                <>
                  <textarea value={draft.markers} rows={4}
                    onChange={(e) => setDraft({ ...draft, markers: e.target.value })}
                    placeholder="[Ll]ite[Ll][Ll][Mm]|\\bVespa\\w*\\b"
                    className="mt-1 w-full rounded-lg border border-xyne-border bg-xyne-surface p-2 font-mono text-[12px] text-xyne-fg-primary placeholder:text-xyne-fg-tertiary focus:border-xyne-brand focus:outline-none" />
                  <p className="mt-1 text-[10px] text-xyne-fg-muted">Case-sensitive regex, unioned with the keywords above. For power patterns (word boundaries, char classes).</p>
                </>
              )}
            </div>
            <label className="flex items-center gap-2 text-[13px] text-xyne-fg-secondary">
              <input type="checkbox" checked={draft.enabled}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
              Enabled <span className="text-xyne-fg-muted">(disabled lanes are skipped by the classifier but keep their rules)</span>
            </label>
            {saveError && <p className="text-[12px] text-xyne-error-fg">{saveError}</p>}
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete bucket"
        description={deleteTarget ? `Delete the "${deleteTarget}" bucket and its rules? Errors that matched it will fall through to the next lane or default.` : ""}
        confirmLabel="Delete"
        danger
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
