import { useState } from "react";
import {
  Loader2,
  Download,
  FileText,
  Check,
  X,
  Eye,
  Link2,
} from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ToolInvocation, PendingAction, SlidePptConfig } from "../lib/api";
import { fetchChatAttachmentSlideJson } from "../lib/api";
import { PptViewer } from "./PptViewer";

/**
 * Turn a raw tool id like `Xyne_Spaces__spaces-create-ticket` or
 * `merge_pull_request` into a user-facing label like "Create Ticket" /
 * "Merge Pull Request". Strips the MCP server prefix if present, then
 * title-cases words separated by `-` or `_`.
 */
interface InlineCitation {
  point: string;
  label: string;
  url: string;
}

function stripCitationBlock(text: string): string {
  return text.replace(/\n?<citation\b[^>]*>([\s\S]*?)<\/citation>/gi, "");
}

function isSafeCitationHref(url: string): boolean {
  if (url.startsWith("/") && !url.startsWith("//")) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function extractInlineCitations(content: string): InlineCitation[] {
  const match = /<citation\b[^>]*>([\s\S]*?)<\/citation>/i.exec(content);
  if (!match || !match[1]) return [];

  const citations: InlineCitation[] = [];
  const lines = match[1].trim().split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    const km = /^\d+\.\s+(.+?)\s+\|\|\|\s+\[([^\]]+)\]\(([^)]+)\)/.exec(
      trimmed,
    );
    if (km && km[1] && km[2]) {
      citations.push({
        point: km[1].trim(),
        label: km[2].trim(),
        url: km[3]?.trim() || "",
      });
      continue;
    }
    const lm = /^\d+\.\s*\[([^\]]+)\]\(([^)]+)\)/.exec(trimmed);
    if (lm && lm[1] && lm[2]) {
      citations.push({ point: "", label: lm[1].trim(), url: lm[2].trim() });
    }
  }
  return citations;
}

function humanizeToolName(raw: string): string {
  if (!raw) return raw;
  // Strip "Server_Name__" prefix added by xyne-claw when exposing MCP tools.
  const stripped = raw.includes("__")
    ? raw.split("__").slice(1).join("__")
    : raw;
  // Some MCP adapters also prefix with "serverType:" — strip.
  const trimmed = stripped.includes(":")
    ? stripped.split(":").slice(-1)[0]!
    : stripped;
  // Split on - or _, title-case each segment.
  return trimmed
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export interface BubbleFile {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  url: string;
}

export interface BubbleMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  contextItems?: Array<{
    type: "channel" | "ticket" | "canvas" | "call";
    id: string;
    title: string;
  }>;
  status?: "completed" | "failed" | "running" | "cancelled";
  images?: string[];
  /** Non-image attachments (PDF, PPTX, DOCX, etc.) rendered as download cards. */
  files?: BubbleFile[];
  /** Collapsible reasoning block (shown above tool calls + text). Live-streaming when `streaming=true`. */
  reasoning?: string;
  /** Collapsible tool-invocation cards (shown between reasoning and text, in temporal order). */
  invocations?: ToolInvocation[];
  /** When true: show the current-tool label + blinking caret. Suppressed when stream ends. */
  streaming?: boolean;
  /** Write-tool approvals queued by the agent. Renders Approve/Decline buttons
   *  inside the bubble, same UX as the Spaces-thread button flow. */
  pendingActions?: PendingAction[];
  /** Called when user clicks Approve on a pending action. Parent runs the action
   *  and appends the result to this assistant message's content. */
  onApproveAction?: (pa: PendingAction) => Promise<void> | void;
  /** Called when user clicks Decline. Parent removes the action from the bubble. */
  onDeclineAction?: (pa: PendingAction) => void;
  /** Optional metadata block rendered BELOW the bubble (used by ActivityTab for run metadata). */
  footer?: React.ReactNode;
}

export function MessageBubble({
  message,
  userId,
}: {
  message: BubbleMessage;
  userId?: string;
}) {
  const {
    role,
    content,
    contextItems,
    status,
    images,
    files,
    reasoning,
    invocations,
    streaming,
    pendingActions,
    onApproveAction,
    onDeclineAction,
    footer,
  } = message;
  const isUser = role === "user";
  const hasFiles = (files?.length ?? 0) > 0;
  const hasPendingActions = !isUser && (pendingActions?.length ?? 0) > 0;

  const bubbleClass = isUser
    ? "bg-purple-600 text-white"
    : status === "failed"
      ? "bg-red-950 text-red-300"
      : status === "cancelled"
        ? "bg-zinc-900 text-zinc-400"
        : "bg-zinc-800 text-zinc-200";

  // Does the assistant bubble have ANY renderable content?
  // Used to decide whether to render the rounded rectangle at all (empty rect
  // during the initial "just-sent, nothing back yet" moment looks broken).
  const hasReasoning = !isUser && !!reasoning && reasoning.length > 0;
  const hasInvocations = !isUser && (invocations?.length ?? 0) > 0;
  const hasText = content.length > 0;
  const assistantHasAnything =
    hasReasoning || hasInvocations || hasText || hasFiles || hasPendingActions;
  const hideBubble = !isUser && !assistantHasAnything;

  // Non-empty streaming status line shown while streaming AND there's nothing
  // yet in the bubble — collapses automatically once reasoning/tools/text start.
  const showThinkingPill = !isUser && streaming && !assistantHasAnything;

  return (
    <div className={`flex min-w-0 ${isUser ? "justify-end" : "justify-start"}`}>
      <div className="min-w-0 max-w-[75%]">
        {showThinkingPill && (
          <div className="inline-flex items-center gap-2 rounded-full bg-zinc-900/70 px-3 py-1.5 text-xs text-zinc-400 ring-1 ring-zinc-800">
            <Loader2 size={12} className="animate-spin" />
            <span>Thinking...</span>
          </div>
        )}

        {!hideBubble && (
          <>
            <div className={`rounded-lg px-4 py-2.5 text-sm ${bubbleClass}`}>
              {isUser ? (
                <>
                  {images && images.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {images.map((src, i) => (
                        <img
                          key={i}
                          src={src}
                          alt=""
                          className="max-h-48 rounded-md"
                        />
                      ))}
                    </div>
                  )}
                  {contextItems && contextItems.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {contextItems.map((item) => (
                        <span
                          key={`${item.type}:${item.id}`}
                          className="rounded-full border border-white/30 bg-black/15 px-2 py-0.5 text-[11px] text-white/95"
                          title={`${item.type} • ${item.id}`}
                        >
                          {contextTypeLabel(item.type)}: {item.title}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="whitespace-pre-wrap">{content}</div>
                </>
              ) : (
                <div className="space-y-2">
                  {/* Reasoning — collapsed by default (same UX as ChatGPT's "Thought for Xs"). */}
                  {hasReasoning && (
                    <ReasoningBlock
                      text={reasoning!}
                      streaming={Boolean(streaming)}
                    />
                  )}

                  {/* Tool invocations — each card collapsed, expandable for args+result.
                    Subagent rows nest children under them (existing <ToolInvocationList> behavior,
                    inlined here so tool calls live INSIDE the bubble, not as a footer). */}
                  {hasInvocations && (
                    <InvocationBlocks invocations={invocations!} />
                  )}

                  {/* Final streaming text — flows at the bottom, never wrapped in a block container.
                    On done, the caret just disappears; the text itself is unchanged so no jitter. */}
                  {hasText && (
                    <div className="prose prose-sm prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:my-2 prose-table:my-2 prose-hr:my-2 prose-th:px-2 prose-th:py-1 prose-td:px-2 prose-td:py-1 prose-th:border prose-td:border prose-th:border-zinc-700 prose-td:border-zinc-700">
                      <Markdown remarkPlugins={[remarkGfm]}>
                        {stripCitationBlock(content)}
                      </Markdown>
                      {streaming && (
                        <span className="inline-block h-3 w-1.5 translate-y-[1px] animate-pulse bg-zinc-400" />
                      )}
                    </div>
                  )}
                  <InlineCitations content={content} />

                  {/* Non-image file attachments — rendered as download cards. */}
                  {hasFiles && (
                    <FileAttachments files={files!} userId={userId} />
                  )}

                  {/* Write-tool approval cards — Approve/Decline per queued action. */}
                  {hasPendingActions && (
                    <PendingActionBlocks
                      actions={pendingActions!}
                      onApprove={onApproveAction}
                      onDecline={onDeclineAction}
                    />
                  )}
                </div>
              )}
            </div>
            {footer && (
              <div className="mt-1 px-1 text-xs text-zinc-500">{footer}</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Inline Citations (Key Points with pill badges) ───────────────────────
function InlineCitations({ content }: { content: string }) {
  const citations = extractInlineCitations(content);
  if (citations.length === 0) return null;

  const hasPoints = citations.some((c) => c.point);

  return (
    <div className="space-y-2 pt-2">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
        {hasPoints ? "Key Points" : "Citations"}
      </h4>
      <ol className="space-y-2">
        {citations.map((c, idx) => (
          <li key={idx} className="flex items-start gap-2">
            <span className="mt-0.5 min-w-[1.2rem] text-[11px] font-semibold text-zinc-500">
              {idx + 1}.
            </span>
            <div className="text-[13px] leading-relaxed text-zinc-300">
              {c.point ? (
                <span>
                  {c.point}
                  {c.label ? (
                    <span className="ml-1.5 inline-flex items-center align-middle">
                      {c.url && isSafeCitationHref(c.url) ? (
                        <a
                          href={c.url}
                          className="inline-flex items-center gap-1 rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400 transition hover:bg-zinc-700 hover:text-zinc-200"
                        >
                          <Link2 size={10} />
                          {c.label}
                        </a>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400">
                          <Link2 size={10} />
                          {c.label}
                        </span>
                      )}
                    </span>
                  ) : null}
                </span>
              ) : c.url && isSafeCitationHref(c.url) ? (
                <a
                  href={c.url}
                  className="inline-flex items-center gap-1 rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400 transition hover:bg-zinc-700 hover:text-zinc-200"
                >
                  <Link2 size={10} />
                  {c.label}
                </a>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400">
                  <Link2 size={10} />
                  {c.label}
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function contextTypeLabel(
  type: "channel" | "ticket" | "canvas" | "call",
): string {
  if (type === "channel") return "Channel";
  if (type === "ticket") return "Ticket";
  if (type === "canvas") return "Canvas";
  return "Call";
}

// ── File attachment cards (download) ─────────────────────────────────────
function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

function FileAttachments({
  files,
  userId,
}: {
  files: BubbleFile[];
  userId?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {files.map((f) => (
        <FileAttachmentCard key={f.id} file={f} userId={userId} />
      ))}
    </div>
  );
}

function FileAttachmentCard({
  file: f,
  userId,
}: {
  file: BubbleFile;
  userId?: string;
}) {
  const [viewer, setViewer] = useState<SlidePptConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const size = formatFileSize(f.size);
  // Streaming placeholders use a synthetic id — no persisted slide JSON yet,
  // so suppress the Preview button until the final `done` event swaps in the
  // real GCS-backed attachment.
  const isStreaming = f.id.startsWith("streaming-");
  const isPptx =
    userId &&
    !isStreaming &&
    (f.mimeType === PPTX_MIME || f.name.toLowerCase().endsWith(".pptx"));

  const openPreview = async () => {
    if (!userId || loading) return;
    setLoading(true);
    setErr(null);
    try {
      const data = await fetchChatAttachmentSlideJson(f.id, userId);
      if (!data)
        setErr(
          "Preview not available — slide JSON wasn't saved for this file.",
        );
      else setViewer(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load preview");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="group flex items-center gap-2.5 rounded-md border border-zinc-700 bg-zinc-900/40 px-2.5 py-1.5 transition hover:border-zinc-600 hover:bg-zinc-900">
        <FileText size={18} className="shrink-0 text-zinc-400" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] text-zinc-200">{f.name}</div>
          {err ? (
            <div className="text-[10px] text-red-400">{err}</div>
          ) : size ? (
            <div className="text-[10px] text-zinc-500">{size}</div>
          ) : null}
        </div>
        {isPptx && (
          <button
            onClick={openPreview}
            disabled={loading}
            className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-50"
            title="Preview slides"
          >
            {loading ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Eye size={12} />
            )}
            Preview
          </button>
        )}
        <a
          href={f.url}
          download={f.name}
          className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-100"
          title={`Download ${f.name}`}
        >
          <Download size={12} />
          Download
        </a>
      </div>
      {viewer && (
        <PptViewer
          config={viewer}
          fileName={f.name}
          onClose={() => setViewer(null)}
        />
      )}
    </>
  );
}

// ── Reasoning block ──────────────────────────────────────────────────────
function ReasoningBlock({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-md border border-zinc-700 bg-zinc-900/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px] text-zinc-400 transition hover:bg-zinc-900"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`shrink-0 transition ${expanded ? "rotate-90" : ""}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span>🧠 {streaming ? "Thinking…" : "Thought"}</span>
        <span className="ml-auto font-mono text-zinc-600">
          {text.length} chars
        </span>
      </button>
      {expanded && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-zinc-800 px-3 py-2 font-mono text-[11px] text-zinc-400">
          {text}
        </pre>
      )}
    </div>
  );
}

function extractRespondToUserMessage(inv: ToolInvocation): string {
  const args = inv.args;
  if (args && typeof args === "object" && "message" in args) {
    const m = (args as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return "";
}

// ── Inline tool invocation blocks (nested for subagents) ────────────────
function InvocationBlocks({ invocations }: { invocations: ToolInvocation[] }) {
  // Group: top-level (no parentToolCallId) vs nested children.
  const roots: ToolInvocation[] = [];
  const childrenByParent = new Map<string, ToolInvocation[]>();
  for (const inv of invocations) {
    if (inv.parentToolCallId) {
      const list = childrenByParent.get(inv.parentToolCallId) ?? [];
      list.push(inv);
      childrenByParent.set(inv.parentToolCallId, list);
    } else {
      roots.push(inv);
    }
  }

  // If we only have orphan children (parent hasn't finished yet), still render.
  const toRender =
    roots.length > 0 ? roots : Array.from(childrenByParent.values()).flat();

  return (
    <div className="space-y-1.5">
      {toRender.map((inv, i) => {
        // Copilot mode's `respond-to-user` is the agent's response channel —
        // its `message` arg is the actual reply text, not a tool result. Render
        // it as a markdown assistant response instead of a collapsible card.
        if (inv.toolName === "respond-to-user") {
          const message = extractRespondToUserMessage(inv);
          if (!message) return null;
          return (
            <div
              key={inv.toolCallId ?? `respond-${i}`}
              className="prose prose-sm prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:my-2 prose-table:my-2 prose-hr:my-2 prose-th:px-2 prose-th:py-1 prose-td:px-2 prose-td:py-1 prose-th:border prose-td:border prose-th:border-zinc-700 prose-td:border-zinc-700"
            >
              <Markdown remarkPlugins={[remarkGfm]}>{message}</Markdown>
            </div>
          );
        }
        return (
          <InvocationItem
            key={inv.toolCallId ?? `${inv.toolName}-${i}`}
            invocation={inv}
            children={
              inv.toolCallId ? childrenByParent.get(inv.toolCallId) : undefined
            }
          />
        );
      })}
    </div>
  );
}

function InvocationItem({
  invocation,
  children,
}: {
  invocation: ToolInvocation;
  children?: ToolInvocation[];
}) {
  const [expanded, setExpanded] = useState(false);

  const argsPreview = (() => {
    try {
      const s = JSON.stringify(invocation.args ?? {});
      return s.length > 80 ? s.slice(0, 80) + "…" : s;
    } catch {
      return String(invocation.args);
    }
  })();

  const argsFull = (() => {
    try {
      return JSON.stringify(invocation.args ?? {}, null, 2);
    } catch {
      return String(invocation.args);
    }
  })();

  const isSubagent = children && children.length > 0;
  const isRunning = invocation.status === "running";
  const runningChildren =
    children?.filter((c) => c.status === "running").length ?? 0;
  const completedChildren = (children?.length ?? 0) - runningChildren;

  return (
    <div
      className={`rounded-md border ${invocation.isError ? "border-red-900/50 bg-red-950/20" : isRunning ? "border-blue-900/50 bg-blue-950/10" : isSubagent ? "border-purple-900/50 bg-purple-950/10" : "border-zinc-700 bg-zinc-900/50"}`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start gap-2 px-2 py-1.5 text-left"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`mt-1 shrink-0 text-zinc-500 transition ${expanded ? "rotate-90" : ""}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs">
            {(isRunning || runningChildren > 0) && (
              <Loader2 size={10} className="animate-spin text-blue-400" />
            )}
            {invocation.subagentName && (
              <span className="rounded bg-purple-950 px-1.5 py-0.5 text-[10px] text-purple-300">
                {invocation.subagentName}
              </span>
            )}
            {isSubagent && <span className="text-xs">🤖</span>}
            <span className="text-zinc-200">
              {humanizeToolName(invocation.toolName)}
            </span>
            {invocation.isError && (
              <span className="rounded bg-red-950 px-1.5 py-0.5 text-[10px] text-red-400">
                error
              </span>
            )}
            {isSubagent && (
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                {runningChildren > 0
                  ? `${completedChildren} done · ${runningChildren} running`
                  : `${completedChildren} tool call${completedChildren === 1 ? "" : "s"}`}
              </span>
            )}
            <span className="ml-auto font-mono text-zinc-600">
              {isRunning ? "running…" : `${invocation.durationMs}ms`}
            </span>
          </div>
          {!expanded && (
            <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">
              {argsPreview}
            </p>
          )}
        </div>
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-zinc-800 px-2 py-2 text-[11px]">
          <div>
            <div className="mb-0.5 text-zinc-500">Args</div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-zinc-950 p-2 font-mono text-zinc-300">
              {argsFull}
            </pre>
          </div>
          <div>
            <div className="mb-0.5 text-zinc-500">Result</div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-zinc-950 p-2 font-mono text-zinc-300">
              {isRunning
                ? "⏳ waiting for result..."
                : invocation.result || "(empty)"}
            </pre>
          </div>
          {/* Nested child invocations only show when the subagent row is expanded.
              For a subagent row (isSubagent=true), the expand arrow at the top
              doubles as "show tool calls"; the arg/result pair above is typically
              just the original question & summary, so children show right after. */}
          {children && children.length > 0 && (
            <div>
              <div className="mb-0.5 text-zinc-500">
                Inner tool calls ({children.length})
              </div>
              <div className="ml-1 border-l border-purple-900/40 pl-3 space-y-1.5">
                {children.map((child, i) => (
                  <InvocationItem
                    key={child.toolCallId ?? `${child.toolName}-${i}`}
                    invocation={child}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Pending action approval cards (write-tool Approve/Decline) ────────────
function PendingActionBlocks({
  actions,
  onApprove,
  onDecline,
}: {
  actions: PendingAction[];
  onApprove?: (pa: PendingAction) => Promise<void> | void;
  onDecline?: (pa: PendingAction) => void;
}) {
  return (
    <div className="mt-2 space-y-2">
      {actions.map((pa, i) => (
        <PendingActionItem
          key={`${pa.serverType}-${pa.tool}-${i}`}
          action={pa}
          onApprove={onApprove}
          onDecline={onDecline}
        />
      ))}
    </div>
  );
}

function PendingActionItem({
  action,
  onApprove,
  onDecline,
}: {
  action: PendingAction;
  onApprove?: (pa: PendingAction) => Promise<void> | void;
  onDecline?: (pa: PendingAction) => void;
}) {
  const [state, setState] = useState<
    "idle" | "running" | "approved" | "declined" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);

  const argsPreview = (() => {
    try {
      const s = JSON.stringify(action.params ?? {}, null, 2);
      return s.length > 400 ? s.slice(0, 400) + "…" : s;
    } catch {
      return String(action.params);
    }
  })();

  const handleApprove = async () => {
    if (!onApprove) return;
    setState("running");
    setError(null);
    try {
      await onApprove(action);
      setState("approved");
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDecline = () => {
    setState("declined");
    onDecline?.(action);
  };

  // Approved / declined rows collapse to a compact done-row so the user can see
  // history without re-prompting. Same shape Spaces uses for its actioned rows.
  if (state === "approved") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-green-900/50 bg-green-950/20 px-3 py-1.5 text-[11px] text-green-300">
        <Check size={12} />
        <span className="font-medium">{humanizeToolName(action.tool)}</span>
        <span className="text-green-400/80">approved</span>
      </div>
    );
  }
  if (state === "declined") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900/50 px-3 py-1.5 text-[11px] text-zinc-500">
        <X size={12} />
        <span className="font-medium">{humanizeToolName(action.tool)}</span>
        <span>declined</span>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-yellow-800/50 bg-yellow-950/10 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs">
        <span className="text-yellow-400">⚠️</span>
        <span className="text-zinc-300">The agent wants to execute</span>
        <span className="rounded bg-purple-950 px-1.5 py-0.5 text-[10px] text-purple-300">
          {action.serverType}
        </span>
        <span className="text-zinc-100 font-medium">
          {humanizeToolName(action.tool)}
        </span>
      </div>
      <pre className="mb-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-zinc-950 p-2 font-mono text-[11px] text-zinc-400">
        {argsPreview}
      </pre>
      {error && (
        <div className="mb-2 rounded border border-red-900/50 bg-red-950/30 px-2 py-1 text-[11px] text-red-300">
          {error}
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          onClick={handleApprove}
          disabled={state === "running"}
          className="inline-flex items-center gap-1 rounded-md bg-green-700 px-3 py-1 text-xs font-medium text-white transition hover:bg-green-600 disabled:opacity-50"
        >
          {state === "running" ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Check size={12} />
          )}
          Approve
        </button>
        <button
          onClick={handleDecline}
          disabled={state === "running"}
          className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1 text-xs text-zinc-300 transition hover:border-zinc-600 disabled:opacity-50"
        >
          <X size={12} />
          Decline
        </button>
      </div>
    </div>
  );
}
