import { forwardRef, useImperativeHandle, useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  PlusIcon,
  PaperPlaneTiltIcon,
  StopIcon,
  DotsThreeIcon,
  PushPinIcon,
  PushPinSlashIcon,
  PencilSimpleIcon,
  TrashIcon,
  CheckIcon,
  ChatCircleIcon,
  ArrowDownIcon,
  TimerIcon,
  PaperclipIcon,
  AtIcon,
  WrenchIcon,
  GearSixIcon,
  ArrowSquareOutIcon,
  ClockIcon,
  XIcon,
  MagnifyingGlassIcon,
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  InfoIcon,
  ChartBarIcon,
  AppWindowIcon,
  ArrowRightIcon,
  RobotIcon,
  SparkleIcon,
  BrainIcon,
} from "@phosphor-icons/react";
import { useAuth } from "../../hooks/useAuth";
import { useChat } from "../hooks/useChat";
import { useAgents } from "../hooks/useAgents";
import { useConversationMeta } from "../hooks/useConversationMeta";
import {
  deleteChatConversation,
  listChatConversations,
  listRuns,
  pollChatMessages,
  listProviderCredentials,
  setUserAgentConfig,
  uploadChatAttachments,
  type AttachedContextRef,
  type ContextItem,
  type ContextSearchType,
  type ConversationSummary,
  type ChatMsg,
  type ProviderCredential,
  type ToolInvocation,
} from "../../lib/api";
import { ContextPicker } from "../../components/ContextPicker";
import type { Agent } from "../../lib/types";
import { Avatar, nameToHsl } from "./ui/Avatar";
import { Dialog } from "./ui/Dialog";
import { SessionExportMenu } from "./ui/SessionExportMenu";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { Menu, MenuItem } from "./ui/Menu";
import { Menu as BaseMenu } from "@base-ui-components/react/menu";
import { Badge } from "./ui/Badge";

/* ── helpers ─────────────────────────────────────────────────────── */

function initials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function fmtDateShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return fmtTime(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}


const PROVIDER_LABELS: Record<string, string> = {
  spaces: "Spaces",
  copilot: "GitHub Copilot",
  claude: "Anthropic Claude",
  codex: "OpenAI Codex",
};

type ConversationWithAgent = ConversationSummary & { agentSlug: string };

/* ── provider select ─────────────────────────────────────────────── */

/**
 * Provider dropdown.
 *
 * We use the V3 Menu (Base UI) instead of a native <select> so the popup
 * matches the rest of the design system (rounded surface, themed hover,
 * dark-mode aware). Native <option> elements would inherit OS styling and
 * clash hard with the surrounding card.
 */
function ProviderSelect({
  value,
  providers,
  disabled,
  onChange,
}: {
  value: string;
  providers: ProviderCredential[];
  disabled: boolean;
  onChange: (provider: string) => void;
}) {
  const options = useMemo(
    () => [
      { value: "spaces", label: "Spaces (Default)" },
      ...providers
        .filter((p) => p.provider !== "spaces")
        .map((p) => ({ value: p.provider, label: PROVIDER_LABELS[p.provider] ?? p.provider })),
    ],
    [providers],
  );
  const current = options.find((o) => o.value === value) ?? options[0];

  return (
    <Menu
      side="bottom"
      align="start"
      trigger={(triggerProps) => (
        <button
          {...(triggerProps as React.ButtonHTMLAttributes<HTMLButtonElement>)}
          type="button"
          data-id="provider-select"
          disabled={disabled}
          className="flex w-full items-center gap-2 rounded-lg border border-xyne-border-subtle bg-xyne-surface px-3 py-2 text-left text-[13px] transition-colors hover:border-xyne-border hover:bg-xyne-surface-subtle disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-xyne-fg-muted">
            Provider
          </span>
          <span className="flex-1 truncate font-medium text-xyne-fg-primary">
            {current?.label ?? value}
          </span>
          <CaretDownIcon size={12} className="shrink-0 text-xyne-fg-tertiary" />
        </button>
      )}
    >
      {options.map((opt) => (
        <MenuItem
          key={opt.value}
          selected={opt.value === value}
          onSelect={() => { if (opt.value !== value) onChange(opt.value); }}
          trailing={opt.value === value ? <CheckIcon size={12} className="text-xyne-brand" /> : undefined}
        >
          {opt.label}
        </MenuItem>
      ))}
    </Menu>
  );
}

/* ── typing indicator ────────────────────────────────────────────── */

function TypingIndicator({ agent }: { agent: Agent }) {
  return (
    <div data-id="typing-indicator" className="flex items-end gap-2">
      <div
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
        style={{ backgroundColor: nameToHsl(agent.name) }}
      >
        {initials(agent.name)}
      </div>
      <div className="flex items-center gap-1 rounded-[2px_12px_12px_12px] border border-xyne-border bg-xyne-surface px-3.5 py-2.5">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-xyne-fg-muted animate-bounce [animation-delay:-0.3s]" />
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-xyne-fg-muted animate-bounce [animation-delay:-0.15s]" />
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-xyne-fg-muted animate-bounce" />
      </div>
    </div>
  );
}

/* ── tool name humanizer ─────────────────────────────────────────── */

function humanizeToolName(raw: string): string {
  if (!raw) return raw;
  const stripped = raw.includes("__") ? raw.split("__").slice(1).join("__") : raw;
  const trimmed = stripped.includes(":") ? stripped.split(":").slice(-1)[0]! : stripped;
  return trimmed
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/* ── reasoning block ─────────────────────────────────────────────── */

function ReasoningBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div data-id="reasoning-block" className="rounded-lg border border-xyne-border-subtle bg-xyne-surface-subtle">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] text-xyne-fg-tertiary transition-colors hover:bg-xyne-surface"
      >
        <CaretRightIcon
          size={10}
          className={`shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
        />
        <BrainIcon size={12} className="shrink-0" />
        <span className="font-medium">{streaming ? "Thinking…" : "Thought"}</span>
        <span className="ml-auto font-mono text-xyne-fg-muted">{text.length} chars</span>
      </button>
      {expanded && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-xyne-border-subtle px-3 py-2 font-mono text-[11px] text-xyne-fg-secondary">
          {text}
        </pre>
      )}
    </div>
  );
}

/* ── invocation block ────────────────────────────────────────────── */

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
  const runningChildren = children?.filter((c) => c.status === "running").length ?? 0;
  const completedChildren = (children?.length ?? 0) - runningChildren;

  const containerClass = invocation.isError
    ? "border-red-300 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20"
    : isRunning
      ? "border-blue-300 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-950/10"
      : isSubagent
        ? "border-purple-300 bg-purple-50 dark:border-purple-900/50 dark:bg-purple-950/10"
        : "border-xyne-border-subtle bg-xyne-surface-subtle";

  return (
    <div data-id="invocation-item" className={`rounded-lg border ${containerClass}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left"
      >
        <CaretRightIcon
          size={10}
          className={`mt-1 shrink-0 text-xyne-fg-tertiary transition-transform ${expanded ? "rotate-90" : ""}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[12px]">
            {(isRunning || runningChildren > 0) && (
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500" />
            )}
            {!isRunning && !isSubagent && (
              <WrenchIcon size={11} className="shrink-0 text-xyne-fg-tertiary" />
            )}
            {invocation.subagentName && (
              <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                {invocation.subagentName}
              </span>
            )}
            {isSubagent && <RobotIcon size={12} className="text-purple-500" />}
            <span className="font-medium text-xyne-fg-primary">
              {humanizeToolName(invocation.toolName)}
            </span>
            {invocation.isError && (
              <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-red-700 dark:bg-red-950 dark:text-red-400">
                error
              </span>
            )}
            {isSubagent && (
              <span className="rounded bg-xyne-surface px-1.5 py-0.5 text-[10px] text-xyne-fg-tertiary">
                {runningChildren > 0
                  ? `${completedChildren} done · ${runningChildren} running`
                  : `${completedChildren} tool call${completedChildren === 1 ? "" : "s"}`}
              </span>
            )}
            <span className="ml-auto font-mono text-[10px] text-xyne-fg-muted">
              {isRunning ? "running…" : `${invocation.durationMs}ms`}
            </span>
          </div>
          {!expanded && (
            <p className="mt-0.5 truncate font-mono text-[10px] text-xyne-fg-tertiary">
              {argsPreview}
            </p>
          )}
        </div>
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-xyne-border-subtle px-2.5 py-2 text-[11px]">
          <div>
            <div className="mb-0.5 text-xyne-fg-tertiary">Args</div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-xyne-surface p-2 font-mono text-xyne-fg-secondary">
              {argsFull}
            </pre>
          </div>
          <div>
            <div className="mb-0.5 text-xyne-fg-tertiary">Result</div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-xyne-surface p-2 font-mono text-xyne-fg-secondary">
              {isRunning ? "⏳ waiting for result..." : invocation.result || "(empty)"}
            </pre>
          </div>
          {children && children.length > 0 && (
            <div>
              <div className="mb-0.5 text-xyne-fg-tertiary">
                Inner tool calls ({children.length})
              </div>
              <div className="ml-1 space-y-1.5 border-l border-purple-300 pl-3 dark:border-purple-900/40">
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

function InvocationBlocks({ invocations }: { invocations: ToolInvocation[] }) {
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
  const toRender =
    roots.length > 0 ? roots : Array.from(childrenByParent.values()).flat();

  return (
    <div data-id="invocation-blocks" className="space-y-1.5">
      {toRender.map((inv, i) => (
        <InvocationItem
          key={inv.toolCallId ?? `${inv.toolName}-${i}`}
          invocation={inv}
          children={inv.toolCallId ? childrenByParent.get(inv.toolCallId) : undefined}
        />
      ))}
    </div>
  );
}

/* ── message thread ──────────────────────────────────────────────── */

function MessageThread({
  messages,
  sending,
  toolLabel,
  agent,
  userAbbr,
  streamingMsgId,
  liveInvocations,
  liveReasoning,
  invocationsByMsgId,
  reasoningByMsgId,
}: {
  messages: ChatMsg[];
  sending: boolean;
  toolLabel: string | null;
  agent: Agent;
  userAbbr: string;
  streamingMsgId: string | null;
  liveInvocations: ToolInvocation[];
  liveReasoning: string;
  invocationsByMsgId: Map<string, ToolInvocation[]>;
  reasoningByMsgId: Map<string, string>;
}) {
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending, toolLabel, liveInvocations, liveReasoning]);

  const lastMsg = messages.at(-1);
  const isStreaming = lastMsg?.status === "streaming";

  return (
    <div
      ref={threadRef}
      data-id="message-thread"
      className="flex-1 overflow-y-auto px-4 py-5"
    >
      {/* Center the messages on wide screens — same column width as the
          input below so the conversation reads as a single centered stack. */}
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      {messages.map((msg) => {
        const isUser = msg.role === "user";
        const isStream = msg.status === "streaming" || msg.id === streamingMsgId;
        const ts = fmtTime(msg.createdAt);

        if (isUser) {
          return (
            <div key={msg.id} data-id="user-message" className="flex flex-row-reverse items-end gap-2">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-xyne-fg-primary text-[9px] font-bold text-xyne-fg-inverse">
                {userAbbr}
              </div>
              <div className="flex flex-col items-end gap-1" style={{ maxWidth: "75%" }}>
                <div className="whitespace-pre-wrap rounded-[14px] rounded-tr-[4px] bg-xyne-brand px-4 py-2.5 text-[14px] leading-relaxed text-xyne-fg-inverse">
                  {msg.content}
                </div>
                {ts && (
                  <span className="mr-1 flex items-center gap-1 text-[11px] text-xyne-fg-muted">
                    <TimerIcon size={10} />
                    {ts}
                  </span>
                )}
              </div>
            </div>
          );
        }

        // Source of truth for tool calls + reasoning:
        // - For the currently-streaming message: pull from live state (updates every SSE event).
        // - For older finalized messages: pull from the per-message persisted maps.
        const msgInvocations = isStream ? liveInvocations : invocationsByMsgId.get(msg.id) ?? [];
        const msgReasoning = isStream ? liveReasoning : reasoningByMsgId.get(msg.id);

        const hasInvocations = msgInvocations.length > 0;
        const hasReasoning = !!msgReasoning && msgReasoning.length > 0;
        const hasText = msg.content.length > 0;
        const showThinkingPill = isStream && !hasInvocations && !hasReasoning && !hasText;

        return (
          <div key={msg.id} data-id="agent-message" className="flex items-start gap-2">
            <div
              className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
              style={{ backgroundColor: nameToHsl(agent.name) }}
            >
              {initials(agent.name)}
            </div>
            <div className="flex min-w-0 flex-col gap-1.5" style={{ maxWidth: "75%" }}>
              {showThinkingPill && (
                <div className="inline-flex w-fit items-center gap-2 rounded-full bg-xyne-surface px-3 py-1.5 text-[11px] text-xyne-fg-tertiary ring-1 ring-xyne-border-subtle">
                  <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-xyne-fg-muted [animation-delay:-0.3s]" />
                  <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-xyne-fg-muted [animation-delay:-0.15s]" />
                  <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-xyne-fg-muted" />
                  <span>{toolLabel ? `Running ${toolLabel}…` : "Thinking…"}</span>
                </div>
              )}

              {hasReasoning && (
                <ReasoningBlock text={msgReasoning!} streaming={isStream} />
              )}

              {hasInvocations && <InvocationBlocks invocations={msgInvocations} />}

              {hasText && (
                <div
                  className="rounded-[14px] rounded-tl-[4px] border border-xyne-border bg-xyne-surface px-4 py-2.5 text-[14px] leading-relaxed text-xyne-fg-primary"
                  style={{
                    color: msg.status === "error" ? "var(--color-error, #dc2626)" : undefined,
                  }}
                >
                  <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:my-2">
                    <Markdown remarkPlugins={[remarkGfm]}>{msg.content}</Markdown>
                  </div>
                  {isStream && (
                    <span className="ml-1 inline-block h-3 w-1 translate-y-[1px] animate-pulse bg-xyne-fg-muted" />
                  )}
                </div>
              )}

              {ts && !isStream && (hasText || hasInvocations) && (
                <span className="ml-1 flex items-center gap-1 text-[11px] text-xyne-fg-muted">
                  <TimerIcon size={10} />
                  {ts}
                </span>
              )}
            </div>
          </div>
        );
      })}

      {sending && !isStreaming && lastMsg?.role === "user" && (
        <TypingIndicator agent={agent} />
      )}
      </div>
    </div>
  );
}

/* ── left panel ──────────────────────────────────────────────────── */

function ConvItem({
  conv,
  isActive,
  pinned,
  displayTitle,
  agent,
  onSelect,
  onTogglePin,
  onRename,
  onDelete,
}: {
  conv: ConversationWithAgent;
  isActive: boolean;
  pinned: boolean;
  /** Custom title from localStorage, otherwise the server-derived first-message title. */
  displayTitle: string;
  agent?: Agent | null;
  onSelect: () => void;
  onTogglePin: () => void;
  onRename: (next: string) => void;
  onDelete: () => void;
}) {
  // Inline rename: when editing, the title turns into a text input.
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(displayTitle);

  const startRename = () => {
    setDraft(displayTitle);
    setRenaming(true);
  };

  const commitRename = () => {
    setRenaming(false);
    const cleaned = draft.trim();
    if (cleaned && cleaned !== displayTitle) onRename(cleaned);
  };

  const cancelRename = () => {
    setRenaming(false);
    setDraft(displayTitle);
  };

  return (
    <div
      data-id={`conv-item-${conv.conversationId}`}
      className={`group relative w-full rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors ${
        isActive
          ? "border border-xyne-border bg-xyne-surface shadow-sm"
          : "border border-transparent hover:bg-xyne-surface-subtle"
      }`}
    >
      <button
        type="button"
        onClick={() => { if (!renaming) onSelect(); }}
        className="block w-full text-left"
      >
        <div className="flex items-center gap-1.5">
          {pinned && (
            <PushPinIcon
              size={11}
              weight="fill"
              className="shrink-0 text-xyne-brand"
              aria-label="Pinned"
            />
          )}
          {renaming ? (
            <input
              autoFocus
              data-id={`conv-rename-input-${conv.conversationId}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitRename();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelRename();
                }
              }}
              className="flex-1 min-w-0 rounded-sm border border-xyne-border bg-xyne-surface px-1 py-0.5 text-[13px] font-medium text-xyne-fg-primary outline-none focus:border-xyne-brand"
            />
          ) : (
            <p className="flex-1 truncate font-medium text-xyne-fg-primary">{displayTitle}</p>
          )}
          {/* Spacer so the kebab can sit flush right without shifting the title. */}
          <span className="w-5 shrink-0" aria-hidden="true" />
        </div>
        {agent && (
          <div className="mt-0.5 flex items-center gap-1.5">
            <Avatar name={agent.name} color={agent.color} size={14} shape="circle" />
            <span className="text-[11px] text-xyne-fg-tertiary">{agent.name}</span>
          </div>
        )}
        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-xyne-fg-muted">
          <ClockIcon size={10} className="shrink-0" />
          <span className="flex-1 truncate">{fmtDateShort(conv.lastMessageAt)}</span>
          <span className="shrink-0">{conv.messageCount} msg{conv.messageCount !== 1 ? "s" : ""}</span>
        </p>
      </button>

      {/* Hover-revealed kebab. Always rendered (so the menu can open on
          keyboard focus too) but only visible on hover / when the menu is
          open / on the active row. */}
      {!renaming && (
        <div
          className={`absolute right-1.5 top-1.5 transition-opacity ${
            isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"
          }`}
        >
          {/* Custom popup: NO container card. The three bubbles float
              independently below the kebab dots, each with its own elevation.
              We bypass our themed Menu wrapper (which paints a rounded surface
              + shadow around its children) and reach for the Base UI Menu
              primitives directly so the popup itself stays transparent.
              Keyboard nav and outside-click dismiss still work — they live on
              BaseMenu.Root, not the popup chrome. */}
          <BaseMenu.Root>
            <BaseMenu.Trigger
              render={(triggerProps) => (
                <button
                  {...(triggerProps as React.ButtonHTMLAttributes<HTMLButtonElement>)}
                  type="button"
                  data-id={`conv-actions-${conv.conversationId}`}
                  aria-label="Conversation actions"
                  onClick={(e) => {
                    // Don't let the click bubble up to the row's onClick.
                    e.stopPropagation();
                    (triggerProps as { onClick?: (ev: React.MouseEvent<HTMLButtonElement>) => void }).onClick?.(e);
                  }}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-xyne-fg-tertiary transition-colors hover:bg-xyne-surface hover:text-xyne-fg-primary"
                >
                  <DotsThreeIcon size={14} weight="bold" />
                </button>
              )}
            />
            <BaseMenu.Portal>
              <BaseMenu.Positioner side="bottom" align="center" sideOffset={6}>
                <BaseMenu.Popup
                  data-id="conv-actions-popup"
                  className="flex flex-col items-center gap-1.5 origin-[var(--transform-origin)] outline-none transition-[transform,opacity] duration-150 ease-out data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0"
                >
                  {/* Each bubble is independently floating — its own surface,
                      border, and shadow — so the popup reads as three pills
                      raining down from the kebab rather than a single card. */}
                  <BaseMenu.Item
                    onClick={onTogglePin}
                    title={pinned ? "Unpin conversation" : "Pin conversation"}
                    aria-label={pinned ? "Unpin conversation" : "Pin conversation"}
                    className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border outline-none shadow-[0_4px_12px_-4px_rgba(0,0,0,0.18)] transition-[transform,colors,box-shadow] hover:scale-105 ${
                      pinned
                        ? "border-xyne-brand/20 bg-xyne-brand-ghost text-xyne-brand hover:bg-xyne-brand hover:text-xyne-fg-inverse data-[highlighted]:bg-xyne-brand data-[highlighted]:text-xyne-fg-inverse"
                        : "border-xyne-border-subtle bg-xyne-surface text-xyne-fg-secondary hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary data-[highlighted]:bg-xyne-surface-subtle data-[highlighted]:text-xyne-fg-primary"
                    }`}
                  >
                    {pinned ? <PushPinSlashIcon size={15} /> : <PushPinIcon size={15} weight="fill" />}
                  </BaseMenu.Item>
                  <BaseMenu.Item
                    onClick={startRename}
                    title="Rename"
                    aria-label="Rename"
                    className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-xyne-border-subtle bg-xyne-surface text-xyne-fg-secondary outline-none shadow-[0_4px_12px_-4px_rgba(0,0,0,0.18)] transition-[transform,colors,box-shadow] hover:scale-105 hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary data-[highlighted]:bg-xyne-surface-subtle data-[highlighted]:text-xyne-fg-primary"
                  >
                    <PencilSimpleIcon size={15} />
                  </BaseMenu.Item>
                  <BaseMenu.Item
                    onClick={onDelete}
                    title="Delete"
                    aria-label="Delete"
                    className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-red-200 bg-xyne-surface text-red-500 outline-none shadow-[0_4px_12px_-4px_rgba(220,38,38,0.25)] transition-[transform,colors,box-shadow] hover:scale-105 hover:bg-red-500 hover:text-white hover:border-red-500 data-[highlighted]:bg-red-500 data-[highlighted]:text-white data-[highlighted]:border-red-500 dark:border-red-900/40"
                  >
                    <TrashIcon size={15} weight="fill" />
                  </BaseMenu.Item>
                </BaseMenu.Popup>
              </BaseMenu.Positioner>
            </BaseMenu.Portal>
          </BaseMenu.Root>
        </div>
      )}
    </div>
  );
}

function LeftPanel({
  activeAgent,
  agents,
  conversations,
  convLoading,
  activeConvId,
  selectedProvider,
  providers,
  providerChanging,
  isPinned,
  titleFor,
  onPickAgent,
  onClearAgent,
  onProviderChange,
  onNewConversation,
  onSelectConv,
  onTogglePin,
  onRename,
  onRequestDelete,
  onBrowseAgents,
}: {
  activeAgent: Agent | null;
  agents: Agent[];
  conversations: ConversationWithAgent[];
  convLoading: boolean;
  activeConvId: string | undefined;
  selectedProvider: string;
  providers: ProviderCredential[];
  providerChanging: boolean;
  isPinned: (convId: string) => boolean;
  titleFor: (conv: ConversationWithAgent) => string;
  onPickAgent: () => void;
  /** Reset the active agent filter — sidebar reverts to the merged list of
   *  conversations across every agent. */
  onClearAgent: () => void;
  onProviderChange: (provider: string) => void;
  onNewConversation: () => void;
  onSelectConv: (conv: ConversationWithAgent) => void;
  onTogglePin: (conv: ConversationWithAgent) => void;
  onRename: (conv: ConversationWithAgent, next: string) => void;
  onRequestDelete: (conv: ConversationWithAgent) => void;
  onBrowseAgents: () => void;
}) {
  // Partition pinned to the top while keeping recency order within each group.
  const { pinned, rest } = useMemo(() => {
    const p: ConversationWithAgent[] = [];
    const r: ConversationWithAgent[] = [];
    for (const c of conversations) (isPinned(c.conversationId) ? p : r).push(c);
    return { pinned: p, rest: r };
  }, [conversations, isPinned]);

  // Section header used inside the conversations list — supports an optional
  // right-aligned slot (e.g. the inline "+" new-conversation button).
  const SectionHeader = ({
    children,
    icon,
    action,
  }: {
    children: React.ReactNode;
    icon?: React.ReactNode;
    action?: React.ReactNode;
  }) => (
    <div className="mb-3 mt-2 flex items-center justify-between">
      <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-xyne-fg-muted">
        {icon}
        {children}
      </p>
      {action}
    </div>
  );

  // Compact brand-tinted circular icon button — used as inline section action
  // ("+" for new conversation). Tinted so it reads as a primary action, not a
  // hover-only utility, while still staying small inside the section header.
  const InlineIconButton = ({
    label,
    onClick,
    children,
  }: {
    label: string;
    onClick: () => void;
    children: React.ReactNode;
  }) => (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex h-6 w-6 items-center justify-center rounded-full bg-xyne-brand-ghost text-xyne-brand ring-1 ring-inset ring-xyne-brand/20 transition-[transform,background-color,box-shadow] hover:bg-xyne-brand hover:text-xyne-fg-inverse hover:ring-xyne-brand active:scale-95"
    >
      {children}
    </button>
  );

  return (
    <div
      data-id="chat-left-panel"
      className="flex h-full w-full flex-col border-r border-xyne-border-subtle bg-xyne-surface"
    >
      {/* Agent identity + provider config — primary block.
          Two siblings in a row when an agent is selected: the main picker
          + a clear (×) button that resets the filter back to the merged
          "all agents" view. We can't nest buttons, so they live side-by-side
          and share visual rhythm via matching radius/borders. */}
      <div className="shrink-0 space-y-1.5 p-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-id="agent-picker-btn"
            onClick={onPickAgent}
            className="flex flex-1 items-center gap-2.5 rounded-xl border border-xyne-border bg-xyne-surface px-3 py-2.5 text-left transition-colors hover:border-xyne-border-strong hover:bg-xyne-surface-subtle"
          >
            {activeAgent ? (
              <>
                <Avatar name={activeAgent.name} color={activeAgent.color} size={26} shape="circle" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-xyne-fg-primary">
                    {activeAgent.name}
                  </p>
                  <p className="truncate text-[10px] uppercase tracking-wide text-xyne-fg-tertiary">
                    Tap to switch
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-xyne-surface-subtle">
                  <RobotIcon size={14} className="text-xyne-fg-muted" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-xyne-fg-primary">
                    All agents
                  </p>
                  <p className="truncate text-[10px] uppercase tracking-wide text-xyne-fg-tertiary">
                    Tap to pick one
                  </p>
                </div>
              </>
            )}
            <CaretDownIcon size={13} className="shrink-0 text-xyne-fg-tertiary" />
          </button>
          {activeAgent && (
            <button
              type="button"
              data-id="agent-clear-btn"
              onClick={onClearAgent}
              title="Show conversations from all agents"
              aria-label="Show conversations from all agents"
              // Round bubble with its own elevation — same vocabulary as the
              // composer bubbles (attach / mention) and the center-header icons.
              // Hover tints toward red because the action removes the active filter.
              className="group flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-xyne-border-subtle bg-xyne-surface text-xyne-fg-secondary shadow-[0_2px_8px_-2px_rgba(0,0,0,0.12)] transition-all hover:scale-105 hover:border-red-300 hover:bg-red-50 hover:text-red-500 hover:shadow-[0_4px_12px_-4px_rgba(220,38,38,0.25)] active:scale-95 dark:hover:border-red-900/50 dark:hover:bg-red-950/30"
            >
              <XIcon
                size={15}
                weight="bold"
                className="transition-transform group-hover:rotate-90"
              />
            </button>
          )}
        </div>

        <ProviderSelect
          value={selectedProvider}
          providers={providers}
          disabled={!activeAgent || providerChanging}
          onChange={onProviderChange}
        />
      </div>

      {/* Hairline divider — separates identity controls from conversations */}
      <div className="mx-3 my-1 h-px bg-xyne-border-subtle" aria-hidden="true" />

      {/* Conversations list */}
      <div className="flex-1 overflow-y-auto px-3 pb-2">
        {convLoading ? (
          <>
            <SectionHeader
              action={
                <InlineIconButton label="New conversation" onClick={onNewConversation}>
                  <PlusIcon size={12} weight="bold" />
                </InlineIconButton>
              }
            >
              Conversations
            </SectionHeader>
            <div className="flex flex-col gap-1.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-10 w-full animate-pulse rounded-lg bg-xyne-surface-subtle" />
              ))}
            </div>
          </>
        ) : conversations.length === 0 ? (
          <>
            <SectionHeader
              action={
                <InlineIconButton label="New conversation" onClick={onNewConversation}>
                  <PlusIcon size={12} weight="bold" />
                </InlineIconButton>
              }
            >
              Conversations
            </SectionHeader>
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <ClockIcon size={20} className="text-xyne-fg-muted" />
              <p className="text-[12px] text-xyne-fg-muted">No conversations yet</p>
              <p className="text-[11px] text-xyne-fg-tertiary">
                {activeAgent ? "Send a message to start one" : "Choose an agent to start chatting"}
              </p>
            </div>
          </>
        ) : (
          <>
            {pinned.length > 0 && (
              <>
                <SectionHeader
                  icon={<PushPinIcon size={9} weight="fill" />}
                  action={
                    <InlineIconButton label="New conversation" onClick={onNewConversation}>
                      <PlusIcon size={12} weight="bold" />
                    </InlineIconButton>
                  }
                >
                  Pinned
                </SectionHeader>
                <div className="mb-2 flex flex-col gap-1">
                  {pinned.map((conv) => {
                    const agent = agents.find((a) => a.slug === conv.agentSlug);
                    return (
                      <ConvItem
                        key={`${conv.agentSlug}-${conv.conversationId}`}
                        conv={conv}
                        agent={agent}
                        isActive={activeConvId === conv.conversationId}
                        pinned
                        displayTitle={titleFor(conv)}
                        onSelect={() => onSelectConv(conv)}
                        onTogglePin={() => onTogglePin(conv)}
                        onRename={(next) => onRename(conv, next)}
                        onDelete={() => onRequestDelete(conv)}
                      />
                    );
                  })}
                </div>
              </>
            )}
            <SectionHeader
              // Only show the "+" inline action on the *primary* header so we
              // don't double up when the Pinned section is also present.
              action={
                pinned.length === 0 ? (
                  <InlineIconButton label="New conversation" onClick={onNewConversation}>
                    <PlusIcon size={12} weight="bold" />
                  </InlineIconButton>
                ) : undefined
              }
            >
              {pinned.length > 0 ? "All" : "Conversations"}
            </SectionHeader>
            <div className="flex flex-col gap-1">
              {rest.map((conv) => {
                const agent = agents.find((a) => a.slug === conv.agentSlug);
                return (
                  <ConvItem
                    key={`${conv.agentSlug}-${conv.conversationId}`}
                    conv={conv}
                    agent={agent}
                    isActive={activeConvId === conv.conversationId}
                    pinned={false}
                    displayTitle={titleFor(conv)}
                    onSelect={() => onSelectConv(conv)}
                    onTogglePin={() => onTogglePin(conv)}
                    onRename={(next) => onRename(conv, next)}
                    onDelete={() => onRequestDelete(conv)}
                  />
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Footer — Browse-all-agents CTA card.
          More than a hyperlink: branded icon chip + title + "{N} specialists"
          subtitle + sliding arrow on hover, so it reads as a destination the
          user explicitly opts into rather than passive footer chrome. */}
      <div className="shrink-0 border-t border-xyne-border-subtle p-3">
        <button
          type="button"
          data-id="browse-all-agents-btn"
          onClick={onBrowseAgents}
          className="group flex w-full items-center gap-2.5 rounded-xl border border-xyne-border-subtle bg-xyne-surface-subtle px-3 py-2.5 text-left transition-all hover:border-xyne-border hover:bg-xyne-surface hover:shadow-[0_2px_10px_-4px_rgba(0,0,0,0.10)]"
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-xyne-brand-ghost text-xyne-brand ring-1 ring-inset ring-xyne-brand/15">
            <AppWindowIcon size={14} weight="duotone" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-semibold text-xyne-fg-primary">
              Browse all agents
            </p>
            <p className="truncate text-[10px] text-xyne-fg-tertiary">
              {agents.length} specialist{agents.length !== 1 ? "s" : ""} available
            </p>
          </div>
          <ArrowRightIcon
            size={12}
            weight="bold"
            className="shrink-0 text-xyne-fg-tertiary transition-[transform,color] group-hover:translate-x-0.5 group-hover:text-xyne-brand"
          />
        </button>
      </div>
    </div>
  );
}

/* ── center header ───────────────────────────────────────────────── */

/** Format token counts compactly: 1234 → "1.2k", 1_234_567 → "1.2M". */
function fmtTokens(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
}

interface ConversationTokens {
  in: number;
  out: number;
  cacheRead: number;
  cacheWrite: number;
  runCount: number;
}

function CenterHeader({
  agent,
  convTitle,
  conversationId,
  userId,
  messageCount,
  onOpenSettings,
  onOpenDashboard,
}: {
  agent: Agent;
  convTitle?: string;
  /** Active conversation id — used to fetch per-conversation token totals. */
  conversationId: string | undefined;
  userId: string;
  messageCount: number;
  onOpenSettings: () => void;
  onOpenDashboard: () => void;
}) {
  const [agentInfoOpen, setAgentInfoOpen] = useState(false);
  const [tokens, setTokens] = useState<ConversationTokens | null>(null);
  const [tokensLoading, setTokensLoading] = useState(false);

  const allTools = agent.tools ?? [];

  // Fetch token totals lazily — only when the info dialog opens. Cheap enough
  // to re-fetch on every open (catches new runs since last view) and we don't
  // pay the cost for users who never open the dialog.
  useEffect(() => {
    if (!agentInfoOpen || !conversationId || !userId) return;
    let cancelled = false;
    setTokensLoading(true);
    listRuns(userId, { conversationId, agentSlug: agent.slug, limit: 200 })
      .then((runs) => {
        if (cancelled) return;
        const totals = runs.reduce<ConversationTokens>(
          (acc, r) => ({
            in: acc.in + (r.tokensIn ?? 0),
            out: acc.out + (r.tokensOut ?? 0),
            cacheRead: acc.cacheRead + (r.tokensCacheRead ?? 0),
            cacheWrite: acc.cacheWrite + (r.tokensCacheWrite ?? 0),
            runCount: acc.runCount + 1,
          }),
          { in: 0, out: 0, cacheRead: 0, cacheWrite: 0, runCount: 0 },
        );
        setTokens(totals);
      })
      .catch(() => {
        if (!cancelled) setTokens(null);
      })
      .finally(() => {
        if (!cancelled) setTokensLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentInfoOpen, conversationId, userId, agent.slug]);

  const totalTokens = tokens ? tokens.in + tokens.out : 0;

  return (
    <>
      <div
        data-id="chat-center-header"
        className="flex shrink-0 items-center gap-3 border-b border-xyne-border-subtle bg-xyne-surface px-4 py-3"
      >
        <Avatar name={agent.name} color={agent.color} size={36} shape="circle" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-xyne-fg-primary">{agent.name}</p>
          {/* Subtitle shows the agent's description so non-tech users know who
              they're talking to. Falls back to conversation context if no
              description is set. */}
          <p className="truncate text-[12px] text-xyne-fg-muted">
            {agent.description
              ? agent.description
              : (
                <>
                  {convTitle || "New conversation"}
                  {messageCount > 0 && (
                    <span className="ml-1.5">
                      · {messageCount} message{messageCount !== 1 ? "s" : ""}
                    </span>
                  )}
                </>
              )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            data-id="center-info-btn"
            onClick={() => setAgentInfoOpen(true)}
            title="About this agent"
            aria-label="About this agent"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-xyne-border-subtle bg-xyne-surface text-xyne-fg-secondary shadow-sm transition-all hover:border-xyne-border hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary active:scale-95"
          >
            <InfoIcon size={18} />
          </button>
          {/* Export current session — same dropdown the Control Center
              row actions use. Hidden until a conversation exists so the
              "new chat" empty state stays uncluttered. */}
          <SessionExportMenu
            conversationId={conversationId}
            agentSlug={agent.slug}
            triggerClassName="flex h-9 w-9 items-center justify-center rounded-full border border-xyne-border-subtle bg-xyne-surface text-xyne-fg-secondary shadow-sm transition-all hover:border-xyne-border hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary active:scale-95"
            iconSize={18}
          />
          <button
            type="button"
            data-id="center-dashboard-btn"
            onClick={onOpenDashboard}
            title="Open dashboard"
            aria-label="Open dashboard"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-xyne-border-subtle bg-xyne-surface text-xyne-fg-secondary shadow-sm transition-all hover:border-xyne-border hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary active:scale-95"
          >
            <ChartBarIcon size={18} />
          </button>
          <button
            type="button"
            data-id="center-settings-btn"
            onClick={onOpenSettings}
            title="Configure agent"
            aria-label="Configure agent"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-xyne-border-subtle bg-xyne-surface text-xyne-fg-secondary shadow-sm transition-all hover:border-xyne-border hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary active:scale-95"
          >
            <GearSixIcon size={18} />
          </button>
        </div>
      </div>

      {/* Agent info dialog — description, conversation stats, badges, tools */}
      <Dialog
        open={agentInfoOpen}
        onOpenChange={setAgentInfoOpen}
        title={agent.name}
        maxWidth={460}
      >
        <div className="flex flex-col gap-5">
          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-xyne-fg-muted">
              About
            </p>
            {agent.description ? (
              <p className="text-[14px] leading-relaxed text-xyne-fg-secondary">
                {agent.description}
              </p>
            ) : (
              <p className="text-[14px] italic text-xyne-fg-muted">No description set yet.</p>
            )}
          </div>

          {/* Tokens — per-conversation totals from AgentRun rows */}
          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-xyne-fg-muted">
              Tokens used (this conversation)
            </p>
            {tokensLoading ? (
              <div className="h-12 w-full animate-pulse rounded-lg bg-xyne-surface-subtle" />
            ) : !conversationId ? (
              <p className="text-[12px] italic text-xyne-fg-muted">
                Send a message to start tracking usage.
              </p>
            ) : tokens && tokens.runCount > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-baseline gap-1 rounded-lg border border-xyne-border-subtle bg-xyne-surface-subtle px-2.5 py-1.5">
                  <span className="text-[16px] font-semibold tabular-nums text-xyne-fg-primary">
                    {fmtTokens(totalTokens)}
                  </span>
                  <span className="text-[11px] text-xyne-fg-muted">total</span>
                </div>
                <div className="flex items-baseline gap-1 rounded-lg border border-xyne-border-subtle bg-xyne-surface-subtle px-2.5 py-1.5">
                  <span className="text-[13px] font-medium tabular-nums text-xyne-fg-secondary">
                    {fmtTokens(tokens.in)}
                  </span>
                  <span className="text-[11px] text-xyne-fg-muted">in</span>
                </div>
                <div className="flex items-baseline gap-1 rounded-lg border border-xyne-border-subtle bg-xyne-surface-subtle px-2.5 py-1.5">
                  <span className="text-[13px] font-medium tabular-nums text-xyne-fg-secondary">
                    {fmtTokens(tokens.out)}
                  </span>
                  <span className="text-[11px] text-xyne-fg-muted">out</span>
                </div>
                {(tokens.cacheRead > 0 || tokens.cacheWrite > 0) && (
                  <div className="flex items-baseline gap-1 rounded-lg border border-xyne-border-subtle bg-xyne-surface-subtle px-2.5 py-1.5">
                    <span className="text-[13px] font-medium tabular-nums text-xyne-fg-secondary">
                      {fmtTokens(tokens.cacheRead + tokens.cacheWrite)}
                    </span>
                    <span className="text-[11px] text-xyne-fg-muted">cache</span>
                  </div>
                )}
                <span className="text-[11px] text-xyne-fg-tertiary">
                  · {tokens.runCount} run{tokens.runCount !== 1 ? "s" : ""}
                </span>
              </div>
            ) : (
              <p className="text-[12px] italic text-xyne-fg-muted">No token usage recorded yet.</p>
            )}
          </div>

          {/* Badges */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge as="span" label={agent.scope} variant={agent.scope === "global" ? "info" : "neutral"} size="sm" />
            {agent.spacesAppId != null && (
              <Badge as="span" label="Spaces App" variant="success" size="sm" />
            )}
          </div>

          {/* Tools */}
          {allTools.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-[11px] font-medium uppercase tracking-wide text-xyne-fg-muted">
                Tools ({allTools.length})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {allTools.map((t) => (
                  <Badge key={t.tool.name} as="span" label={t.tool.name} variant="neutral" size="sm" />
                ))}
              </div>
            </div>
          )}
        </div>
      </Dialog>
    </>
  );
}

/* ── input area ──────────────────────────────────────────────────── */

export interface InputAreaHandle {
  focus: () => void;
}

/** Local pending file (not yet uploaded). Lives on the parent until send. */
export interface PendingFile {
  file: File;
  previewUrl: string;
}

interface InputAreaProps {
  agentName: string;
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  sending: boolean;
  disabled: boolean;
  /** Most recent user-authored message in the active conversation — recalled
   *  into the input when the user presses ↑ on an empty textarea (shell-style). */
  lastUserMessage?: string;
  /** Files queued for upload — rendered as preview chips above the textarea. */
  pendingFiles: PendingFile[];
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (index: number) => void;
  /** Context items the user @-mentioned — rendered as chips. */
  selectedContext: ContextItem[];
  onRemoveContext: (item: Pick<ContextItem, "type" | "id">) => void;
  /** Open / close the ContextPicker popover (parent owns positioning). */
  mentionOpen: boolean;
  onToggleMention: () => void;
  /** The ContextPicker JSX is rendered by the parent (it needs auth/userId);
   *  we slot it in as a render prop so positioning relative to the input
   *  card lives here. */
  renderMentionPicker?: () => React.ReactNode;
}

/**
 * Floating, two-row composer:
 *   • Row 1: auto-growing textarea (no chrome — the outer card supplies the border)
 *   • Row 2: bubble buttons — attach + mention on the left, send/stop on the right
 *
 * Keyboard:
 *   • Enter            — send (Shift+Enter inserts newline)
 *   • Cmd/Ctrl+Enter   — alternative send
 *   • ↑ on empty input — recall last user message
 *   • Esc              — clear the current input
 */
const InputArea = forwardRef<InputAreaHandle, InputAreaProps>(function InputArea(
  {
    agentName,
    value,
    onChange,
    onSend,
    onStop,
    sending,
    disabled,
    lastUserMessage,
    pendingFiles,
    onAddFiles,
    onRemoveFile,
    selectedContext,
    onRemoveContext,
    mentionOpen,
    onToggleMention,
    renderMentionPicker,
  },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
  }));

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd/Ctrl+Enter — send regardless of Shift state
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (!sending) onSend();
      return;
    }
    // Plain Enter — send. Shift+Enter falls through to newline.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (sending) onStop();
      else onSend();
      return;
    }
    // ↑ on empty input — recall the user's last message (shell convention).
    if (e.key === "ArrowUp" && !value && lastUserMessage) {
      e.preventDefault();
      onChange(lastUserMessage);
      return;
    }
    // Esc — quick clear
    if (e.key === "Escape" && value) {
      e.preventDefault();
      onChange("");
    }
  };

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list) return;
    onAddFiles(Array.from(list));
    // Reset so the same file can be picked twice in a row.
    e.target.value = "";
  };

  const hasChips = pendingFiles.length > 0 || selectedContext.length > 0;
  const sendDisabled = !value.trim() && !hasChips ? true : disabled;

  return (
    <div data-id="chat-input-area" className="shrink-0 px-4 pb-5">
      <div className="relative mx-auto w-full max-w-3xl">
        {/* ContextPicker popover slot — parent renders the actual picker JSX
            here when mentionOpen is true. Positioned absolutely above the card. */}
        {mentionOpen && renderMentionPicker && (
          <div className="absolute bottom-full left-0 z-30 mb-2 w-full max-w-md">
            {renderMentionPicker()}
          </div>
        )}

        <div
          className={`rounded-3xl border border-xyne-border-subtle bg-xyne-surface px-4 pb-2.5 pt-3 shadow-[0_8px_28px_-12px_rgba(0,0,0,0.18)] transition-shadow focus-within:border-xyne-border focus-within:shadow-[0_10px_32px_-12px_rgba(0,0,0,0.22)]`}
        >
          {/* Chip rail — context @-mentions + pending file previews, above the textarea */}
          {hasChips && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {selectedContext.map((item) => (
                <span
                  key={`${item.type}:${item.id}`}
                  data-id={`context-chip-${item.type}-${item.id}`}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-xyne-border-subtle bg-xyne-surface-subtle px-2.5 py-0.5 text-[11px] text-xyne-fg-secondary"
                  title={`${item.type} · ${item.title}`}
                >
                  <AtIcon size={10} className="shrink-0 text-xyne-fg-tertiary" />
                  <span className="truncate">{item.title}</span>
                  <button
                    type="button"
                    onClick={() => onRemoveContext(item)}
                    aria-label={`Remove ${item.title}`}
                    className="ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-xyne-fg-tertiary transition-colors hover:bg-xyne-surface hover:text-xyne-fg-primary"
                  >
                    <XIcon size={9} weight="bold" />
                  </button>
                </span>
              ))}
              {pendingFiles.map((p, idx) => (
                <span
                  key={`${idx}-${p.file.name}`}
                  data-id={`file-chip-${idx}`}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-xyne-border-subtle bg-xyne-surface-subtle py-0.5 pl-0.5 pr-2.5 text-[11px] text-xyne-fg-secondary"
                  title={p.file.name}
                >
                  <img
                    src={p.previewUrl}
                    alt=""
                    className="h-4 w-4 shrink-0 rounded-full object-cover"
                  />
                  <span className="truncate">{p.file.name}</span>
                  <button
                    type="button"
                    onClick={() => onRemoveFile(idx)}
                    aria-label={`Remove ${p.file.name}`}
                    className="ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-xyne-fg-tertiary transition-colors hover:bg-xyne-surface hover:text-xyne-fg-primary"
                  >
                    <XIcon size={9} weight="bold" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Row 1 — auto-growing textarea, no chrome */}
          <textarea
            ref={textareaRef}
            data-id="chat-input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              sending
                ? "Agent is responding — press Stop or wait…"
                : `Message ${agentName}…`
            }
            rows={1}
            className="block max-h-[160px] min-h-[28px] w-full resize-none bg-transparent text-[14px] leading-relaxed text-xyne-fg-primary placeholder:text-xyne-fg-placeholder outline-none focus:outline-none focus-visible:outline-none disabled:opacity-60"
            style={{ outline: "none", boxShadow: "none" }}
          />

          {/* Row 2 — bubble actions */}
          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              {/* Hidden file input — opened by the attach bubble */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFilePick}
                className="hidden"
              />
              <button
                type="button"
                data-id="input-btn-attach"
                title="Attach images"
                aria-label="Attach images"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-xyne-surface-subtle text-xyne-fg-tertiary transition-colors hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
              >
                <PaperclipIcon size={14} />
              </button>
              <button
                type="button"
                data-id="input-btn-mention"
                title="Mention context"
                aria-label="Mention context"
                onClick={onToggleMention}
                aria-pressed={mentionOpen}
                className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                  mentionOpen
                    ? "bg-xyne-brand text-xyne-fg-inverse"
                    : "bg-xyne-surface-subtle text-xyne-fg-tertiary hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
                }`}
              >
                <AtIcon size={14} />
              </button>
            </div>

            {sending ? (
              <button
                type="button"
                data-id="chat-stop-btn"
                onClick={onStop}
                title="Stop generating"
                aria-label="Stop generating"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-xyne-fg-primary text-xyne-fg-inverse shadow-sm transition-opacity hover:opacity-90"
              >
                <StopIcon size={14} weight="fill" />
              </button>
            ) : (
              <button
                type="button"
                data-id="chat-send-btn"
                onClick={onSend}
                disabled={sendDisabled}
                title="Send message  (Enter)"
                aria-label="Send message"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-xyne-brand text-xyne-fg-inverse shadow-sm transition-[opacity,transform] hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
              >
                <PaperPlaneTiltIcon size={14} weight="fill" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});


/* ── empty state — Studio hero + agent cards + sample prompts ─────── */

/**
 * Derive 3 sample prompts for an agent from its tool list.
 *
 * Pattern-matches common tool names (search/find, summarize, ticket, channel,
 * calendar, pull-request) and falls back to generic-but-warm prompts so every
 * card gets three chips. The goal is teaching what the agent CAN DO — not
 * accuracy. Chips are conversation starters, not curated recipes.
 *
 * TODO(agent-recipes): once the schema gains an `agent.starterPrompts` field,
 * prefer those over the heuristic — author-defined beats inferred every time.
 */
function deriveSamplePrompts(agent: Agent): string[] {
  const tools = agent.tools ?? [];
  const prompts = new Set<string>();

  for (const t of tools) {
    if (prompts.size >= 3) break;
    const name = t.tool.name.toLowerCase();
    if (name.includes("ticket")) {
      if (name.includes("create")) prompts.add("Create a ticket for me");
      else prompts.add("Show me my recent tickets");
    }
    if (name.includes("search") || name.includes("find") || name.includes("lookup")) {
      prompts.add("Find something in my workspace");
    }
    if (name.includes("summar")) prompts.add("Summarize the latest activity");
    if (name.includes("channel") || name.includes("message")) {
      prompts.add("What's happening in my channels?");
    }
    if (name.includes("calendar") || name.includes("event") || name.includes("meeting")) {
      prompts.add("What's on my calendar this week?");
    }
    if (name.includes("pr") || name.includes("pull") || name.includes("review")) {
      prompts.add("Show me open PRs that need review");
    }
    if (name.includes("doc") || name.includes("canvas") || name.includes("page")) {
      prompts.add("Draft a doc for me");
    }
    if (name.includes("email") || name.includes("mail")) {
      prompts.add("What's important in my inbox?");
    }
  }

  // Pad with friendly, agent-agnostic openers so every card always has 3 chips.
  const fallbacks = [
    "What can you do?",
    "Show me a quick demo",
    "Help me get started",
  ];
  for (const f of fallbacks) {
    if (prompts.size >= 3) break;
    prompts.add(f);
  }
  return Array.from(prompts).slice(0, 3);
}

/**
 * Spotlight carousel for the Studio empty state.
 *
 * Auto-advances every ~5s through the agents, pauses on hover/focus. Manual
 * prev/next arrows and clickable pagination dots. One agent visible at a time
 * with a bigger card layout so the description, sample prompts, and primary
 * CTA all read clearly.
 *
 * Transitions: we translate the inner track horizontally with CSS so the
 * whole list slides together — no per-slide mount/unmount, no flicker.
 */
function StudioCarousel({
  agents,
  onSelectAgent,
  onTrySample,
}: {
  agents: Agent[];
  onSelectAgent: (slug: string) => void;
  onTrySample: (slug: string, prompt: string) => void;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const total = agents.length;
  // Ref to the dot strip — we programmatically scroll it so the active dot
  // stays centered inside its fixed-width window when N is large.
  const dotsStripRef = useRef<HTMLDivElement>(null);

  // Center the active dot in the strip whenever the slide changes. The strip
  // is overflow-hidden; we use scrollTo(left, ...) so dots that fall off
  // either side dissolve into the mask gradient instead of clipping abruptly.
  useEffect(() => {
    const strip = dotsStripRef.current;
    if (!strip) return;
    const active = strip.children[index] as HTMLElement | undefined;
    if (!active) return;
    const targetLeft = active.offsetLeft - (strip.clientWidth - active.clientWidth) / 2;
    strip.scrollTo({ left: targetLeft, behavior: "smooth" });
  }, [index, total]);

  // Auto-advance — pauses while the user is interacting so they can read.
  useEffect(() => {
    if (paused || total <= 1) return;
    const tick = window.setInterval(() => {
      setIndex((i) => (i + 1) % total);
    }, 5500);
    return () => window.clearInterval(tick);
  }, [paused, total]);

  // If the agent list changes (new one added), keep the current index in range.
  useEffect(() => {
    if (index >= total && total > 0) setIndex(0);
  }, [index, total]);

  if (total === 0) return null;

  const goTo = (i: number) => setIndex(((i % total) + total) % total);
  const next = () => goTo(index + 1);
  const prev = () => goTo(index - 1);

  return (
    <div
      data-id="studio-carousel"
      className="w-full max-w-[640px]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      // Keyboard support: ← / → navigate slides when the carousel has focus
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          next();
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          prev();
        }
      }}
      tabIndex={0}
      aria-roledescription="carousel"
      aria-label="Featured agents"
    >
      <div className="relative">
        {/* Slide viewport — clips the translating track */}
        <div className="overflow-hidden rounded-2xl">
          <div
            className="flex transition-transform duration-[600ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{ transform: `translateX(-${index * 100}%)` }}
          >
            {agents.map((agent, i) => {
              const prompts = deriveSamplePrompts(agent);
              const isActive = i === index;
              return (
                <div
                  key={agent.slug}
                  className="w-full shrink-0 px-1"
                  role="group"
                  aria-roledescription="slide"
                  aria-label={`${i + 1} of ${total}: ${agent.name}`}
                  aria-hidden={!isActive}
                >
                  <div className="flex flex-col gap-5 rounded-2xl border border-xyne-border-subtle bg-xyne-surface p-6 shadow-[0_8px_28px_-16px_rgba(0,0,0,0.18)]">
                    {/* Identity row */}
                    <div className="flex items-start gap-4">
                      <Avatar
                        name={agent.name}
                        color={agent.color}
                        size={52}
                        shape="circle"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[16px] font-semibold tracking-[-0.2px] text-xyne-fg-primary">
                          {agent.name}
                        </p>
                        <p className="mt-1 line-clamp-3 text-[13px] leading-relaxed text-xyne-fg-secondary">
                          {agent.description || "Ready when you are."}
                        </p>
                      </div>
                    </div>

                    {/* Sample prompts */}
                    <div className="flex flex-col gap-1.5">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-xyne-fg-tertiary">
                        Try asking
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {prompts.map((p, pi) => (
                          <button
                            key={pi}
                            type="button"
                            // Only the active slide should be tab-able / clickable —
                            // hidden slides receive aria-hidden but we also guard
                            // tabIndex so screen readers skip them.
                            tabIndex={isActive ? 0 : -1}
                            onClick={() => onTrySample(agent.slug, p)}
                            className="rounded-full border border-xyne-border-subtle bg-xyne-surface-subtle px-3 py-1.5 text-[12px] text-xyne-fg-secondary transition-colors hover:border-xyne-brand hover:bg-xyne-brand-ghost hover:text-xyne-brand"
                          >
                            {p}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Primary CTA */}
                    <div className="flex items-center justify-between gap-3 pt-1">
                      <span className="text-[11px] text-xyne-fg-tertiary">
                        Auto-advancing
                      </span>
                      <button
                        type="button"
                        tabIndex={isActive ? 0 : -1}
                        onClick={() => onSelectAgent(agent.slug)}
                        className="group inline-flex items-center gap-1.5 rounded-full bg-xyne-brand px-4 py-2 text-[13px] font-medium text-xyne-fg-inverse shadow-sm transition-[opacity,transform] hover:opacity-90 active:scale-95"
                      >
                        Start with {agent.name.split(" ")[0]}
                        <ArrowRightIcon
                          size={12}
                          weight="bold"
                          className="transition-transform group-hover:translate-x-0.5"
                        />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Prev / next arrows — sit just outside the card on wider viewports.
            Hidden when there's only one agent. */}
        {total > 1 && (
          <>
            <button
              type="button"
              data-id="carousel-prev"
              onClick={prev}
              aria-label="Previous agent"
              className="absolute left-[-44px] top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-xyne-border-subtle bg-xyne-surface text-xyne-fg-secondary shadow-sm transition-all hover:border-xyne-border hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary active:scale-95 sm:flex"
            >
              <CaretLeftIcon size={16} weight="bold" />
            </button>
            <button
              type="button"
              data-id="carousel-next"
              onClick={next}
              aria-label="Next agent"
              className="absolute right-[-44px] top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-xyne-border-subtle bg-xyne-surface text-xyne-fg-secondary shadow-sm transition-all hover:border-xyne-border hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary active:scale-95 sm:flex"
            >
              <CaretRightIcon size={16} weight="bold" />
            </button>
          </>
        )}
      </div>

      {/* Pagination — sliding-window dot strip + counter.
          The strip is a fixed-width overflow-hidden container with an edge
          fade mask, and the active dot is auto-centered inside it. Scales
          gracefully from 2 agents to 50+: footprint stays constant. */}
      {total > 1 && (
        <div className="mt-5 flex items-center justify-center gap-3">
          <div
            className="relative max-w-[148px] overflow-hidden"
            // Mask gradient dissolves dots at the edges of the window so they
            // hint at "more in either direction" rather than being clipped.
            style={{
              maskImage:
                "linear-gradient(to right, transparent 0%, black 18%, black 82%, transparent 100%)",
              WebkitMaskImage:
                "linear-gradient(to right, transparent 0%, black 18%, black 82%, transparent 100%)",
            }}
          >
            <div
              ref={dotsStripRef}
              // Hide the native scrollbar across engines while still allowing
              // programmatic scrollLeft via the effect above.
              className="flex items-center gap-1.5 overflow-x-auto px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {agents.map((agent, i) => (
                <button
                  key={agent.slug}
                  type="button"
                  data-id={`carousel-dot-${i}`}
                  onClick={() => goTo(i)}
                  aria-label={`Go to slide ${i + 1}: ${agent.name}`}
                  aria-current={i === index}
                  className={`h-1.5 shrink-0 rounded-full transition-all ${
                    i === index
                      ? "w-6 bg-xyne-brand"
                      : "w-1.5 bg-xyne-border-strong hover:bg-xyne-fg-tertiary"
                  }`}
                />
              ))}
            </div>
          </div>
          {/* Numeric position — always visible regardless of how many agents,
              so users still know where they are when dots fade off-window. */}
          <span className="font-mono text-[11px] tabular-nums text-xyne-fg-tertiary">
            {index + 1} / {total}
          </span>
        </div>
      )}
    </div>
  );
}

function EmptyState({
  agents,
  loading,
  onSelectAgent,
  onTrySample,
}: {
  agents: Agent[];
  loading: boolean;
  onSelectAgent: (slug: string) => void;
  onTrySample: (slug: string, prompt: string) => void;
}) {
  return (
    <div
      data-id="chat-empty-state"
      className="flex flex-1 flex-col items-center overflow-y-auto bg-xyne-surface-subtle px-6 py-12"
    >
      {/* Hero — names the surface and tells a non-tech user the value prop.
          The hero fades in first, then the cards cascade below (see styles
          in index.css: .studio-hero-fade / .studio-card-stagger). */}
      <div
        data-id="studio-hero"
        className="studio-hero-fade mb-10 flex flex-col items-center"
      >
        <div
          className="studio-hero-fade mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-xyne-brand-ghost text-xyne-brand"
          style={{ animationDelay: "60ms" }}
        >
          <SparkleIcon size={26} weight="duotone" />
        </div>
        <h1
          className="studio-hero-fade text-[26px] font-semibold tracking-[-0.4px] text-xyne-fg-primary"
          style={{ animationDelay: "120ms" }}
        >
          Studio
        </h1>
        <p
          className="studio-hero-fade mt-1.5 max-w-md text-center text-[13px] leading-relaxed text-xyne-fg-muted"
          style={{ animationDelay: "180ms" }}
        >
          Your roster of AI specialists. Pick one, give them a task, and they'll get it done — using
          tools, your workspace data, and the apps you've connected.
        </p>
      </div>

      {loading ? (
        <div className="w-full max-w-[640px]">
          <div className="h-[260px] animate-pulse rounded-2xl bg-xyne-surface-subtle" />
          <div className="mt-5 flex justify-center gap-1.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-1.5 w-1.5 rounded-full bg-xyne-border-strong" />
            ))}
          </div>
        </div>
      ) : agents.length === 0 ? (
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-[13px] text-xyne-fg-muted">No agents yet.</p>
          <p className="text-[12px] text-xyne-fg-tertiary">
            Build your first agent from the Agents page in the sidebar.
          </p>
        </div>
      ) : (
        // Carousel cascades in after the hero settles.
        <div className="studio-card-stagger" style={{ animationDelay: "240ms" }}>
          <StudioCarousel
            agents={agents}
            onSelectAgent={onSelectAgent}
            onTrySample={onTrySample}
          />
        </div>
      )}
    </div>
  );
}

/* ── agent picker modal ──────────────────────────────────────────── */

function AgentPickerModal({
  agents,
  loading,
  onSelect,
  onClose,
}: {
  agents: Agent[];
  loading: boolean;
  onSelect: (slug: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const filtered = agents.filter((a) => a.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div
      data-id="modal-backdrop"
      // Deeper scrim + blur so the centered modal reads as anchored, not
      // floating over content. Matches the V3 Dialog primitive's backdrop.
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        data-id="agent-picker-modal"
        className="flex w-full max-w-[440px] flex-col rounded-2xl border border-xyne-border-subtle bg-xyne-surface shadow-xl"
        style={{ maxHeight: "70vh" }}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-xyne-border-subtle px-5 py-4">
          <div>
            <h3 className="text-[15px] font-semibold text-xyne-fg-primary">Switch agent</h3>
            <p className="text-[12px] text-xyne-fg-muted">Select an agent to chat with</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-xyne-fg-tertiary transition-colors hover:bg-xyne-surface-subtle"
          >
            <XIcon size={15} />
          </button>
        </div>

        <div className="shrink-0 border-b border-xyne-border-subtle px-3 py-2">
          <div className="flex items-center gap-2 rounded-lg border border-xyne-border-subtle bg-xyne-surface-subtle px-3 py-1.5">
            <MagnifyingGlassIcon size={13} className="text-xyne-fg-tertiary" />
            <input
              data-id="agents-search-input"
              type="text"
              placeholder="Search agents…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
              className="flex-1 bg-transparent text-[13px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex flex-col gap-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-xyne-surface-subtle" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-4 text-center text-[13px] text-xyne-fg-muted">No agents found</p>
          ) : (
            filtered.map((agent) => (
              <button
                key={agent.slug}
                data-id={`modal-agent-${agent.slug}`}
                className="flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors hover:bg-xyne-surface-subtle"
                onClick={() => { onSelect(agent.slug); onClose(); }}
              >
                <Avatar name={agent.name} color={agent.color} size={36} shape="circle" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-xyne-fg-primary">{agent.name}</p>
                  <p className="truncate text-[11px] text-xyne-fg-muted">{agent.description}</p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/* ── main component ──────────────────────────────────────────────── */

export function ChatPageV3() {
  const navigate = useNavigate();
  const auth = useAuth();
  const userId = auth.status === "authenticated" ? auth.user.id : "";
  const userAbbr = auth.status === "authenticated"
    ? initials(auth.user.name || auth.user.email)
    : "?";

  const { agents, providerMap, loading: agentsLoading } = useAgents(userId);
  const {
    messages,
    conversationId,
    sending,
    toolLabel,
    invocations: liveInvocations,
    reasoning: liveReasoning,
    invocationsByMsgId,
    reasoningByMsgId,
    streamingMsgId,
    activeAgentSlug: ctxAgentSlug,
    setActiveAgentSlug: setCtxAgentSlug,
    send,
    stop,
    clear,
    loadConversation,
    onConversationCreated,
  } = useChat();

  const [searchParams] = useSearchParams();
  // URL ?agent= takes precedence on mount, but global context survives navigation
  // and lets the in-flight chat resume when the user comes back to /v3/chat.
  const urlAgent = searchParams.get("agent");
  // ?conversation=<id> — deep-link from Home / Dashboard's session rows.
  // We don't keep this in state; once we've auto-loaded the conv once we
  // mark it consumed so URL changes from in-page nav don't re-trigger.
  const urlConversation = searchParams.get("conversation");
  const consumedDeepLinkRef = useRef<string | null>(null);
  const activeAgentSlug = urlAgent ?? ctxAgentSlug;
  const setActiveAgentSlug = useCallback(
    (slug: string | null) => setCtxAgentSlug(slug),
    [setCtxAgentSlug],
  );

  // On mount, sync ?agent= from the URL into the context once.
  useEffect(() => {
    if (urlAgent && urlAgent !== ctxAgentSlug) setCtxAgentSlug(urlAgent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlAgent]);
  const [conversations, setConversations]     = useState<ConversationWithAgent[]>([]);
  const [convLoading, setConvLoading]         = useState(false);
  const [inputValue, setInputValue]           = useState("");
  const [showModal, setShowModal]             = useState(false);
  const [providers, setProviders]             = useState<ProviderCredential[]>([]);
  const [selectedProvider, setSelectedProvider] = useState("spaces");
  const [providerChanging, setProviderChanging] = useState(false);
  const [leftPanelWidth, setLeftPanelWidth]   = useState<number>(() => {
    try {
      const saved = localStorage.getItem("chat-left-panel-width");
      return saved ? parseInt(saved, 10) : 220;
    } catch {
      return 220;
    }
  });
  // Pending delete target — opens ConfirmDialog. Cleared on confirm/cancel.
  const [pendingDelete, setPendingDelete] = useState<ConversationWithAgent | null>(null);

  // Ref into the InputArea so we can focus the textarea on conv switch / mount.
  const inputAreaRef = useRef<InputAreaHandle>(null);

  // Composer attachments — images queued for upload, kept on the parent so
  // they survive composer re-renders. previewUrl is an object URL that we
  // revoke on removal / after upload completes.
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);

  const handleAddFiles = useCallback((files: File[]) => {
    const additions: PendingFile[] = [];
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      if (file.size > 25 * 1024 * 1024) continue; // 25MB cap, matches V1
      additions.push({ file, previewUrl: URL.createObjectURL(file) });
    }
    if (additions.length > 0) setPendingFiles((prev) => [...prev, ...additions]);
  }, []);

  const handleRemoveFile = useCallback((idx: number) => {
    setPendingFiles((prev) => {
      const removed = prev[idx];
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  // Composer @-mentions — ContextPicker open state + selected items.
  const [mentionOpen, setMentionOpen] = useState(false);
  const [contextQuery, setContextQuery] = useState("");
  const [contextTab, setContextTab] = useState<ContextSearchType>("all");
  const [selectedContext, setSelectedContext] = useState<ContextItem[]>([]);

  const handleToggleMention = useCallback(() => setMentionOpen((v) => !v), []);
  const handleAddContext = useCallback((item: ContextItem) => {
    setSelectedContext((prev) =>
      prev.some((c) => c.type === item.type && c.id === item.id) ? prev : [...prev, item],
    );
  }, []);
  const handleRemoveContext = useCallback((item: Pick<ContextItem, "type" | "id">) => {
    setSelectedContext((prev) =>
      prev.filter((c) => !(c.type === item.type && c.id === item.id)),
    );
  }, []);
  const selectedContextKeys = useMemo(
    () => new Set(selectedContext.map((c) => `${c.type}:${c.id}`)),
    [selectedContext],
  );

  // Per-browser pin/rename overrides until a server-side ChatConversation table exists.
  const convMeta = useConversationMeta(userId);

  const titleFor = useCallback(
    (conv: ConversationWithAgent): string => {
      const custom = convMeta.customTitle(conv.conversationId);
      if (custom) return custom;
      return conv.title || "Untitled";
    },
    [convMeta],
  );

  const handleTogglePin = useCallback(
    (conv: ConversationWithAgent) => convMeta.togglePin(conv.conversationId),
    [convMeta],
  );

  const handleRename = useCallback(
    (conv: ConversationWithAgent, next: string) => {
      convMeta.setTitle(conv.conversationId, next || null);
    },
    [convMeta],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    // Optimistic: drop it from the sidebar list immediately.
    setConversations((prev) =>
      prev.filter((c) => c.conversationId !== target.conversationId),
    );
    convMeta.remove(target.conversationId);
    // If we're currently viewing it, clear the chat view back to empty.
    if (conversationId === target.conversationId) clear();
    try {
      await deleteChatConversation(target.agentSlug, userId, target.conversationId);
    } catch (err) {
      console.error("[chat] delete failed:", err);
      // Pull the fresh list so we re-show it if the delete actually failed.
      listChatConversations(target.agentSlug, userId)
        .then((convs) => {
          setConversations((prev) => {
            const others = prev.filter((c) => c.agentSlug !== target.agentSlug);
            return [...others, ...convs.map((c) => ({ ...c, agentSlug: target.agentSlug }))]
              .sort(
                (a, b) =>
                  new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
              );
          });
        })
        .catch(() => {});
    } finally {
      setPendingDelete(null);
    }
  }, [pendingDelete, userId, conversationId, clear, convMeta]);

  const activeAgent = useMemo(
    () => agents.find((a) => a.slug === activeAgentSlug) ?? null,
    [agents, activeAgentSlug],
  );
  const activeConv = conversations.find((c) => c.conversationId === conversationId);

  // Most recent user-authored message — used by InputArea's ↑-to-recall shortcut.
  const lastUserMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (m.role === "user" && m.content) return m.content;
    }
    return undefined;
  }, [messages]);

  // Auto-focus the composer when the active agent or conversation changes —
  // saves the user a click when jumping between threads. setTimeout so the
  // focus call lands after the DOM has settled.
  useEffect(() => {
    if (!activeAgent) return;
    const id = window.setTimeout(() => inputAreaRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [activeAgent?.slug, conversationId]);

  /* Load available provider credentials once on mount */
  useEffect(() => {
    if (!userId) return;
    listProviderCredentials(userId)
      .then(setProviders)
      .catch(() => {});
  }, [userId]);

  /* Sync selected provider when active agent changes */
  useEffect(() => {
    setSelectedProvider(providerMap[activeAgentSlug ?? ""] ?? "spaces");
  }, [activeAgentSlug, providerMap]);

  /* Load conversations when agent changes (specific agent) or on mount (all agents) */
  useEffect(() => {
    if (!userId) {
      setConversations([]);
      return;
    }

    if (activeAgentSlug) {
      setConvLoading(true);
      listChatConversations(activeAgentSlug, userId)
        .then((convs) => {
          setConversations(convs.map((c) => ({ ...c, agentSlug: activeAgentSlug })));
          // Deep-link via ?conversation=<id> — load that specific conv
          // instead of the most recent one. Only honor it once per page
          // load so an in-page conversation switch doesn't keep snapping
          // back to the URL value.
          const deepLinkTarget =
            urlConversation &&
            consumedDeepLinkRef.current !== urlConversation &&
            convs.find((c) => c.conversationId === urlConversation)
              ? urlConversation
              : null;
          const targetConvId = deepLinkTarget ?? convs[0]?.conversationId;
          // Don't clobber a streaming chat or a chat the user already has open
          // — auto-load only when the user lands on the page with no active
          // conversation and no in-flight send (deep-link is the exception:
          // we always honor it on first visit because the user clicked a link
          // specifically asking for this conversation).
          const shouldLoad =
            !!targetConvId &&
            (deepLinkTarget !== null ||
              (!conversationId && !sending && messages.length === 0));
          if (shouldLoad && targetConvId) {
            if (deepLinkTarget) consumedDeepLinkRef.current = deepLinkTarget;
            pollChatMessages(activeAgentSlug, targetConvId)
              .then(({ messages: msgs, invocationsByMsgId }) =>
                loadConversation(msgs, targetConvId, invocationsByMsgId),
              )
              .catch(() => {});
          }
        })
        .catch(() => setConversations([]))
        .finally(() => setConvLoading(false));
    } else if (agents.length > 0) {
      // All-agents view: fetch conversations for every agent, merge and sort
      setConvLoading(true);
      Promise.all(
        agents.map((agent) =>
          listChatConversations(agent.slug, userId)
            .then((convs) => convs.map((c) => ({ ...c, agentSlug: agent.slug } as ConversationWithAgent)))
            .catch(() => [] as ConversationWithAgent[]),
        ),
      )
        .then((results) => {
          const all = results
            .flat()
            .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
          setConversations(all);
        })
        .catch(() => setConversations([]))
        .finally(() => setConvLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAgentSlug, userId, agents, urlConversation]);

  /* When a new conversation row is created mid-stream (SSE meta event), pull
   * the freshly persisted conversation into the sidebar so the user can click
   * back into it without waiting for the agent to finish responding. */
  useEffect(() => {
    if (!userId) return;
    return onConversationCreated(({ agentSlug, conversationId: newConvId }) => {
      listChatConversations(agentSlug, userId)
        .then((convs) => {
          const withAgent = convs.map((c) => ({ ...c, agentSlug }));
          setConversations((prev) => {
            // If we're in the "all agents" view, merge in just this agent's
            // conversations without dropping the others.
            if (activeAgentSlug) return withAgent;
            const otherAgents = prev.filter((c) => c.agentSlug !== agentSlug);
            const merged = [...otherAgents, ...withAgent];
            return merged.sort(
              (a, b) =>
                new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
            );
          });
          // Optimistic fallback in case the backend hasn't indexed it yet —
          // synthesize a placeholder so the sidebar entry is never missing.
          if (!convs.some((c) => c.conversationId === newConvId)) {
            const placeholder: ConversationWithAgent = {
              conversationId: newConvId,
              title: "New conversation",
              messageCount: 1,
              lastMessageAt: new Date().toISOString(),
              agentSlug,
            };
            setConversations((prev) =>
              prev.some((c) => c.conversationId === newConvId)
                ? prev
                : [placeholder, ...prev],
            );
          }
        })
        .catch(() => {});
    });
  }, [userId, activeAgentSlug, onConversationCreated]);

  const handleSelectAgent = useCallback((slug: string) => {
    if (slug === activeAgentSlug) return;
    setActiveAgentSlug(slug);
    clear();
    setInputValue("");
    setConversations([]);
  }, [activeAgentSlug, clear]);

  /**
   * Clear the active agent filter — sidebar reverts to the merged "all agents"
   * conversation list. Also resets the open chat (since the conversation we
   * were viewing belonged to the now-deselected agent) and the input.
   */
  const handleClearAgent = useCallback(() => {
    if (!activeAgentSlug) return;
    setActiveAgentSlug(null);
    clear();
    setInputValue("");
    setConversations([]);
  }, [activeAgentSlug, clear]);

  /**
   * Sample-prompt chip click on the Studio empty state — selects the agent,
   * pre-fills the composer with the prompt, and focuses it. We don't auto-send
   * so the user can edit before committing; the focused input + visible prompt
   * makes Enter the obvious next step.
   */
  const handleTrySample = useCallback(
    (slug: string, prompt: string) => {
      if (slug !== activeAgentSlug) {
        setActiveAgentSlug(slug);
        clear();
        setConversations([]);
      }
      setInputValue(prompt);
      // Wait for the agent panel + input to mount before grabbing focus.
      window.setTimeout(() => inputAreaRef.current?.focus(), 50);
    },
    [activeAgentSlug, clear],
  );

  const handleProviderChange = useCallback(async (newProvider: string) => {
    if (!activeAgentSlug) return;
    const prev = selectedProvider;
    setSelectedProvider(newProvider);
    setProviderChanging(true);
    try {
      await setUserAgentConfig(activeAgentSlug, userId, { provider: newProvider });
    } catch {
      setSelectedProvider(prev);
    } finally {
      setProviderChanging(false);
    }
  }, [activeAgentSlug, userId, selectedProvider]);

  const handleSelectConv = useCallback(async (conv: ConversationWithAgent) => {
    const switchingAgent = conv.agentSlug !== activeAgentSlug;
    try {
      const { messages: msgs, invocationsByMsgId } = await pollChatMessages(conv.agentSlug, conv.conversationId);
      loadConversation(msgs, conv.conversationId, invocationsByMsgId);
      if (switchingAgent) {
        setActiveAgentSlug(conv.agentSlug);
        setInputValue("");
      }
    } catch {
      // no-op — error is non-critical
    }
  }, [activeAgentSlug, loadConversation]);

  const handleNewConversation = useCallback(() => {
    if (activeAgent) {
      clear();
      setInputValue("");
    } else {
      setShowModal(true);
    }
  }, [activeAgent, clear]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = leftPanelWidth;
    let currentWidth = startWidth;

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      currentWidth = Math.max(160, Math.min(420, startWidth + delta));
      setLeftPanelWidth(currentWidth);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      try {
        localStorage.setItem("chat-left-panel-width", String(currentWidth));
      } catch {}
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [leftPanelWidth]);

  const handleSend = useCallback(() => {
    const text = inputValue.trim();
    const hasFiles = pendingFiles.length > 0;
    const hasContext = selectedContext.length > 0;
    // Allow empty text if there's at least an attachment or @-mention — same
    // behaviour as V1. Block while a stream is already in flight.
    if (!activeAgentSlug || sending) return;
    if (!text && !hasFiles && !hasContext) return;

    // Snapshot composer state and clear immediately for snappy UX.
    const filesSnapshot = pendingFiles.map((p) => p.file);
    const previewsToRevoke = pendingFiles.map((p) => p.previewUrl);
    const contextSnapshot: AttachedContextRef[] = selectedContext.map((item) => ({
      type: item.type,
      id: item.id,
      title: item.title,
      ...(typeof item.meta?.["conversationId"] === "string" &&
      item.meta["conversationId"].trim().length > 0
        ? { threadId: item.meta["conversationId"].trim() }
        : {}),
    }));
    const placeholderText =
      text ||
      (hasFiles
        ? `Sent ${filesSnapshot.length} image${filesSnapshot.length !== 1 ? "s" : ""}`
        : `Attached ${contextSnapshot.length} context item${contextSnapshot.length !== 1 ? "s" : ""}`);

    setInputValue("");
    setPendingFiles([]);
    setSelectedContext([]);
    setMentionOpen(false);

    const dispatch = async () => {
      let uploadedIds: string[] = [];
      if (filesSnapshot.length > 0) {
        try {
          const uploaded = await uploadChatAttachments(activeAgentSlug, userId, filesSnapshot);
          uploadedIds = uploaded.map((a) => a.id);
        } catch (err) {
          console.error("[chat] upload failed:", err);
          // Restore composer state so the user can retry / edit without losing work.
          setPendingFiles((prev) => [
            ...filesSnapshot.map((f, i) => ({
              file: f,
              previewUrl: previewsToRevoke[i] ?? URL.createObjectURL(f),
            })),
            ...prev,
          ]);
          setSelectedContext((prev) => [
            ...contextSnapshot.map((c) => ({ id: c.id, type: c.type, title: c.title } as ContextItem)),
            ...prev,
          ]);
          setInputValue(text);
          return;
        }
      }

      try {
        await send(activeAgentSlug, userId, placeholderText, {
          attachmentIds: uploadedIds.length > 0 ? uploadedIds : undefined,
          attachedContext: contextSnapshot.length > 0 ? contextSnapshot : undefined,
        });
        listChatConversations(activeAgentSlug, userId)
          .then((convs) => setConversations(convs.map((c) => ({ ...c, agentSlug: activeAgentSlug }))))
          .catch(() => {});
      } finally {
        // Revoke object URLs whether send succeeded or not — they're a memory leak.
        previewsToRevoke.forEach((u) => {
          try {
            URL.revokeObjectURL(u);
          } catch {}
        });
      }
    };

    void dispatch();
  }, [inputValue, pendingFiles, selectedContext, activeAgentSlug, userId, sending, send]);

  return (
    <>
      <div data-id="chat-page" className="flex h-full overflow-hidden">

        {/* Left */}
        <div style={{ width: leftPanelWidth }} className="shrink-0">
          <LeftPanel
            activeAgent={activeAgent}
            agents={agents}
            conversations={conversations}
            convLoading={convLoading}
            activeConvId={conversationId}
            selectedProvider={selectedProvider}
            providers={providers}
            providerChanging={providerChanging}
            isPinned={convMeta.isPinned}
            titleFor={titleFor}
            onPickAgent={() => setShowModal(true)}
            onClearAgent={handleClearAgent}
            onProviderChange={handleProviderChange}
            onNewConversation={handleNewConversation}
            onSelectConv={handleSelectConv}
            onTogglePin={handleTogglePin}
            onRename={handleRename}
            onRequestDelete={(conv) => setPendingDelete(conv)}
            onBrowseAgents={() => navigate("/v3/agents")}
          />
        </div>

        {/* Resizer */}
        <div
          data-id="chat-left-panel-resizer"
          className="group relative flex w-1 shrink-0 cursor-col-resize items-center justify-center"
          onMouseDown={handleResizeStart}
        >
          <div className="h-full w-px bg-xyne-border-subtle group-hover:w-0.5 group-hover:bg-xyne-border-strong transition-all" />
        </div>

        {activeAgent ? (
          <>
            {/* Center */}
            <div
              data-id="chat-center-panel"
              className="flex flex-1 flex-col overflow-hidden bg-xyne-surface-subtle"
            >
              <CenterHeader
                agent={activeAgent}
                convTitle={activeConv?.title}
                conversationId={conversationId}
                userId={userId}
                messageCount={messages.length}
                onOpenSettings={() => navigate(`/v3/agents/${activeAgent.slug}`)}
                onOpenDashboard={() => navigate("/v3/dashboard")}
              />

              {messages.length === 0 && !sending ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
                  <ChatCircleIcon size={48} className="text-xyne-brand" />
                  <p className="text-[15px] font-medium text-xyne-fg-primary">{activeAgent.name}</p>
                  <p className="max-w-[280px] text-center text-[13px] text-xyne-fg-muted">
                    {activeAgent.description || "Start a conversation with this agent"}
                  </p>
                </div>
              ) : (
                <MessageThread
                  messages={messages}
                  sending={sending}
                  toolLabel={toolLabel}
                  agent={activeAgent}
                  userAbbr={userAbbr}
                  streamingMsgId={streamingMsgId}
                  liveInvocations={liveInvocations}
                  liveReasoning={liveReasoning}
                  invocationsByMsgId={invocationsByMsgId}
                  reasoningByMsgId={reasoningByMsgId}
                />
              )}

              <InputArea
                ref={inputAreaRef}
                agentName={activeAgent.name}
                value={inputValue}
                onChange={setInputValue}
                onSend={handleSend}
                onStop={() => { stop(userId).catch(() => {}); }}
                sending={sending}
                disabled={false}
                lastUserMessage={lastUserMessage}
                pendingFiles={pendingFiles}
                onAddFiles={handleAddFiles}
                onRemoveFile={handleRemoveFile}
                selectedContext={selectedContext}
                onRemoveContext={handleRemoveContext}
                mentionOpen={mentionOpen}
                onToggleMention={handleToggleMention}
                renderMentionPicker={() => (
                  <ContextPicker
                    slug={activeAgent.slug}
                    userId={userId}
                    open={mentionOpen}
                    tab={contextTab}
                    query={contextQuery}
                    selectedKeys={selectedContextKeys}
                    onTabChange={setContextTab}
                    onQueryChange={setContextQuery}
                    onSelect={handleAddContext}
                    onClose={() => setMentionOpen(false)}
                  />
                )}
              />
            </div>

          </>
        ) : (
          <EmptyState
            agents={agents}
            loading={agentsLoading}
            onSelectAgent={handleSelectAgent}
            onTrySample={handleTrySample}
          />
        )}
      </div>

      {showModal && (
        <AgentPickerModal
          agents={agents}
          loading={agentsLoading}
          onSelect={handleSelectAgent}
          onClose={() => setShowModal(false)}
        />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Delete conversation?"
        description={
          pendingDelete
            ? `"${titleFor(pendingDelete)}" and all its messages will be permanently deleted. This can't be undone.`
            : undefined
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
        onConfirm={() => { handleConfirmDelete().catch(() => {}); }}
      />
    </>
  );
}
