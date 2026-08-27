import { forwardRef, useImperativeHandle, useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  LightningIcon,
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
  ArrowsClockwiseIcon,
  CursorClickIcon,
  ShareNetworkIcon,
  CopySimpleIcon,
  ArrowSquareOutIcon,
  LinkBreakIcon,
  FileIcon,
} from "@phosphor-icons/react";
import { useAuth } from "../../hooks/useAuth";
import { useChat } from "../hooks/useChat";
import type { MessageBranchInfo } from "../hooks/useChat";
import { useAgents } from "../hooks/useAgents";
import { useConversationMeta } from "../hooks/useConversationMeta";
import {
  deleteChatConversation,
  listChatConversations,
  listChatLitellmModels,
  listRuns,
  pollChatMessages,
  subscribeLiveConversation,
  listProviderCredentials,
  setUserAgentConfig,
  approveChatAction,
  uploadChatAttachments,
  chatAttachmentDownloadUrl,
  publishDesignArtifact,
  revokeDesignArtifactShare,
  type AttachedContextRef,
  type ChatAttachmentMeta,
  type DesignArtifactShare,
  type ContextItem,
  type ContextSearchType,
  type ConversationSummary,
  type ChatMsg,
  type PendingAction,
  type PlanTodo,
  type ProviderCredential,
  type ToolInvocation,
} from "../../lib/api";
import { ContextPicker } from "../../components/ContextPicker";
import { DebugDrawer } from "../../components/DebugDrawer";
import { MessageRatingButtons } from "../../components/MessageRatingButtons";
import type { AgentLight } from "../../lib/types";
import { Avatar, nameToHsl } from "./ui/Avatar";
import { ReadonlyContextPills } from "./ReadonlyContextPills";
import { Dialog } from "./ui/Dialog";
import { SessionExportMenu } from "./ui/SessionExportMenu";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { DesignSystemSheet } from "./DesignSystemSheet";
import { DesignGallery } from "./DesignGallery";
import { Menu, MenuItem } from "./ui/Menu";
import { Menu as BaseMenu } from "@base-ui-components/react/menu";
import { Badge } from "./ui/Badge";
import { SidePanel } from "./ui/SidePanel";
import { useSnackbar } from "./ui/Snackbar";

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

function formatAttachmentSize(size?: number): string | null {
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return null;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function attachmentKindLabel(attachment: ChatAttachmentMeta): string {
  const name = attachment.originalFilename.toLowerCase();
  const mime = attachment.mimeType.toLowerCase();
  if (mime.includes("pdf") || name.endsWith(".pdf")) return "PDF";
  if (mime.startsWith("image/")) return "Image";
  if (mime.startsWith("video/")) return "Video";
  if (mime.includes("zip") || name.endsWith(".zip")) return "ZIP";
  if (mime.includes("presentation") || name.endsWith(".pptx")) return "PPTX";
  if (mime.includes("spreadsheet") || name.endsWith(".xlsx") || name.endsWith(".csv")) return "Sheet";
  return "File";
}

async function fetchChatAttachmentBlob(attachment: ChatAttachmentMeta, userId: string): Promise<Blob> {
  const response = await fetch(chatAttachmentDownloadUrl(attachment.id), {
    credentials: "include",
    headers: { "x-user-id": userId },
  });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  return response.blob();
}

function ChatAttachmentList({
  attachments,
  userId,
  align = "left",
}: {
  attachments: ChatAttachmentMeta[];
  userId: string;
  align?: "left" | "right";
}) {
  const { show: showSnackbar } = useSnackbar();
  if (!attachments.length) return null;

  const openAttachment = async (attachment: ChatAttachmentMeta): Promise<void> => {
    try {
      const url = URL.createObjectURL(await fetchChatAttachmentBlob(attachment, userId));
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      showSnackbar({
        variant: "error",
        title: "Could not open attachment",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const downloadAttachment = async (attachment: ChatAttachmentMeta): Promise<void> => {
    try {
      const url = URL.createObjectURL(await fetchChatAttachmentBlob(attachment, userId));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = attachment.originalFilename;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      showSnackbar({
        variant: "success",
        title: "Download complete",
        description: `${attachment.originalFilename} has been downloaded successfully`,
      });
    } catch (err) {
      showSnackbar({
        variant: "error",
        title: "Download failed",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  return (
    <div className={`flex flex-col gap-2 ${align === "right" ? "items-end" : "items-start"}`}>
      {attachments.map((attachment) => {
        const kind = attachmentKindLabel(attachment);
        const size = formatAttachmentSize(attachment.size);
        return (
          <div
            key={attachment.id}
            data-id="chat-attachment-card"
            className="flex w-[min(420px,75vw)] items-center gap-3 rounded-[12px] border border-xyne-border bg-xyne-surface px-3 py-2 shadow-sm"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-xyne-surface-subtle text-[10px] font-bold uppercase text-xyne-fg-secondary ring-1 ring-xyne-border-subtle">
              {kind === "File" ? <FileIcon size={18} /> : kind}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-xyne-fg-primary">{attachment.originalFilename}</p>
              <p className="truncate text-[11px] text-xyne-fg-muted">
                {[kind, size].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                className="rounded-md border border-xyne-border-subtle px-2 py-1 text-[11px] font-medium text-xyne-fg-secondary transition hover:border-xyne-border hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary"
                onClick={() => { void openAttachment(attachment); }}
              >
                View
              </button>
              <button
                type="button"
                className="rounded-md border border-xyne-border-subtle px-2 py-1 text-[11px] font-medium text-xyne-fg-secondary transition hover:border-xyne-border hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary"
                onClick={() => { void downloadAttachment(attachment); }}
              >
                Download
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
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

/* ── per-chat LiteLLM model switcher ─────────────────────────────────
 * Lists the models the agent's shared (admin-set) LiteLLM key can access and
 * lets any chat participant pin one for the current conversation. Empty models
 * ⇒ renders nothing (agent has no litellm credential). value "" = agent default
 * (no override). See ChatPageV3's fetch effect + handleSend(modelOverride). */
const CHAT_THINKING_OPTIONS: Array<{ value: "off" | "minimal" | "low" | "medium" | "high" | null; label: string }> = [
  { value: null, label: "Default" },
  { value: "off", label: "Off" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];
export type ChatThinkingLevel = "off" | "minimal" | "low" | "medium" | "high";

/**
 * Combined model + thinking picker for the chat composer, styled after the
 * Claude app's model menu: the trigger leads with the model name
 * ("Recommended" when no pin, thinking level beside it when set); the menu
 * holds the Recommended row (agent's configured model in brackets), a search
 * bar over the agent's allowed model list, and a Thinking entry whose options
 * fly out to the right side.
 */
function ModelThinkingMenu({
  models,
  defaultModel,
  selectedModel,
  onSelectModel,
  thinkingLevel,
  onSelectThinking,
  disabled,
}: {
  models: Array<{ id: string; name: string }>;
  defaultModel: string | null;
  selectedModel: string;
  onSelectModel: (model: string) => void;
  thinkingLevel: ChatThinkingLevel | null;
  onSelectThinking: (v: ChatThinkingLevel | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const close = () => { setOpen(false); setQuery(""); setThinkingOpen(false); };

  const selected = models.find((m) => m.id === selectedModel) ?? null;
  const q = query.trim().toLowerCase();
  const filtered = q ? models.filter((m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)) : models;
  const thinkingLabel = CHAT_THINKING_OPTIONS.find((o) => o.value === thinkingLevel)?.label ?? "Default";

  const rowClass = (active: boolean) =>
    `flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors ${
      active ? "bg-xyne-surface-sunken font-medium text-xyne-fg-primary" : "text-xyne-fg-primary hover:bg-xyne-surface-subtle"
    }`;

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        data-id="model-thinking-trigger"
        title={selected ? selected.id : defaultModel ? `Recommended (${defaultModel})` : "Recommended model"}
        aria-label="Model and thinking"
        onClick={() => (open ? close() : setOpen(true))}
        className={`flex h-8 items-center gap-1.5 rounded-full bg-xyne-surface-subtle px-3 text-[12px] font-medium transition-colors ${
          disabled ? "cursor-not-allowed opacity-50" : "hover:bg-xyne-surface-sunken"
        } text-xyne-fg-primary`}
      >
        <SparkleIcon size={13} className="shrink-0 text-xyne-brand" />
        <span className="max-w-[150px] truncate">{selected ? selected.name : defaultModel ?? "Recommended"}</span>
        {thinkingLevel && <span className="text-xyne-fg-tertiary">{thinkingLabel}</span>}
        <CaretDownIcon size={11} className="shrink-0 text-xyne-fg-tertiary" />
      </button>

      {open && (
        <>
          {/* click-outside backdrop */}
          <div className="fixed inset-0 z-40" onClick={close} aria-hidden />
          <div
            data-id="model-thinking-menu"
            className="absolute bottom-full left-0 z-50 mb-2 w-72 rounded-xl border border-xyne-border bg-xyne-surface p-1 shadow-[0_10px_40px_-8px_rgba(0,0,0,0.35)]"
          >
            {/* Recommended — clears the pin; the run uses the agent's configured model. */}
            <button
              type="button"
              data-id="model-option-recommended"
              onClick={() => { onSelectModel(""); close(); }}
              className={rowClass(selectedModel === "")}
            >
              <span className="flex min-w-0 flex-col items-start gap-0.5">
                <span className="font-medium">{defaultModel ?? "Recommended"}</span>
                {defaultModel && (
                  <span className="max-w-full truncate text-[11px] text-xyne-fg-tertiary">(Recommended)</span>
                )}
              </span>
              {selectedModel === "" && <CheckIcon size={13} className="shrink-0 text-xyne-brand" />}
            </button>

            {models.length > 0 && (
              <>
                <div className="mx-1 my-1 h-px bg-xyne-border-subtle" />
                <div className="mx-1 my-0.5 flex items-center gap-1.5 rounded-lg border border-xyne-border bg-xyne-surface-subtle px-2 py-1.5">
                  <MagnifyingGlassIcon size={13} className="shrink-0 text-xyne-fg-muted" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search models…"
                    data-id="model-search"
                    className="w-full bg-transparent text-[13px] text-xyne-fg-primary outline-none placeholder:text-xyne-fg-muted"
                  />
                </div>
                <div className="flex max-h-72 flex-col overflow-auto">
                  {filtered.length === 0 ? (
                    <div className="px-2.5 py-2 text-[13px] text-xyne-fg-tertiary">No models match</div>
                  ) : (
                    filtered.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        title={m.id}
                        data-id={`model-option-${m.id}`}
                        onClick={() => { onSelectModel(m.id); close(); }}
                        className={rowClass(selectedModel === m.id)}
                      >
                        <span className="truncate font-mono text-[12.5px]">{m.name}</span>
                        {selectedModel === m.id && <CheckIcon size={13} className="shrink-0 text-xyne-brand" />}
                      </button>
                    ))
                  )}
                </div>
              </>
            )}

            <div className="mx-1 my-1 h-px bg-xyne-border-subtle" />
            {/* Thinking — options fly out to the right side. */}
            <div className="relative">
              <button
                type="button"
                data-id="thinking-expand"
                aria-expanded={thinkingOpen}
                onClick={() => setThinkingOpen((v) => !v)}
                className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-xyne-fg-primary hover:bg-xyne-surface-subtle"
              >
                <span className="flex items-center gap-1.5 font-medium">
                  <BrainIcon size={13} className="shrink-0 text-xyne-fg-tertiary" />
                  Thinking
                </span>
                <span className="flex items-center gap-1 text-xyne-fg-tertiary">
                  {thinkingLabel}
                  <CaretRightIcon size={11} className="shrink-0" />
                </span>
              </button>
              {thinkingOpen && (
                <div className="absolute bottom-0 right-0 z-50 w-36 translate-x-[calc(100%+8px)] rounded-xl border border-xyne-border bg-xyne-surface p-1 shadow-[0_10px_40px_-8px_rgba(0,0,0,0.35)]">
                  {CHAT_THINKING_OPTIONS.map((o) => (
                    <button
                      key={o.label}
                      type="button"
                      data-id={`thinking-option-${o.label.toLowerCase()}`}
                      onClick={() => { onSelectThinking(o.value); close(); }}
                      className={rowClass(o.value === thinkingLevel)}
                    >
                      <span>{o.label}</span>
                      {o.value === thinkingLevel && <CheckIcon size={13} className="shrink-0 text-xyne-brand" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ── fast mode toggle ────────────────────────────────────────────── */

/** localStorage key for the per-agent chat fast-mode preference. */
function fastModeStorageKey(agentSlug: string): string {
  return `chat-fast-mode:${agentSlug}`;
}

export function readStoredFastMode(agentSlug: string | null | undefined): boolean {
  if (!agentSlug) return false;
  try {
    return localStorage.getItem(fastModeStorageKey(agentSlug)) === "1";
  } catch {
    return false;
  }
}

function writeStoredFastMode(agentSlug: string, enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(fastModeStorageKey(agentSlug), "1");
    else localStorage.removeItem(fastModeStorageKey(agentSlug));
  } catch {
    /* storage unavailable (private mode / quota) — preference is session-only */
  }
}

/* ── typing indicator ────────────────────────────────────────────── */

function TypingIndicator({ agent }: { agent: AgentLight }) {
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

// Tolerant citation token regex.
// Accepts:
//   [clf-abc123#1]  – canonical with clf- prefix and # separator
//   [abc123#1]      – missing clf- prefix
//   [clf-abc123_1]  – underscore separator instead of #
//   [abc123_1]      – missing clf- prefix + underscore separator
//   【clf-abc123#1】 – full-width brackets ( tolerated )
// The tool-call id is matched generically — any run of chars that isn't the
// `#`/`_` separator boundary, whitespace, or a bracket — rather than an
// allow-list. Tool-call ids vary by provider (OpenAI `call_…`, Responses
// composite `call_…|fc_…`, function paths `functions.x:2`), and an enumerated
// charset kept silently dropping new formats. `\d+` still pins the chunk, so
// malformed ranges like `#1-#10` fail to match and get stripped.
const CLAW_CITATION_TOKEN_RE = /([【\[\u27e6])((?:clf-)?[^#\s【\[⟦】\]⟧]+[#_]\d+)([】\]\u27e7])/g;
const CLAW_CITATION_HREF_RE = /^cite:((?:clf-)?[^#\s【\[⟦】\]⟧]+)#(\d+)$/;
/**
 * Catch-all for malformed clf tokens the LLM sometimes hallucinates.
 * Example: [clf-functions.Xyne_Spaces__spaces-messages:#6#25]
 * Anything bracketed that starts with "clf-" but doesn't match the strict
 * CLAW_CITATION_TOKEN_RE is stripped outright so it never leaks into the UI.
 */
const CLAW_CITATION_MALFORMED_RE = /[【\[\u27e6]\s*clf-[^】\]\u27e7]*[】\]\u27e7]/g;

function stripMalformedCitations(text: string): string {
  return text.replace(CLAW_CITATION_MALFORMED_RE, "");
}

export interface CitationRef {
  toolCallId: string;
  chunkIndex: number;
  key: string;
  token: string;
}

export interface CitationChunk {
  key: string;
  token: string;
  toolCallId: string;
  chunkIndex: number;
  text: string;
  title: string;
}

export interface CitationLookup {
  invocation: ToolInvocation;
  messageId: string;
  chunk: CitationChunk;
  chunks: CitationChunk[];
}

export interface CitationSelection {
  key: string;
  ref: CitationRef;
  citationNumber: number;
  /** The originating message's full citation-number map, carried so the panel
   *  can resolve the sequential number for sibling ("other") chunks exactly the
   *  way the inline chips do. */
  numbers: Map<string, number>;
}

function normalizeCitationToolCallId(toolCallId: string): string {
  return toolCallId.startsWith("clf-") ? toolCallId.slice(4) : toolCallId;
}

function buildCitationKey(toolCallId: string, chunkIndex: number): string {
  return `${toolCallId}#${chunkIndex}`;
}

/**
 * Stable key for the sequential citation-number map. A "distinct source" is one
 * cited (toolCallId, chunkIndex) pair, keyed on the NORMALIZED tool-call id so
 * `clf-`-prefixed and bare forms of the same id collapse to one entry and reuse
 * the same number.
 */
function citationNumberKey(toolCallId: string, chunkIndex: number): string {
  return `${normalizeCitationToolCallId(toolCallId)}#${chunkIndex}`;
}

export function buildCitationKeyAliases(toolCallId: string, chunkIndex: number): string[] {
  const raw = normalizeCitationToolCallId(toolCallId);
  const prefixed = toolCallId.startsWith("clf-") ? toolCallId : `clf-${toolCallId}`;
  return Array.from(new Set([
    buildCitationKey(toolCallId, chunkIndex),
    buildCitationKey(raw, chunkIndex),
    buildCitationKey(prefixed, chunkIndex),
  ]));
}

function parseClawCitationRef(input: string): CitationRef | null {
  const trimmed = input.trim();

  // ── 1. Try the href form (cite:…) first ───────────────────────────────
  const hrefMatch = trimmed.match(CLAW_CITATION_HREF_RE);
  if (hrefMatch) {
    const toolCallId = ensureClfPrefix(hrefMatch[1]!);
    const chunkIndex = Number(hrefMatch[2]!);
    if (Number.isNaN(chunkIndex)) return null;
    return {
      toolCallId,
      chunkIndex,
      key: buildCitationKey(toolCallId, chunkIndex),
      token: `[${toolCallId}#${chunkIndex}]`,
    };
  }

  // ── 2. Strip surrounding brackets / full-width brackets ──────────────
  const cleaned = trimmed
    .replace(/^[【\[\u27e6]/, "")
    .replace(/[】\]\u27e7]$/, "");

  // ── 3. Try canonical strict form: clf-<id>#<chunk> ───────────────────
  let match = cleaned.match(/^(clf-[^#\s【\[⟦】\]⟧]+)#(\d+)$/);
  if (match) {
    const toolCallId = match[1]!;
    const chunkIndex = Number(match[2]!);
    if (Number.isNaN(chunkIndex)) return null;
    return {
      toolCallId,
      chunkIndex,
      key: buildCitationKey(toolCallId, chunkIndex),
      token: `[${toolCallId}#${chunkIndex}]`,
    };
  }

  // ── 4. Fallback: missing clf- prefix ─────────────────────────────────
  // e.g. "abc123#14" or "abc123_14"
  match = cleaned.match(/^([^#\s【\[⟦】\]⟧]+)[#_](\d+)$/);
  if (match) {
    const rawId = match[1]!;
    // Don't double-prefix if the id already starts with clf-
    const toolCallId = rawId.startsWith("clf-") ? rawId : `clf-${rawId}`;
    const chunkIndex = Number(match[2]!);
    if (Number.isNaN(chunkIndex)) return null;
    return {
      toolCallId,
      chunkIndex,
      key: buildCitationKey(toolCallId, chunkIndex),
      token: `[${toolCallId}#${chunkIndex}]`,
    };
  }

  return null;
}

/** Guarantees every tool-call id starts with the "clf-" prefix. */
function ensureClfPrefix(id: string): string {
  return id.startsWith("clf-") ? id : `clf-${id}`;
}

/**
 * Assign a flat, sequential citation number to each DISTINCT cited source
 * (normalized tool-call id + chunk index), in order of first appearance. Repeat
 * references to the same source reuse its number, so the reader sees [1], [2],
 * [3]… instead of the old `tool.chunk` composite. Tokens whose tool call isn't
 * in `knownToolCallIds` are skipped (and later stripped by linkify), so the
 * sequence stays gap-free.
 */
function buildCitationNumbers(text: string, knownToolCallIds?: Set<string>): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const match of text.matchAll(CLAW_CITATION_TOKEN_RE)) {
    const citation = parseClawCitationRef(match[0]);
    if (!citation) continue;
    if (knownToolCallIds && !knownToolCallIds.has(normalizeCitationToolCallId(citation.toolCallId))) continue;
    const key = citationNumberKey(citation.toolCallId, citation.chunkIndex);
    if (!numbers.has(key)) numbers.set(key, numbers.size + 1);
  }
  return numbers;
}

function linkifyClawCitations(text: string, numbers: Map<string, number>): string {
  return text.replace(CLAW_CITATION_TOKEN_RE, (_match, open, ref, close) => {
    const citation = parseClawCitationRef(`${open}${ref}${close}`);
    if (!citation) return `${open}${ref}${close}`;
    const number = numbers.get(citationNumberKey(citation.toolCallId, citation.chunkIndex));
    if (number === undefined) return "";
    return `[${number}](cite:${citation.key})`;
  });
}

/** Manual, never-throws un-escape of a JSON string body (no surrounding quotes). */
function unescapeJsonStringBody(s: string): string {
  return s.replace(/\\(?:u([0-9a-fA-F]{4})|(.))/g, (_m, u: string | undefined, c: string | undefined) => {
    if (u) return String.fromCharCode(parseInt(u, 16));
    switch (c) {
      case "n": return "\n";
      case "t": return "\t";
      case "r": return "\r";
      case "b": return "\b";
      case "f": return "\f";
      default: return c ?? "";
    }
  });
}

/**
 * Recover the inner text of an MCP `{"content":[{"type":"text","text":"…"}]}`
 * envelope that JSON.parse couldn't handle — i.e. legacy rows persisted before
 * the single-source fix, where the old 50K persist-only slice cut the JSON
 * mid-string. Scans each `"text":"…"` body (tolerating a truncated final one)
 * and un-escapes it so line/chunk/citation parsing works on historical data.
 */
function recoverTruncatedResultText(result: string): string {
  const parts: string[] = [];
  // `(?:[^"\\]|\\.)*` stops at the block's unescaped closing quote OR end of
  // input (truncated tail), so it captures complete and partial bodies alike.
  const re = /"text"\s*:\s*"((?:[^"\\]|\\.)*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(result)) !== null) {
    if (m[1]) parts.push(unescapeJsonStringBody(m[1]));
  }
  return parts.join("\n\n");
}

function extractInvocationResultText(result: string): string {
  if (!result) return "";
  try {
    const parsed = JSON.parse(result) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const textParts = (parsed.content ?? [])
      .filter((item) => item?.type === "text" && typeof item.text === "string")
      .map((item) => item.text ?? "");
    if (textParts.length > 0) return textParts.join("\n\n");
  } catch {
    // Legacy rows were truncated mid-JSON by the old persist-only slice, so
    // JSON.parse fails — recover the inner text so citations still resolve.
    const recovered = recoverTruncatedResultText(result);
    if (recovered) return recovered;
    // Otherwise fall back to the raw string (already plain text).
  }
  return result;
}

export function parseInvocationCitationChunks(invocation: ToolInvocation): CitationChunk[] {
  const lines = extractInvocationResultText(invocation.result ?? "").split(/\r?\n/);
  const chunks: CitationChunk[] = [];
  let current: CitationChunk | null = null;

  const pushCurrent = () => {
    if (!current) return;
    current.text = current.text.trim();
    current.title = current.title.trim() || `Chunk #${current.chunkIndex}`;
    chunks.push(current);
    current = null;
  };

  for (const line of lines) {
    // Tolerant chunk-header regex: accepts clf- prefix (optional), # or _ separator.
    const match = line.match(/^\s*([【\[\u27e6])((?:clf-)?[^#\s【\[⟦】\]⟧]+)[#_](\d+)([】\]\u27e7])\s*(.*)$/);
    if (match) {
      pushCurrent();
      const toolCallId = ensureClfPrefix(match[2]!);
      const chunkIndex = Number(match[3]!);
      const remainder = match[5] ?? "";
      const key = buildCitationKey(toolCallId, chunkIndex);
      current = {
        key,
        token: `[${toolCallId}#${chunkIndex}]`,
        toolCallId,
        chunkIndex,
        text: remainder,
        title: remainder.split(/\r?\n/)[0] ?? "",
      };
      continue;
    }
    if (current) {
      current.text += (current.text ? "\n" : "") + line;
      if (!current.title && line.trim()) current.title = line.trim();
    }
  }

  pushCurrent();
  return chunks;
}

/**
 * Flatten a message's CITED sources into a plain-text, numbered list — for the
 * evals CSV export. Numbering mirrors the inline chips exactly: only tokens
 * whose backing chunk is present are counted, in first-appearance order, so
 * `[n]` here matches the rendered `[n]` chip. Returns "" when nothing resolves.
 * Keeps every citation internal private — the CSV util never touches them.
 */
export function citedChunksFor(answer: string, invocations: ToolInvocation[]): string {
  const allChunks = invocations.flatMap((inv) => parseInvocationCitationChunks(inv));
  if (allChunks.length === 0) return "";
  const knownIds = new Set(allChunks.map((c) => normalizeCitationToolCallId(c.toolCallId)));
  const numbers = buildCitationNumbers(answer, knownIds);
  if (numbers.size === 0) return "";
  const chunkByKey = new Map(allChunks.map((c) => [citationNumberKey(c.toolCallId, c.chunkIndex), c] as const));
  return [...numbers.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([key, n]) => `[${n}] ${chunkByKey.get(key)?.text ?? ""}`.trim())
    .join("\n");
}

function CitationChip({
  citation,
  citationNumber,
  selected,
  onOpen,
}: {
  citation: CitationRef;
  citationNumber: number;
  selected: boolean;
  onOpen: (citation: CitationRef, citationNumber: number) => void;
}) {
  const open = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onOpen(citation, citationNumber);
  };

  return (
    <button
      type="button"
      title={`Open source · ${citation.toolCallId} · chunk ${citation.chunkIndex}`}
      aria-label={`Open citation ${citationNumber}`}
      onMouseDown={open}
      onPointerDown={open}
      onClick={open}
      aria-pressed={selected}
      className={`mx-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-md border px-1 align-baseline text-[11px] font-medium tabular-nums no-underline transition hover:cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-xyne-brand/30 ${
        selected
          ? "border-xyne-fg-primary bg-xyne-fg-primary text-xyne-fg-inverse shadow-sm"
          : "border-xyne-border-strong bg-xyne-surface-sunken text-xyne-fg-primary hover:border-xyne-brand/60 hover:bg-xyne-brand-ghost hover:text-xyne-brand"
      }`}
    >
      {citationNumber}
    </button>
  );
}

export function CitationMarkdown({
  content,
  invocations,
  selectedCitationKey,
  onOpenCitation,
  // When true (chat default) tokens whose tool-call id isn't among `invocations`
  // are stripped. Evals pass false so every [clf-…] token renders as a numbered
  // chip even when the turn's captured tool invocations don't line up — better a
  // visible chip than a silently dropped citation.
  filterUnknownCitations = true,
}: {
  content: string;
  invocations: ToolInvocation[];
  selectedCitationKey: string | null;
  onOpenCitation: (citation: CitationRef, citationNumber: number, numbers: Map<string, number>) => void;
  filterUnknownCitations?: boolean;
}) {
  const knownToolCallIds = useMemo(() => {
    const ids = new Set<string>();
    for (const inv of invocations) {
      if (inv.toolCallId) ids.add(normalizeCitationToolCallId(inv.toolCallId));
    }
    return ids;
  }, [invocations]);
  const citationNumbers = useMemo(
    () => buildCitationNumbers(content, filterUnknownCitations ? knownToolCallIds : undefined),
    [content, knownToolCallIds, filterUnknownCitations]
  );
  const linkedContent = useMemo(
    () => linkifyClawCitations(content, citationNumbers),
    [content, citationNumbers]
  );
  const cleanedContent = useMemo(
    () => stripMalformedCitations(linkedContent),
    [linkedContent]
  );

  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      urlTransform={(url) => url}
      components={{
        a: ({ href, children, ...props }) => {
          if (href?.startsWith("cite:")) {
            const ref = parseClawCitationRef(href);
            if (!ref) return <>{children}</>;
            const citationNumber = citationNumbers.get(citationNumberKey(ref.toolCallId, ref.chunkIndex)) ?? 1;
            return (
              <CitationChip
                citation={ref}
                citationNumber={citationNumber}
                selected={selectedCitationKey === ref.key}
                onOpen={(c, n) => onOpenCitation(c, n, citationNumbers)}
              />
            );
          }
          return (
            <a {...props} href={href} target="_blank" rel="noreferrer" className="underline decoration-xyne-border hover:text-xyne-brand">
              {children}
            </a>
          );
        },
      }}
    >
      {cleanedContent}
    </Markdown>
  );
}

export function CitationPanel({
  selection,
  citation,
  width,
  onClose,
  onOpenCitation,
}: {
  selection: CitationSelection;
  citation: CitationLookup | null;
  width: number;
  onClose: () => void;
  onOpenCitation: (citation: CitationRef, citationNumber: number, numbers: Map<string, number>) => void;
}) {
  if (!citation) {
    return (
      <SidePanel
        onClose={onClose}
        icon={<InfoIcon size={18} className="text-xyne-brand" />}
        title="Citation"
        subtitle={`${selection.ref.token} · source unavailable`}
        width={width}
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-100">
            The citation panel opened, but no matching tool-result chunk was found for this citation.
          </div>
          <div className="rounded-xl border border-xyne-border-subtle bg-xyne-surface-subtle px-4 py-3">
            <div className="grid gap-2 text-[12px] text-xyne-fg-secondary">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xyne-fg-tertiary">Citation token</span>
                <span className="min-w-0 break-all text-right font-mono text-[11px]">{selection.ref.token}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xyne-fg-tertiary">Tool call id</span>
                <span className="min-w-0 break-all text-right font-mono text-[11px]">{selection.ref.toolCallId}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xyne-fg-tertiary">Chunk</span>
                <span className="font-mono text-[11px]">#{selection.ref.chunkIndex}</span>
              </div>
            </div>
          </div>
          <div className="text-[12px] leading-relaxed text-xyne-fg-tertiary">
            This panel resolves data only from the conversation's `invocationsByMsgId` payload returned by the `/messages` endpoint. If the cited tool call is absent there, or the tool result text does not contain the cited chunk token, the panel has nothing to render yet.
          </div>
        </div>
      </SidePanel>
    );
  }

  const { invocation, chunk, chunks } = citation;

  const argsText = (() => {
    try {
      return JSON.stringify(invocation.args ?? {}, null, 2);
    } catch {
      return String(invocation.args ?? "");
    }
  })();

  return (
    <SidePanel
      onClose={onClose}
      icon={<InfoIcon size={18} className="text-xyne-brand" />}
      title="Citation"
      subtitle={`${humanizeToolName(invocation.toolName)} · chunk #${chunk.chunkIndex}`}
      width={width}
    >
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-xyne-fg-muted">
                Source
              </p>
              <p className="mt-1 text-[13px] font-semibold text-xyne-fg-primary">
                {humanizeToolName(invocation.toolName)}
              </p>
            </div>
            <span className="min-w-0 break-all rounded-md border border-xyne-border-subtle bg-xyne-surface px-2 py-0.5 text-right font-mono text-[11px] text-xyne-fg-tertiary">
              {chunk.token}
            </span>
          </div>
          <div className="mt-3 grid gap-2 text-[12px] text-xyne-fg-secondary">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xyne-fg-tertiary">Tool call</span>
              <span className="font-mono text-[11px]">{invocation.toolCallId ?? "(missing)"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xyne-fg-tertiary">Duration</span>
              <span className="font-mono text-[11px]">{invocation.durationMs}ms</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xyne-fg-tertiary">Status</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] ${invocation.isError ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"}`}>
                {invocation.isError ? "error" : invocation.status ?? "completed"}
              </span>
            </div>
          </div>
        </div>

        {chunks.length > 1 && (
          <details className="group shrink-0 border-b border-xyne-border-subtle">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-xyne-fg-muted">
              <CaretRightIcon size={11} className="transition-transform group-open:rotate-90" />
              Other chunks
              <span className="ml-auto rounded-full bg-xyne-surface px-1.5 py-0.5 font-mono text-[10px] text-xyne-fg-tertiary">
                {chunks.length}
              </span>
            </summary>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {chunks.map((c) => {
                // Sibling chunks each carry their own sequential number when
                // they were cited inline; uncited chunks have none, so fall
                // back to their raw chunk index for the label.
                const n = selection.numbers.get(citationNumberKey(c.toolCallId, c.chunkIndex));
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => {
                      const ref = parseClawCitationRef(c.token);
                      if (ref) onOpenCitation(ref, n ?? 0, selection.numbers);
                    }}
                    className={`rounded-md border px-2 py-1 text-[11px] font-medium tabular-nums transition-colors ${
                      c.key === chunk.key
                        ? "border-xyne-brand bg-xyne-brand text-xyne-fg-inverse shadow-sm"
                        : "border-xyne-border-subtle bg-xyne-surface-subtle text-xyne-fg-secondary hover:border-xyne-border hover:bg-xyne-surface"
                    }`}
                  >
                    {n ?? `#${c.chunkIndex}`}
                  </button>
                );
              })}
            </div>
          </details>
        )}

        <details className="group shrink-0 border-b border-xyne-border-subtle">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-xyne-fg-muted">
            <CaretRightIcon size={11} className="transition-transform group-open:rotate-90" />
            Tool input
          </summary>
          <div className="mt-2">
            <pre className="max-h-56 min-w-0 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] font-mono text-[12px] leading-relaxed text-xyne-fg-secondary">
              {argsText}
            </pre>
          </div>
        </details>

        <div className="flex min-h-[280px] flex-1 flex-col overflow-hidden  border border-xyne-brand/30 bg-xyne-surface shadow-sm">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-xyne-border-subtle bg-xyne-brand-ghost px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-xyne-brand">
              {selection.citationNumber > 0
                ? `Cited source ${selection.citationNumber}`
                : `Chunk #${chunk.chunkIndex}`}
            </p>
            <p className="min-w-0 truncate text-right text-[11px] text-xyne-fg-tertiary" title={chunk.title}>
              {chunk.title || "No title"}
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
            <pre className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] font-mono text-[12px] leading-relaxed text-xyne-fg-primary">
              {chunk.text || "(empty chunk)"}
            </pre>
          </div>
        </div>
      </div>
    </SidePanel>
  );
}

/* ── reasoning block ─────────────────────────────────────────────── */

export function ReasoningBlock({ text, streaming }: { text: string; streaming: boolean }) {
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
  // A subagent spawned with run_in_background: the wrapper tool call returned
  // immediately, so its live state lives in backgroundState (not status).
  const isBackground = invocation.background === true;
  const bgState = invocation.backgroundState;
  const isBgRunning = isBackground && bgState === "running";

  const containerClass = invocation.isError || bgState === "error"
    ? "border-red-300 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20"
    : isBgRunning
      ? "border-amber-300 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/10"
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
            {isBgRunning ? (
              // Detached background subagent still running — amber pulse, NOT the
              // blue dot of a blocking tool, so it reads as "fired and moved on".
              <span className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-500" />
            ) : (isRunning || runningChildren > 0) && !isBackground ? (
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500" />
            ) : null}
            {!isRunning && !isBgRunning && !isSubagent && (
              <WrenchIcon size={11} className="shrink-0 text-xyne-fg-tertiary" />
            )}
            {invocation.subagentName && (
              <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                {invocation.subagentName}
              </span>
            )}
            {isSubagent && <RobotIcon size={12} className="text-purple-500" />}
            {isBackground && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                {bgState === "error" ? "bg · failed" : bgState === "completed" ? "bg · done" : "⧗ background"}
              </span>
            )}
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
              {isRunning || isBgRunning ? "running…" : `${invocation.durationMs}ms`}
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
              {isRunning ? "⏳ waiting for result..." : isBgRunning ? "⏳ running in background…" : invocation.result || "(empty)"}
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

export function InvocationBlocks({ invocations }: { invocations: ToolInvocation[] }) {
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

/* ── branch pager ──────────────────────────────────────────────────
 *
 * `< 2/5 >` widget shown next to a message that has sibling branches. A
 * single pager scales to any branch count (vs. one button per sibling) and
 * stays compact in the timestamp row.
 * ─────────────────────────────────────────────────────────────────── */
function BranchPager({
  branchInfo,
  sending,
  onSelectBranch,
}: {
  branchInfo: MessageBranchInfo;
  sending: boolean;
  onSelectBranch: (parentId: string, messageId: string) => void;
}) {
  const currentIndex = branchInfo.choices.findIndex((choice) => choice.id === branchInfo.currentId);
  const previous = branchInfo.choices[currentIndex - 1];
  const next = branchInfo.choices[currentIndex + 1];
  return (
    <span className="inline-flex items-center gap-1 rounded border border-xyne-border-subtle bg-xyne-surface px-1 py-0.5">
      <button
        type="button"
        className="rounded px-1 text-[10px] leading-4 text-xyne-fg-muted transition-colors hover:text-xyne-fg-primary disabled:opacity-30"
        onClick={() => {
          if (previous) onSelectBranch(branchInfo.parentId, previous.id);
        }}
        disabled={sending || !previous}
      >
        &lt;
      </button>
      <span className="min-w-[34px] text-center text-[10px] leading-4 text-xyne-fg-muted">
        {currentIndex + 1}/{branchInfo.choices.length}
      </span>
      <button
        type="button"
        className="rounded px-1 text-[10px] leading-4 text-xyne-fg-muted transition-colors hover:text-xyne-fg-primary disabled:opacity-30"
        onClick={() => {
          if (next) onSelectBranch(branchInfo.parentId, next.id);
        }}
        disabled={sending || !next}
      >
        &gt;
      </button>
    </span>
  );
}

function PendingActionBlocks({
  actions,
  onApprove,
  onApproveAndContinue,
  onDecline,
}: {
  actions: PendingAction[];
  onApprove: (pa: PendingAction) => Promise<void> | void;
  onApproveAndContinue: (pa: PendingAction) => Promise<void> | void;
  onDecline: (pa: PendingAction) => void;
}) {
  return (
    <div data-id="pending-action-blocks" className="space-y-2">
      {actions.map((pa, idx) => (
        <PendingActionItem
          key={pa.signature || `${pa.serverType}-${pa.tool}-${idx}`}
          action={pa}
          onApprove={onApprove}
          onApproveAndContinue={onApproveAndContinue}
          onDecline={onDecline}
        />
      ))}
    </div>
  );
}

function PendingActionItem({
  action,
  onApprove,
  onApproveAndContinue,
  onDecline,
}: {
  action: PendingAction;
  onApprove: (pa: PendingAction) => Promise<void> | void;
  onApproveAndContinue: (pa: PendingAction) => Promise<void> | void;
  onDecline: (pa: PendingAction) => void;
}) {
  const [state, setState] = useState<"idle" | "running" | "running-continue" | "approved" | "declined" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const argsPreview = useMemo(() => {
    try {
      const s = JSON.stringify(action.params ?? {}, null, 2);
      return s.length > 300 ? `${s.slice(0, 300)}...` : s;
    } catch {
      return String(action.params);
    }
  }, [action.params]);

  const handleApprove = async () => {
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

  const handleApproveAndContinue = async () => {
    setState("running-continue");
    setError(null);
    try {
      await onApproveAndContinue(action);
      setState("approved");
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (state === "approved") {
    return (
      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-700">
        Approved: {humanizeToolName(action.tool)}
      </div>
    );
  }

  if (state === "declined") {
    return (
      <div className="rounded-md border border-xyne-border-subtle bg-xyne-surface-subtle px-2.5 py-1.5 text-[11px] text-xyne-fg-muted">
        Declined: {humanizeToolName(action.tool)}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5">
      <div className="mb-1 text-[11px] font-medium text-amber-700">
        Approval needed: {humanizeToolName(action.tool)}
      </div>
      <pre className="mb-2 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded bg-xyne-surface px-2 py-1 text-[10px] text-xyne-fg-tertiary">
        {argsPreview}
      </pre>
      {error && (
        <div className="mb-2 text-[10px] text-red-600">{error}</div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={state === "running" || state === "running-continue"}
          onClick={() => { void handleApprove(); }}
          className="rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {state === "running" ? "Approving..." : "Approve"}
        </button>
        <button
          type="button"
          disabled={state === "running" || state === "running-continue"}
          onClick={() => { void handleApproveAndContinue(); }}
          className="rounded-md bg-xyne-brand px-2.5 py-1 text-[11px] font-medium text-xyne-fg-inverse transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {state === "running-continue" ? "Approving + continuing..." : "Approve and continue"}
        </button>
        <button
          type="button"
          disabled={state === "running" || state === "running-continue"}
          onClick={() => {
            setState("declined");
            onDecline(action);
          }}
          className="rounded-md border border-xyne-border px-2.5 py-1 text-[11px] font-medium text-xyne-fg-primary transition-colors hover:bg-xyne-surface-subtle disabled:cursor-not-allowed disabled:opacity-60"
        >
          Decline
        </button>
      </div>
    </div>
  );
}

const PLAN_STATUS_CLASSES: Record<PlanTodo["status"], string> = {
  pending: "text-xyne-fg-muted",
  in_progress: "text-xyne-brand",
  completed: "text-xyne-success-fg",
  failed: "text-xyne-error-fg",
};

function PlanStatusIcon({ status }: { status: PlanTodo["status"] }) {
  if (status === "completed") return <CheckIcon size={13} weight="bold" />;
  if (status === "failed") return <XIcon size={13} weight="bold" />;
  if (status === "in_progress") return <ClockIcon size={13} weight="bold" />;
  return <DotsThreeIcon size={14} weight="bold" />;
}

function LivePlanCard({ todos }: { todos: PlanTodo[] }) {
  const done = todos.filter((todo) => todo.status === "completed").length;
  const failed = todos.filter((todo) => todo.status === "failed").length;

  return (
    <div className="w-full max-w-[520px] rounded-lg border border-xyne-border bg-xyne-surface px-3 py-2.5 text-[13px] text-xyne-fg-primary shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="font-medium">Plan</span>
        <span className="text-[11px] text-xyne-fg-muted">
          {done}/{todos.length} done{failed ? `, ${failed} failed` : ""}
        </span>
      </div>
      <div className="space-y-1.5">
        {todos.map((todo, index) => (
          <div key={todo.id || index} className="flex min-w-0 items-start gap-2">
            <span className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center ${PLAN_STATUS_CLASSES[todo.status]}`}>
              <PlanStatusIcon status={todo.status} />
            </span>
            <span className={`min-w-0 break-words leading-snug ${todo.status === "in_progress" ? "font-medium" : ""}`}>
              {todo.title}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── message thread ──────────────────────────────────────────────── */

/** Rating-relevant slice of the AgentRun that produced an assistant message. */
type RunRatingInfo = {
  sessionId: string;
  rating: "up" | "down" | null;
  ratingComment: string | null;
};

/** Build the assistant-message-id → run-rating map from a list of AgentRuns.
 *  Keyed by chatMessageId (set on run finalize), which is the stable link
 *  between an assistant message and the run that produced it under branching. */
function buildRunByMsgId(
  runs: Array<{ chatMessageId?: string | null; sessionId: string; rating?: "up" | "down" | null; ratingComment?: string | null }>,
): Map<string, RunRatingInfo> {
  const next = new Map<string, RunRatingInfo>();
  for (const r of runs) {
    if (r.chatMessageId) {
      next.set(r.chatMessageId, {
        sessionId: r.sessionId,
        rating: r.rating ?? null,
        ratingComment: r.ratingComment ?? null,
      });
    }
  }
  return next;
}

function MessageThread({
  messages,
  sending,
  toolLabel,
  agent,
  userAbbr,
  streamingMsgId,
  liveInvocations,
  livePlanTodos,
  liveReasoning,
  invocationsByMsgId,
  reasoningByMsgId,
  selectedCitationKey,
  onOpenTurnDebugger,
  onOpenCitation,
  branchInfoByMsgId,
  onSelectBranch,
  onRegenerate,
  latestUserMessageId,
  onEditUserMessage,
  pendingActionsByMsgId,
  onApproveAction,
  onApproveAndContinueAction,
  onDeclineAction,
  userId,
  runByMsgId,
  onRated,
  hideHtmlSource = false,
  designVersionByMessageId,
  onSelectDesignVersion,
}: {
  messages: ChatMsg[];
  sending: boolean;
  toolLabel: string | null;
  agent: AgentLight;
  userAbbr: string;
  streamingMsgId: string | null;
  liveInvocations: ToolInvocation[];
  livePlanTodos: PlanTodo[];
  liveReasoning: string;
  invocationsByMsgId: Map<string, ToolInvocation[]>;
  reasoningByMsgId: Map<string, string>;
  selectedCitationKey: string | null;
  /** turnIndex stays for back-compat (debugger title); assistantMessageId is
   *  the authoritative selector so the drawer can pick the right run by
   *  sessionId under branching. */
  onOpenTurnDebugger: (turnIndex: number, live: boolean, assistantMessageId: string) => void;
  onOpenCitation: (citation: CitationRef, citationNumber: number, numbers: Map<string, number>) => void;
  branchInfoByMsgId: Map<string, MessageBranchInfo>;
  onSelectBranch: (parentId: string, messageId: string) => void;
  onRegenerate: (assistantMessageId: string) => void;
  latestUserMessageId: string | null;
  onEditUserMessage: (userMessageId: string, text: string) => void;
  pendingActionsByMsgId: Map<string, PendingAction[]>;
  onApproveAction: (msgId: string, action: PendingAction) => Promise<void>;
  onApproveAndContinueAction: (msgId: string, action: PendingAction) => Promise<void>;
  onDeclineAction: (msgId: string, action: PendingAction) => void;
  userId: string;
  runByMsgId: Map<string, RunRatingInfo>;
  onRated: (msgId: string, rating: "up" | "down", comment?: string) => void;
  /** Design consumes fenced HTML in the preview, so do not duplicate the
   *  entire source document inside the adjacent conversation panel. */
  hideHtmlSource?: boolean;
  designVersionByMessageId?: Map<string, DesignVersion>;
  onSelectDesignVersion?: (index: number) => void;
}) {
  // Inline edit state for the latest visible user message. Older messages are
  // intentionally not editable — see comment in useChat.editLatestUserMessage.
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);
  const safeInvocationsByMsgId = invocationsByMsgId ?? new Map<string, ToolInvocation[]>();
  // Conversation-wide flat union of every turn's tool invocations. Citations are
  // SESSION-scoped: a follow-up turn frequently re-cites a `[clf-…]` chunk from a
  // tool call in an EARLIER turn (the tool isn't re-run this turn). CitationMarkdown
  // gates token rendering on the tool-call ids it's given, so it must see the whole
  // conversation's invocations — not just the current message's — or cross-turn
  // tokens get stripped. Resolution (`citationIndex`) is already conversation-wide.
  const allConversationInvocations = useMemo(() => {
    const out: ToolInvocation[] = [];
    for (const list of safeInvocationsByMsgId.values()) out.push(...list);
    out.push(...liveInvocations);
    return out;
  }, [safeInvocationsByMsgId, liveInvocations]);
  const safeReasoningByMsgId = reasoningByMsgId ?? new Map<string, string>();
  const safePendingActionsByMsgId = pendingActionsByMsgId ?? new Map<string, PendingAction[]>();
  // Tracks whether the user is at (or very near) the bottom of the thread.
  // Updated on every scroll event. Used by the auto-scroll effect below to
  // decide whether to stay pinned to the bottom as new streamed tokens land —
  // if the user has scrolled up to re-read something earlier, we leave them
  // alone instead of yanking them back down on every delta.
  const isPinnedToBottomRef = useRef(true);
  // 64px slack: small enough to detect a deliberate scroll-up, large enough
  // to absorb rounding and the browser's scroll-anchor behavior on append.
  const PIN_THRESHOLD_PX = 64;
  // Shows the "jump to latest" pill only when the user is actively scrolled
  // up AND new content is arriving — otherwise it'd just be visual noise.
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  const updatePinState = useCallback(() => {
    const el = threadRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const pinned = distanceFromBottom <= PIN_THRESHOLD_PX;
    isPinnedToBottomRef.current = pinned;
    setShowJumpToBottom(!pinned);
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    isPinnedToBottomRef.current = true;
    setShowJumpToBottom(false);
  }, []);

  // Auto-scroll only when the user is already at the bottom. The dependency
  // array still tracks every streaming surface (messages / sending / toolLabel
  // / liveInvocations / liveReasoning) so the scroll fires on every new token,
  // tool call, or reasoning chunk — but the pin check inside gates the actual
  // scroll write.
  useEffect(() => {
    if (isPinnedToBottomRef.current) {
      const el = threadRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages, sending, toolLabel, liveInvocations, liveReasoning]);

  // When the user submits a new message, snap back to the bottom regardless
  // of where they were. Their own send is an intent signal — they want to see
  // what they just sent and the agent's response, not stay parked in history.
  const lastMessageId = messages.at(-1)?.id;
  const lastMessageRole = messages.at(-1)?.role;
  useEffect(() => {
    if (lastMessageRole === "user") {
      scrollToBottom();
    }
    // Only react when the LAST message changes (a brand-new message arrived),
    // not on every keystroke / streaming delta into the same assistant message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMessageId, lastMessageRole]);

  const lastMsg = messages.at(-1);
  const isStreaming = lastMsg?.status === "streaming";
  // Last assistant on the visible path — the only one with a "Regenerate"
  // button. Older assistants are reachable via the branch pager instead.
  const lastAssistantId = [...messages].reverse().find((msg) => msg.role === "assistant")?.id;

  return (
    // min-h-0 on the wrapper is REQUIRED — flex children default to
    // `min-height: auto`, which lets the inner thread expand to fit its
    // content and silently disables the overflow-y-auto on it. With min-h-0
    // the wrapper is allowed to shrink below content size so the inner div's
    // overflow actually kicks in and the page scrolls.
    <div className="relative flex flex-1 flex-col min-h-0">
    <div
      ref={threadRef}
      data-id="message-thread"
      className="flex-1 overflow-y-auto px-4 py-5"
      onScroll={updatePinState}
    >
      {/* Center the messages on wide screens — same column width as the
          input below so the conversation reads as a single centered stack. */}
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      {messages.map((msg, messageIndex) => {
        const isUser = msg.role === "user";
        const isStream = msg.status === "streaming" || msg.id === streamingMsgId;
        const assistantTurnIndex = messages.slice(0, messageIndex + 1).filter((message) => message.role === "assistant").length - 1;
        const ts = fmtTime(msg.createdAt);
        const branchInfo = branchInfoByMsgId.get(msg.id);

        if (isUser) {
          const isEditing = editingUserId === msg.id;
          return (
            <div key={msg.id} data-id="user-message" className="flex flex-row-reverse items-end gap-2">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-xyne-fg-primary text-[9px] font-bold text-xyne-fg-inverse">
                {userAbbr}
              </div>
              <div className="flex flex-col items-end gap-1" style={{ maxWidth: "75%" }}>
                {isEditing ? (
                  <div className="flex w-[min(520px,75vw)] flex-col gap-2 rounded-[14px] rounded-tr-[4px] bg-xyne-brand px-3 py-2.5">
                    <textarea
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      className="min-h-[72px] resize-y rounded border border-white/20 bg-black/10 px-2 py-1.5 text-[14px] leading-relaxed text-xyne-fg-inverse outline-none placeholder:text-white/60"
                      autoFocus
                    />
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        className="rounded px-2 py-1 text-[11px] text-white/80 hover:bg-white/10"
                        onClick={() => {
                          setEditingUserId(null);
                          setEditingText("");
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="rounded bg-white px-2 py-1 text-[11px] font-medium text-xyne-brand disabled:opacity-50"
                        disabled={!editingText.trim() || editingText.trim() === msg.content.trim() || sending}
                        onClick={() => {
                          onEditUserMessage(msg.id, editingText);
                          setEditingUserId(null);
                          setEditingText("");
                        }}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap rounded-[14px] rounded-tr-[4px] bg-xyne-brand px-4 py-2.5 text-[14px] leading-relaxed text-xyne-fg-inverse">
                    {stripMalformedCitations(msg.content)}
                  </div>
                )}
                {msg.attachments && msg.attachments.length > 0 && (
                  <ChatAttachmentList attachments={msg.attachments} userId={userId} align="right" />
                )}
                {/* Read-only attached-context chip below the message — collapsed
                    by default, expands left into a horizontal scroll strip.
                    Mirrors the Ask AI (Spaces) design. */}
                {!isEditing && msg.contextItems && msg.contextItems.length > 0 && (
                  <ReadonlyContextPills items={msg.contextItems} expandedWidthClass="max-w-[24rem]" />
                )}
                {ts && (
                  <span className="mr-1 flex items-center gap-1 text-[11px] text-xyne-fg-muted">
                    <TimerIcon size={10} />
                    {ts}
                    {/* Edit affordance — visible only on the latest user, and
                        only when nothing's streaming. Older edits would re-root
                        the tree, so we don't expose them. */}
                    {msg.id === latestUserMessageId && !sending && !isEditing && (
                      <button
                        type="button"
                        className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded border border-xyne-border-subtle text-xyne-fg-muted transition-colors hover:border-xyne-border-strong hover:text-xyne-fg-primary"
                        title="Edit message"
                        onClick={() => {
                          setEditingUserId(msg.id);
                          setEditingText(msg.content);
                        }}
                      >
                        <PencilSimpleIcon size={12} />
                      </button>
                    )}
                    {branchInfo && (
                      <BranchPager
                        branchInfo={branchInfo}
                        sending={sending}
                        onSelectBranch={onSelectBranch}
                      />
                    )}
                  </span>
                )}
              </div>
            </div>
          );
        }

        // Source of truth for tool calls + reasoning:
        // - For the currently-streaming message: pull from live state (updates every SSE event).
        // - For older finalized messages: pull from the per-message persisted maps.
        const msgInvocations = isStream ? liveInvocations : safeInvocationsByMsgId.get(msg.id) ?? [];
        const msgReasoning = isStream ? liveReasoning : safeReasoningByMsgId.get(msg.id);
        const msgPendingActions = safePendingActionsByMsgId.get(msg.id) ?? [];
        const runInfo = runByMsgId.get(msg.id);

        const hasInvocations = msgInvocations.length > 0;
        const hasPlan = isStream && livePlanTodos.length > 0;
        const hasReasoning = !!msgReasoning && msgReasoning.length > 0;
        const displayContent = hideHtmlSource ? designChatContent(msg.content) : msg.content;
        const hasText = displayContent.length > 0;
        const showThinkingPill = isStream && !hasInvocations && !hasReasoning && !hasText;
        const designVersion = designVersionByMessageId?.get(msg.id);

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

              {msg.status === "cancelled" && !hasText && !hasInvocations && !hasReasoning && (
                <div className="inline-flex w-fit items-center gap-1.5 rounded-full bg-xyne-surface px-3 py-1.5 text-[11px] text-xyne-fg-muted ring-1 ring-xyne-border-subtle">
                  <StopIcon size={10} />
                  <span>Stopped</span>
                </div>
              )}

              {hasReasoning && (
                <ReasoningBlock text={msgReasoning!} streaming={isStream} />
              )}

              {hasPlan && <LivePlanCard todos={livePlanTodos} />}

              {hasInvocations && <InvocationBlocks invocations={msgInvocations} />}

              {msgPendingActions.length > 0 && (
                <PendingActionBlocks
                  actions={msgPendingActions}
                  onApprove={(pa) => onApproveAction(msg.id, pa)}
                  onApproveAndContinue={(pa) => onApproveAndContinueAction(msg.id, pa)}
                  onDecline={(pa) => onDeclineAction(msg.id, pa)}
                />
              )}

              {hasText && (
                <div
                  className="rounded-[14px] rounded-tl-[4px] border border-xyne-border bg-xyne-surface px-4 py-2.5 text-[14px] leading-relaxed text-xyne-fg-primary"
                  style={{
                    color: msg.status === "error" ? "var(--color-error, #dc2626)" : undefined,
                  }}
                >
                  <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:my-2">
                    <CitationMarkdown
                      content={displayContent}
                      invocations={allConversationInvocations}
                      selectedCitationKey={selectedCitationKey}
                      onOpenCitation={onOpenCitation}
                    />
                  </div>
                  {isStream && (
                    <span className="ml-1 inline-block h-3 w-1 translate-y-[1px] animate-pulse bg-xyne-fg-muted" />
                  )}
                </div>
              )}

              {msg.attachments && msg.attachments.length > 0 && (
                <ChatAttachmentList attachments={msg.attachments} userId={userId} />
              )}

              {ts && !isStream && (hasText || hasInvocations || (msg.attachments?.length ?? 0) > 0) && (
                <div className="ml-1 flex items-center gap-2 text-[11px] text-xyne-fg-muted">
                  <span className="flex items-center gap-1">
                    <TimerIcon size={10} />
                    {ts}
                  </span>
                  {/* Regenerate — only on the LATEST visible assistant. Older
                      branches stay reachable via the pager below; regen on an
                      older sibling would shadow the visible chain. */}
                  {msg.id === lastAssistantId && (
                    <button
                      type="button"
                      className="inline-flex h-5 w-5 items-center justify-center rounded border border-xyne-border-subtle text-xyne-fg-muted transition-colors hover:border-xyne-border-strong hover:text-xyne-fg-primary disabled:opacity-50"
                      title="Regenerate response"
                      onClick={() => onRegenerate(msg.id)}
                      disabled={sending}
                    >
                      <ArrowsClockwiseIcon size={12} />
                    </button>
                  )}
                  {branchInfo && (
                    <BranchPager
                      branchInfo={branchInfo}
                      sending={sending}
                      onSelectBranch={onSelectBranch}
                    />
                  )}
                  {designVersion && onSelectDesignVersion && (
                    <button
                      type="button"
                      data-id="message-design-version-chip"
                      onClick={() => onSelectDesignVersion(Number(designVersion.label.slice(1)) - 1)}
                      className="inline-flex h-5 items-center rounded border border-xyne-brand/25 bg-xyne-brand/5 px-1.5 text-[10px] font-semibold text-xyne-brand transition-colors hover:bg-xyne-brand/10"
                      title={`Preview ${designVersion.label}`}
                    >
                      {designVersion.label}
                    </button>
                  )}
                </div>
              )}
              <div className="ml-1 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onOpenTurnDebugger(assistantTurnIndex, isStream, msg.id)}
                  className="inline-flex w-fit items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-xyne-fg-muted transition hover:bg-xyne-surface hover:text-xyne-fg-secondary"
                >
                  <ChartBarIcon size={11} /> Debug this response
                </button>
                {/* Per-message 👍/👎 — only once the run is finalized and linked
                    (chatMessageId is set on finalize, so it appears after the
                    turn completes). */}
                {!isStream && runInfo && (
                  <MessageRatingButtons
                    userId={userId}
                    sessionId={runInfo.sessionId}
                    rating={runInfo.rating}
                    ratingComment={runInfo.ratingComment}
                    onRated={(rating, comment) => onRated(msg.id, rating, comment)}
                  />
                )}
              </div>
            </div>
          </div>
        );
      })}

      {sending && !isStreaming && lastMsg?.role === "user" && (
        <TypingIndicator agent={agent} />
      )}
      </div>
    </div>
    {showJumpToBottom && (
      <button
        type="button"
        onClick={scrollToBottom}
        data-id="jump-to-latest"
        // Pinned to the bottom-center of the thread viewport — sits above the
        // composer and out of the way of message content. Only mounts while
        // the user is scrolled up, so it doesn't compete with the typing
        // indicator or the last message in steady-state.
        className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 flex items-center gap-1.5 rounded-full border border-xyne-border-subtle bg-xyne-bg-elevated/95 px-3 py-1.5 text-[12px] font-medium text-xyne-fg-secondary shadow-md backdrop-blur-sm transition-opacity hover:text-xyne-fg-primary"
        aria-label="Jump to latest message"
      >
        <ArrowDownIcon size={12} weight="bold" />
        {isStreaming ? "New replies below" : "Jump to latest"}
      </button>
    )}
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
  agent?: AgentLight | null;
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
  activeAgent: AgentLight | null;
  agents: AgentLight[];
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
          More than a hyperlink: branded icon chip + title + "{N} subagents"
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
              {agents.length} subagent{agents.length !== 1 ? "s" : ""} available
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
  userAbbr,
  messageCount,
  onOpenSettings,
  onOpenDashboard,
  onOpenDebugger,
}: {
  agent: AgentLight;
  convTitle?: string;
  /** Active conversation id — used to fetch per-conversation token totals. */
  conversationId: string | undefined;
  userId: string;
  userAbbr: string;
  messageCount: number;
  onOpenSettings: () => void;
  onOpenDashboard: () => void;
  onOpenDebugger: () => void;
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
          <button
            type="button"
            data-id="center-debug-btn"
            onClick={onOpenDebugger}
            title="Open debugger"
            aria-label="Open debugger"
            disabled={!conversationId}
            className="flex h-9 items-center justify-center rounded-full border border-xyne-border-subtle bg-xyne-surface px-3 text-[12px] font-medium text-xyne-fg-secondary shadow-sm transition-all hover:border-xyne-border hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Debug
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
  previewUrl: string | null;
}

export interface InputAreaProps {
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
  /** Per-chat provider fast mode (optional — only the agent chat wires it).
   *  Rendered as a ⚡ pill in the button row next to attach / mention. */
  fastMode?: boolean;
  onToggleFastMode?: (enabled: boolean) => void;
  /** Combined model + thinking picker (optional — only the agent chat wires
   *  it). Rendered in the button row after the fast-mode pill. */
  modelMenu?: React.ReactNode;
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
export const InputArea = forwardRef<InputAreaHandle, InputAreaProps>(function InputArea(
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
    fastMode,
    onToggleFastMode,
    modelMenu,
  },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);

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
    // While sending, Enter is a no-op: the stop button handles cancellation,
    // and absorbing the keypress here prevents the input from inserting a newline.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!sending) onSend();
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

  const hasDraggedFiles = (event: React.DragEvent): boolean =>
    Array.from(event.dataTransfer.types).includes("Files");

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingFiles(true);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingFiles(false);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) onAddFiles(files);
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
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`relative rounded-3xl border bg-xyne-surface px-4 pb-2.5 pt-3 shadow-[0_8px_28px_-12px_rgba(0,0,0,0.18)] transition-all focus-within:shadow-[0_10px_32px_-12px_rgba(0,0,0,0.22)] ${
            isDraggingFiles
              ? "border-xyne-brand ring-2 ring-xyne-brand/20"
              : "border-xyne-border-subtle focus-within:border-xyne-border"
          }`}
        >
          {isDraggingFiles && (
            <div className="pointer-events-none absolute inset-1 z-20 flex items-center justify-center rounded-[20px] border border-dashed border-xyne-brand bg-xyne-surface/95 text-[13px] font-medium text-xyne-brand backdrop-blur-sm">
              Drop files to attach
            </div>
          )}
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
                  {p.previewUrl ? (
                    <img
                      src={p.previewUrl}
                      alt=""
                      className="h-4 w-4 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-xyne-surface text-xyne-fg-muted">
                      <FileIcon size={10} />
                    </span>
                  )}
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
                multiple
                onChange={handleFilePick}
                className="hidden"
              />
              <button
                type="button"
                data-id="input-btn-attach"
                title="Attach files"
                aria-label="Attach files"
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
              {onToggleFastMode && (
                <button
                  type="button"
                  data-id="fast-mode-toggle"
                  data-enabled={fastMode ? "1" : "0"}
                  role="switch"
                  aria-checked={!!fastMode}
                  aria-label="Use fast mode"
                  title={fastMode
                    ? "Fast mode ON for this chat — click to use the agent's default"
                    : "Fast mode OFF (agent default) — click for faster output from the provider's fast tier"}
                  onClick={() => onToggleFastMode(!fastMode)}
                  className={`flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-colors ${
                    fastMode
                      ? "bg-amber-500 text-white hover:bg-amber-600"
                      : "bg-xyne-surface-subtle text-xyne-fg-tertiary hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
                  }`}
                >
                  <LightningIcon size={13} weight={fastMode ? "fill" : "bold"} />
                  Fast mode
                </button>
              )}
              {modelMenu}
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
function deriveSamplePrompts(agent: AgentLight): string[] {
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
  agents: AgentLight[];
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
  agents: AgentLight[];
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
          Your roster of AI subagents. Pick one, give them a task, and they'll get it done — using
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
  agents: AgentLight[];
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

type DesignPreviewSource =
  | { kind: "attachment"; attachment: ChatAttachmentMeta }
  | { kind: "inline"; html: string; fileName: string };

type DesignVersion = {
  source: DesignPreviewSource;
  projectAttachment?: ChatAttachmentMeta;
  messageId: string;
  messageIndex: number;
  createdAt: string;
  label: string;
};

const DESIGN_STUDIO_COMPAT_INSTRUCTION = `Design Studio compatibility fallback: if this run does not include the server-owned /design command contract, create or revise a complete responsive self-contained HTML document. Return the complete document in one fenced html code block so the preview can render it. Use available sandbox and delivery tools when present. Do not ask for a plan or storyboard approval.`;

export interface DesignNodeSelection {
  selector: string;
  tagName: string;
  label: string;
  id?: string;
  classes: string[];
  text: string;
  ancestors: string[];
  styles: Record<string, string>;
  rect: { x: number; y: number; width: number; height: number };
}

export type DesignEditScope = "element" | "component" | "design-system";

export interface DesignManualEdit {
  selector: string;
  oldText?: string;
  newText?: string;
  styles?: Record<string, string>;
  stale?: boolean;
}

export interface AppliedManualEdits {
  html: string;
  edits: DesignManualEdit[];
}

const DESIGN_INSPECTOR_EVENT = "xyne-design-node-selected";
const DESIGN_INSPECTOR_MODE_EVENT = "xyne-design-inspector-mode";
const DESIGN_EDIT_EVENT = "xyne-design-text-edited";

function serializeDesignDocument(document: Document): string {
  const doctype = document.doctype;
  const serializedDoctype = doctype
    ? `<!DOCTYPE ${doctype.name}${doctype.publicId ? ` PUBLIC "${doctype.publicId}"` : ""}${
        doctype.systemId ? `${doctype.publicId ? "" : " SYSTEM"} "${doctype.systemId}"` : ""
      }>`
    : "";
  return `${serializedDoctype}${document.documentElement.outerHTML}`;
}

/** Applies text/style edits without string-splicing the artifact. Stale edits remain
 * in the returned list so callers can preserve and surface their status. */
export function applyManualEdits(html: string, edits: DesignManualEdit[]): AppliedManualEdits {
  const document = new DOMParser().parseFromString(html, "text/html");
  const appliedEdits = edits.map((edit) => {
    let element: Element | null = null;
    try {
      element = document.querySelector(edit.selector);
    } catch {
      // A malformed selector is stale just like one that no longer matches.
    }
    if (!element) {
      return { ...edit, stale: true };
    }
    if (edit.styles) {
      if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) {
        return { ...edit, stale: true };
      }
      for (const [property, value] of Object.entries(edit.styles)) {
        element.style.setProperty(property, value);
      }
      return { ...edit, stale: false };
    }
    if (
      typeof edit.oldText !== "string" || typeof edit.newText !== "string" ||
      (element.textContent ?? "").trim() !== edit.oldText.trim()
    ) {
      return { ...edit, stale: true };
    }
    element.textContent = edit.newText;
    return { ...edit, stale: false };
  });
  return { html: serializeDesignDocument(document), edits: appliedEdits };
}

function normalizeDesignNodeSelection(input: unknown): DesignNodeSelection | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  if (typeof value["selector"] !== "string" || typeof value["tagName"] !== "string") return null;
  const strings = (candidate: unknown, limit: number, itemLimit: number): string[] =>
    Array.isArray(candidate)
      ? candidate.filter((item): item is string => typeof item === "string").slice(0, limit).map((item) => item.slice(0, itemLimit))
      : [];
  const styles = Object.fromEntries(
    Object.entries(value["styles"] && typeof value["styles"] === "object" ? value["styles"] as Record<string, unknown> : {})
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .slice(0, 30)
      .map(([key, styleValue]) => [key.slice(0, 80), styleValue.slice(0, 240)]),
  );
  const rawRect = value["rect"] && typeof value["rect"] === "object"
    ? value["rect"] as Record<string, unknown>
    : {};
  const number = (candidate: unknown): number =>
    typeof candidate === "number" && Number.isFinite(candidate) ? Math.round(candidate) : 0;
  const selector = value["selector"].slice(0, 600);
  const tagName = value["tagName"].slice(0, 80);
  return {
    selector,
    tagName,
    label: typeof value["label"] === "string" ? value["label"].slice(0, 240) : tagName,
    ...(typeof value["id"] === "string" ? { id: value["id"].slice(0, 160) } : {}),
    classes: strings(value["classes"], 16, 120),
    text: typeof value["text"] === "string" ? value["text"].slice(0, 1200) : "",
    ancestors: strings(value["ancestors"], 6, 600),
    styles,
    rect: {
      x: number(rawRect["x"]),
      y: number(rawRect["y"]),
      width: number(rawRect["width"]),
      height: number(rawRect["height"]),
    },
  };
}

/** Inject a tiny, isolated selection and text-edit bridge into the generated artifact. */
function withDesignInspector(html: string): string {
  const inspector = String.raw`
(function () {
  if (window.__xyneDesignInspector) return;
  window.__xyneDesignInspector = true;
  var enabled = false;
  var editingElement = null;
  var editingOriginalText = '';
  var editingOutline = '';
  var editingOutlineOffset = '';
  var clickTimer = null;
  var overlay = document.createElement('div');
  overlay.setAttribute('data-xyne-design-inspector', 'true');
  overlay.style.cssText = 'position:fixed;display:none;pointer-events:none;z-index:2147483647;border:2px solid #7657ff;background:rgba(118,87,255,.09);box-shadow:0 0 0 1px rgba(255,255,255,.7) inset;border-radius:3px;transition:all 60ms linear';

  function mount() {
    if (!overlay.isConnected && document.body) document.body.appendChild(overlay);
  }
  function esc(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }
  function selectorFor(element) {
    if (element.id) return '#' + esc(element.id);
    var dataId = element.getAttribute('data-id');
    if (dataId) return '[data-id="' + String(dataId).replace(/"/g, '\\"') + '"]';
    var parts = [];
    var current = element;
    while (current && current.nodeType === 1 && current !== document.documentElement && parts.length < 6) {
      var part = current.tagName.toLowerCase();
      var classes = Array.prototype.slice.call(current.classList || []).filter(function (name) {
        return name && name.length < 48 && !/^active$|^hover$|^focus$/.test(name);
      }).slice(0, 2);
      if (classes.length) part += '.' + classes.map(esc).join('.');
      var parent = current.parentElement;
      if (parent) {
        var siblings = Array.prototype.filter.call(parent.children, function (node) { return node.tagName === current.tagName; });
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
      }
      parts.unshift(part);
      current = parent;
    }
    return parts.join(' > ');
  }
  function shortName(element) {
    var value = element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent || '';
    value = value.replace(/\s+/g, ' ').trim().slice(0, 80);
    return element.tagName.toLowerCase() + (value ? ' · ' + value : '');
  }
  function moveOverlay(element) {
    mount();
    var rect = element.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.left = rect.left + 'px';
    overlay.style.top = rect.top + 'px';
    overlay.style.width = Math.max(0, rect.width) + 'px';
    overlay.style.height = Math.max(0, rect.height) + 'px';
  }
  function describe(element) {
    var style = getComputedStyle(element);
    var rect = element.getBoundingClientRect();
    var styleNames = ['display','position','font-family','font-size','font-weight','line-height','color','background-color','fill','stroke','border-radius','border','padding','margin','gap','width','height','max-width','justify-content','align-items','grid-template-columns'];
    var styles = {};
    styleNames.forEach(function (name) {
      var value = style.getPropertyValue(name);
      if (value) styles[name] = value.trim();
    });
    var ancestors = [];
    var parent = element.parentElement;
    while (parent && parent !== document.documentElement && ancestors.length < 4) {
      ancestors.unshift(selectorFor(parent));
      parent = parent.parentElement;
    }
    return {
      selector: selectorFor(element),
      tagName: element.tagName.toLowerCase(),
      label: shortName(element),
      id: element.id || undefined,
      classes: Array.prototype.slice.call(element.classList || []).slice(0, 12),
      text: String(element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500),
      ancestors: ancestors,
      styles: styles,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
    };
  }
  function canEditText(element) {
    if (element === overlay || element.isContentEditable) return false;
    var text = String(element.textContent || '');
    if (text.trim().length < 2) return false;
    var allowed = { A: true, B: true, I: true, SPAN: true, STRONG: true, EM: true };
    return Array.prototype.every.call(element.querySelectorAll('*'), function (child) { return allowed[child.tagName] === true; });
  }
  function finishEditing(commit) {
    if (!editingElement) return;
    var element = editingElement;
    var originalText = editingOriginalText;
    var newText = String(element.textContent || '');
    editingElement = null;
    if (!commit) element.textContent = originalText;
    element.removeAttribute('contenteditable');
    element.style.outline = editingOutline;
    element.style.outlineOffset = editingOutlineOffset;
    if (commit && newText !== originalText) {
      window.parent.postMessage({
        type: '${DESIGN_EDIT_EVENT}',
        edit: { selector: selectorFor(element), oldText: originalText, newText: newText }
      }, '*');
    }
  }
  function beginEditing(element) {
    if (!canEditText(element)) return;
    if (editingElement) finishEditing(true);
    editingElement = element;
    editingOriginalText = String(element.textContent || '');
    editingOutline = element.style.outline;
    editingOutlineOffset = element.style.outlineOffset;
    element.setAttribute('contenteditable', 'true');
    element.style.outline = '2px dashed #7657ff';
    element.style.outlineOffset = '2px';
    element.focus();
    var selection = window.getSelection();
    var range = document.createRange();
    range.selectNodeContents(element);
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }
  window.addEventListener('message', function (event) {
    if (!event.data || event.data.type !== '${DESIGN_INSPECTOR_MODE_EVENT}') return;
    enabled = event.data.enabled === true;
    document.documentElement.style.cursor = enabled ? 'crosshair' : '';
    if (!enabled) {
      if (editingElement) finishEditing(true);
      overlay.style.display = 'none';
    }
  });
  document.addEventListener('mousemove', function (event) {
    if (!enabled || editingElement) return;
    var target = event.target;
    if (!(target instanceof Element) || target === overlay) return;
    moveOverlay(target);
  }, true);
  document.addEventListener('click', function (event) {
    if (!enabled) return;
    var target = event.target;
    if (!(target instanceof Element) || target === overlay) return;
    if (editingElement && editingElement.contains(target)) return;
    event.preventDefault();
    event.stopPropagation();
    moveOverlay(target);
    if (clickTimer) window.clearTimeout(clickTimer);
    clickTimer = window.setTimeout(function () {
      clickTimer = null;
      window.parent.postMessage({ type: '${DESIGN_INSPECTOR_EVENT}', selection: describe(target) }, '*');
    }, 220);
  }, true);
  document.addEventListener('dblclick', function (event) {
    if (!enabled) return;
    var target = event.target;
    if (!(target instanceof Element) || !canEditText(target)) return;
    event.preventDefault();
    event.stopPropagation();
    if (clickTimer) {
      window.clearTimeout(clickTimer);
      clickTimer = null;
    }
    beginEditing(target);
  }, true);
  document.addEventListener('focusout', function (event) {
    if (editingElement && event.target === editingElement) finishEditing(true);
  }, true);
  document.addEventListener('keydown', function (event) {
    if (editingElement && event.target instanceof Node && editingElement.contains(event.target)) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finishEditing(false);
      } else if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        finishEditing(true);
      }
      return;
    }
    if (event.key === 'Escape') {
      enabled = false;
      overlay.style.display = 'none';
      document.documentElement.style.cursor = '';
      window.parent.postMessage({ type: '${DESIGN_INSPECTOR_MODE_EVENT}', enabled: false }, '*');
    }
  }, true);
  mount();
})();`;
  const tag = `<script data-xyne-design-inspector>${inspector}<\/script>`;
  return /<\/body\s*>/i.test(html)
    ? html.replace(/<\/body\s*>/i, `${tag}</body>`)
    : `${html}${tag}`;
}

function htmlFromMessage(message: ChatMsg): string | null {
  // Accept a closing fence or the still-streaming remainder. This lets the
  // preview update while the model is emitting a long HTML document.
  // LAST fence wins: the /design contract drafts the document in an early
  // fence (live WIP preview) and may emit a corrected fence after browser QA —
  // the later one is the truth.
  const matches = [...message.content.matchAll(/```html\s*([\s\S]*?)(?:```|$)/gi)];
  const html = matches.length ? matches[matches.length - 1]?.[1]?.trim() : undefined;
  if (!html || (!/<html[\s>]/i.test(html) && !/<!doctype\s+html/i.test(html))) return null;
  return html;
}

function designChatContent(content: string): string {
  const hadHtml = /```html\s*/i.test(content);
  const withoutHtml = content.replace(/```html\s*[\s\S]*?(?:```|$)/gi, "").trim();
  return withoutHtml || (hadHtml ? "Design updated in preview." : content);
}

function designVersionFileName(version: DesignVersion): string {
  return version.source.kind === "attachment"
    ? version.source.attachment.originalFilename
    : version.source.fileName;
}

function designVersions(messages: ChatMsg[]): DesignVersion[] {
  const versions: DesignVersion[] = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (!message || message.role !== "assistant") continue;
    const attachment = [...(message.attachments ?? [])].reverse().find((item) =>
      item.mimeType.toLowerCase().includes("text/html") || item.originalFilename.toLowerCase().endsWith(".html"),
    );
    const projectAttachment = [...(message.attachments ?? [])].reverse().find((item) => {
      const name = item.originalFilename.toLowerCase();
      const archive = name.endsWith(".zip") || name.endsWith(".tar.gz") || name.endsWith(".tgz");
      return archive && /(react|source|project)/.test(name);
    });
    const source: DesignPreviewSource | null = attachment
      ? { kind: "attachment", attachment }
      : (() => {
          const html = htmlFromMessage(message);
          return html ? { kind: "inline", html, fileName: "xyne-design.html" } : null;
        })();
    if (!source) continue;
    versions.push({
      source,
      ...(projectAttachment ? { projectAttachment } : {}),
      messageId: message.id,
      messageIndex: i,
      createdAt: message.createdAt,
      label: `v${versions.length + 1}`,
    });
  }
  return versions;
}

function cssColorToHex(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const normalized = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(normalized)) return normalized;
  const match = /^rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i.exec(normalized);
  if (!match) return fallback;
  return `#${[match[1], match[2], match[3]]
    .map((part) => Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, "0"))
    .join("")}`;
}

function cssNumber(value: string | undefined, fallback = "0"): string {
  const match = /-?\d+(?:\.\d+)?/.exec(value ?? "");
  return match?.[0] ?? fallback;
}

function DesignStyleInspector({
  selection,
  onApply,
  onClose,
}: {
  selection: DesignNodeSelection;
  onApply: (property: string, value: string) => void;
  onClose: () => void;
}) {
  const isSvg = selection.tagName === "svg" || selection.tagName === "path" || selection.tagName === "circle" || selection.tagName === "rect";
  const [fontSize, setFontSize] = useState(cssNumber(selection.styles["font-size"], "16"));
  const [radius, setRadius] = useState(cssNumber(selection.styles["border-radius"]));
  const [padding, setPadding] = useState(selection.styles["padding"] ?? "0px");
  const [gap, setGap] = useState(cssNumber(selection.styles["gap"]));

  const commitPixels = (property: string, value: string) => {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) onApply(property, `${Math.max(0, parsed)}px`);
  };

  const applyForeground = (value: string) => {
    onApply("color", value);
    if (!isSvg) return;
    if (selection.styles["fill"] && selection.styles["fill"] !== "none") onApply("fill", value);
    if (selection.styles["stroke"] && selection.styles["stroke"] !== "none") onApply("stroke", value);
  };

  return (
    <aside
      data-id="design-style-inspector"
      className="absolute right-6 top-6 z-20 w-64 overflow-hidden rounded-xl border border-black/10 bg-xyne-surface/95 shadow-[0_18px_50px_rgba(0,0,0,.22)] backdrop-blur"
      aria-label="Visual style inspector"
    >
      <div className="flex items-start justify-between border-b border-xyne-border-subtle px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-muted">Inspector</p>
          <p className="mt-0.5 truncate text-[12px] font-medium text-xyne-fg-primary">{selection.label}</p>
          <p className="truncate font-mono text-[9px] text-xyne-fg-tertiary">{selection.selector}</p>
        </div>
        <button type="button" aria-label="Close inspector" onClick={onClose} className="rounded p-1 text-xyne-fg-muted hover:bg-xyne-surface-subtle">
          <XIcon size={13} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 p-3 text-[10px] text-xyne-fg-muted">
        <label className="flex flex-col gap-1">
          {isSvg ? "Icon color" : "Text color"}
          <input
            type="color"
            defaultValue={cssColorToHex(selection.styles["color"], "#111827")}
            onChange={(event) => applyForeground(event.target.value)}
            className="h-8 w-full cursor-pointer rounded border border-xyne-border-subtle bg-transparent p-0.5"
          />
        </label>
        <label className="flex flex-col gap-1">
          {isSvg ? "Fill" : "Background"}
          <input
            type="color"
            defaultValue={cssColorToHex(isSvg ? selection.styles["fill"] : selection.styles["background-color"], "#ffffff")}
            onChange={(event) => onApply(isSvg ? "fill" : "background-color", event.target.value)}
            className="h-8 w-full cursor-pointer rounded border border-xyne-border-subtle bg-transparent p-0.5"
          />
        </label>
        <label className="flex flex-col gap-1">
          Font size
          <input
            type="number" min="1" max="240" value={fontSize}
            onChange={(event) => setFontSize(event.target.value)}
            onBlur={() => commitPixels("font-size", fontSize)}
            className="h-8 rounded border border-xyne-border-subtle bg-xyne-surface-subtle px-2 text-[11px] text-xyne-fg-primary"
          />
        </label>
        <label className="flex flex-col gap-1">
          Weight
          <select
            defaultValue={cssNumber(selection.styles["font-weight"], "400")}
            onChange={(event) => onApply("font-weight", event.target.value)}
            className="h-8 rounded border border-xyne-border-subtle bg-xyne-surface-subtle px-2 text-[11px] text-xyne-fg-primary"
          >
            {[300, 400, 500, 600, 700, 800].map((weight) => <option key={weight} value={weight}>{weight}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Radius
          <input
            type="number" min="0" max="999" value={radius}
            onChange={(event) => setRadius(event.target.value)}
            onBlur={() => commitPixels("border-radius", radius)}
            className="h-8 rounded border border-xyne-border-subtle bg-xyne-surface-subtle px-2 text-[11px] text-xyne-fg-primary"
          />
        </label>
        <label className="flex flex-col gap-1">
          Gap
          <input
            type="number" min="0" max="240" value={gap}
            onChange={(event) => setGap(event.target.value)}
            onBlur={() => commitPixels("gap", gap)}
            className="h-8 rounded border border-xyne-border-subtle bg-xyne-surface-subtle px-2 text-[11px] text-xyne-fg-primary"
          />
        </label>
        <label className="col-span-2 flex flex-col gap-1">
          Padding
          <input
            value={padding}
            onChange={(event) => setPadding(event.target.value)}
            onBlur={() => { if (padding.trim()) onApply("padding", padding.trim().slice(0, 80)); }}
            placeholder="12px 16px"
            className="h-8 rounded border border-xyne-border-subtle bg-xyne-surface-subtle px-2 font-mono text-[11px] text-xyne-fg-primary"
          />
        </label>
        <label className="col-span-2 flex flex-col gap-1">
          Layout
          <select
            defaultValue={selection.styles["display"] ?? "block"}
            onChange={(event) => onApply("display", event.target.value)}
            className="h-8 rounded border border-xyne-border-subtle bg-xyne-surface-subtle px-2 text-[11px] text-xyne-fg-primary"
          >
            {["block", "flex", "grid", "inline", "inline-flex", "inline-block", "none"].map((display) => <option key={display}>{display}</option>)}
          </select>
        </label>
      </div>
      <p className="border-t border-xyne-border-subtle px-3 py-2 text-[9px] leading-4 text-xyne-fg-tertiary">
        Changes are local and reversible. Send a message to materialize them as the next design version.
      </p>
    </aside>
  );
}

function DesignPreviewPanel({
  source,
  versions,
  activeVersionIndex,
  latestVersionAvailable,
  userId,
  sending,
  conversationId,
  selection,
  manualEdits,
  onSelectVersion,
  onFollowLatest,
  onSelectionChange,
  onManualEditsChange,
  onEditedHtmlChange,
  onOpenDesignSystem,
}: {
  source: DesignPreviewSource | null;
  versions: DesignVersion[];
  activeVersionIndex: number | null;
  latestVersionAvailable: boolean;
  userId: string;
  sending: boolean;
  conversationId: string | null;
  selection: DesignNodeSelection | null;
  manualEdits: DesignManualEdit[];
  onSelectVersion: (index: number) => void;
  onFollowLatest: () => void;
  onSelectionChange: (selection: DesignNodeSelection | null) => void;
  onManualEditsChange: React.Dispatch<React.SetStateAction<DesignManualEdit[]>>;
  onEditedHtmlChange: (html: string | null) => void;
  onOpenDesignSystem: () => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rawHtml, setRawHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [inspecting, setInspecting] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareRecord, setShareRecord] = useState<DesignArtifactShare | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [devicePreset, setDevicePreset] = useState<"desktop" | "tablet" | "mobile" | "fit">("desktop");
  const [canvasBackground, setCanvasBackground] = useState<"light" | "dark" | "checkerboard">("light");
  const [fullscreen, setFullscreen] = useState(false);
  const [viewSource, setViewSource] = useState(false);
  const [sourceCopied, setSourceCopied] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const appliedManualEdits = useMemo(
    () => rawHtml == null ? null : applyManualEdits(rawHtml, manualEdits),
    [rawHtml, manualEdits],
  );
  const editedHtml = appliedManualEdits?.html ?? null;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      if (!source) {
        setPreviewUrl(null);
        setRawHtml(null);
        setError(null);
        return;
      }

      const load = async () => {
        try {
          let html: string;
          if (source.kind === "inline") {
            html = source.html;
          } else {
            const response = await fetch(chatAttachmentDownloadUrl(source.attachment.id), {
              credentials: "include",
              headers: { "x-user-id": userId },
              signal: controller.signal,
            });
            if (!response.ok) throw new Error(`Preview failed: HTTP ${response.status}`);
            html = await response.text();
          }
          if (cancelled) return;
          setRawHtml(html);
          setError(null);
        } catch (err) {
          if (cancelled || (err instanceof DOMException && err.name === "AbortError")) return;
          setPreviewUrl(null);
          setRawHtml(null);
          setError(err instanceof Error ? err.message : "Unable to load this design");
        }
      };
      void load();
    }, source?.kind === "inline" && sending ? 250 : 0);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [source, userId, reloadVersion, sending]);

  useEffect(() => {
    if (!editedHtml) {
      setPreviewUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(new Blob([withDesignInspector(editedHtml)], { type: "text/html" }));
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [editedHtml]);

  useEffect(() => {
    onEditedHtmlChange(editedHtml);
    return () => onEditedHtmlChange(null);
  }, [editedHtml, onEditedHtmlChange]);

  useEffect(() => {
    if (!appliedManualEdits) return;
    const staleStatusChanged = appliedManualEdits.edits.some(
      (edit, index) => edit.stale !== manualEdits[index]?.stale,
    );
    if (staleStatusChanged) onManualEditsChange(appliedManualEdits.edits);
  }, [appliedManualEdits, manualEdits, onManualEditsChange]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.type === DESIGN_INSPECTOR_MODE_EVENT && event.data.enabled === false) {
        setInspecting(false);
        setFullscreen(false);
        return;
      }
      if (event.data?.type === DESIGN_EDIT_EVENT) {
        const edit = event.data.edit as Partial<DesignManualEdit> | null | undefined;
        if (typeof edit?.selector === "string" && typeof edit.oldText === "string" && typeof edit.newText === "string") {
          onManualEditsChange((current) => [
            ...current,
            { selector: edit.selector!, oldText: edit.oldText!, newText: edit.newText!, stale: false },
          ]);
        }
        return;
      }
      if (event.data?.type !== DESIGN_INSPECTOR_EVENT) return;
      const candidate = normalizeDesignNodeSelection(event.data.selection);
      if (candidate) onSelectionChange(candidate);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onManualEditsChange, onSelectionChange]);

  const syncInspectorMode = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage({ type: DESIGN_INSPECTOR_MODE_EVENT, enabled: inspecting }, "*");
  }, [inspecting]);

  useEffect(() => {
    syncInspectorMode();
  }, [syncInspectorMode, previewUrl, reloadVersion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const updateSize = () => {
      const styles = window.getComputedStyle(canvas);
      setCanvasSize({
        width: Math.max(0, canvas.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight)),
        height: Math.max(0, canvas.clientHeight - parseFloat(styles.paddingTop) - parseFloat(styles.paddingBottom)),
      });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [fullscreen]);

  useEffect(() => {
    if (!fullscreen) return;
    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", exitOnEscape);
    return () => window.removeEventListener("keydown", exitOnEscape);
  }, [fullscreen]);

  const fileName = source?.kind === "attachment"
    ? source.attachment.originalFilename
    : source?.fileName ?? "Design preview";
  const displayedVersionIndex = source && versions.length > 0
    ? activeVersionIndex ?? versions.length - 1
    : null;
  const displayedVersion = displayedVersionIndex == null ? null : versions[displayedVersionIndex] ?? null;
  const projectAttachment = displayedVersion?.projectAttachment ?? null;
  const canGoPrev = displayedVersionIndex != null && displayedVersionIndex > 0;
  const canGoNext = displayedVersionIndex != null && displayedVersionIndex < versions.length - 1;
  const presetWidth = devicePreset === "tablet" ? 768 : devicePreset === "mobile" ? 390 : null;
  const previewScale = presetWidth && canvasSize.width > 0
    ? Math.min(1, canvasSize.width / presetWidth)
    : 1;
  const scaledPreviewHeight = canvasSize.height > 0 ? canvasSize.height : 1;
  const naturalPreviewHeight = Math.max(1, Math.floor(scaledPreviewHeight / previewScale));
  const canvasStyle: React.CSSProperties = canvasBackground === "dark"
    ? { backgroundColor: "#111214" }
    : canvasBackground === "checkerboard"
      ? {
          backgroundColor: "#e9eaec",
          backgroundImage: "linear-gradient(45deg, #d7d9dd 25%, transparent 25%), linear-gradient(-45deg, #d7d9dd 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d7d9dd 75%), linear-gradient(-45deg, transparent 75%, #d7d9dd 75%)",
          backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
          backgroundSize: "16px 16px",
        }
      : { backgroundColor: "#e9eaec" };
  const devicePresets = [
    { id: "desktop", label: "Desktop", title: "Desktop — use the full preview width", iconClass: "h-2.5 w-4" },
    { id: "tablet", label: "Tablet 768", title: "Tablet — render at 768 CSS pixels", iconClass: "h-3.5 w-2.5" },
    { id: "mobile", label: "Mobile 390", title: "Mobile — render at 390 CSS pixels", iconClass: "h-3.5 w-2" },
    { id: "fit", label: "Fit", title: "Fit — use all available space", iconClass: "h-2.5 w-3.5 rounded-sm border-dashed" },
  ] as const;

  const download = () => {
    if (!editedHtml) return;
    const downloadUrl = URL.createObjectURL(new Blob([editedHtml], { type: "text/html" }));
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = fileName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
  };

  const downloadProject = async () => {
    if (!projectAttachment) return;
    const response = await fetch(chatAttachmentDownloadUrl(projectAttachment.id), {
      credentials: "include",
      headers: { "x-user-id": userId },
    });
    if (!response.ok) return;
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = projectAttachment.originalFilename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const applyVisualStyle = useCallback((property: string, value: string) => {
    if (!selection) return;
    onManualEditsChange((current) => [
      ...current.filter((edit) => !(
        edit.selector === selection.selector && edit.styles && Object.hasOwn(edit.styles, property)
      )),
      { selector: selection.selector, styles: { [property]: value }, stale: false },
    ]);
  }, [onManualEditsChange, selection]);

  const openInNewTab = () => {
    if (!editedHtml) return;
    // The generated artifact must never be the top-level blob document: blob
    // documents inherit this app's origin. Keep the trusted top-level wrapper
    // code-only and run the artifact in an opaque-origin sandbox instead.
    const artifactUrl = URL.createObjectURL(new Blob([editedHtml], { type: "text/html" }));
    const escapedArtifactUrl = artifactUrl
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
    const wrapperHtml = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src blob:; style-src 'unsafe-inline'">
<style>html,body,iframe{width:100%;height:100%;margin:0;border:0}body{overflow:hidden;background:#fff}</style></head>
<body><iframe title="Design preview" sandbox="allow-scripts allow-forms allow-modals" referrerpolicy="no-referrer" src="${escapedArtifactUrl}"></iframe></body></html>`;
    const wrapperUrl = URL.createObjectURL(new Blob([wrapperHtml], { type: "text/html" }));
    window.open(wrapperUrl, "_blank", "noopener,noreferrer");
    window.setTimeout(() => {
      URL.revokeObjectURL(wrapperUrl);
      URL.revokeObjectURL(artifactUrl);
    }, 60_000);
  };

  const copySource = async () => {
    if (!editedHtml) return;
    await navigator.clipboard.writeText(editedHtml);
    setSourceCopied(true);
    window.setTimeout(() => setSourceCopied(false), 1800);
  };

  const cycleCanvasBackground = () => {
    setCanvasBackground((value) => value === "light" ? "dark" : value === "dark" ? "checkerboard" : "light");
  };

  const shareFile = async () => {
    if (!editedHtml) return;
    const file = new File([editedHtml], fileName, { type: "text/html" });
    try {
      if (typeof navigator.share === "function" && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: fileName.replace(/\.html?$/i, ""),
          text: "Shared from Xyne Design Studio",
          files: [file],
        });
        return;
      }
      download();
    } catch (err) {
      // Closing the native share sheet is an intentional cancel, not an error
      // and must not unexpectedly download the file.
      if (!(err instanceof DOMException && err.name === "AbortError")) download();
    }
  };

  const shareUrl = shareRecord
    ? new URL(shareRecord.sharePath, window.location.origin).toString()
    : "";

  const openShare = async () => {
    if (source?.kind !== "attachment" || !conversationId || manualEdits.length > 0) {
      await shareFile();
      return;
    }
    setShareOpen(true);
    setShareBusy(true);
    setShareError(null);
    setShareCopied(false);
    try {
      const record = await publishDesignArtifact({
        attachmentId: source.attachment.id,
        conversationId,
        title: fileName.replace(/\.html?$/i, ""),
        expiresInDays: null,
      });
      setShareRecord(record);
    } catch (err) {
      setShareError(err instanceof Error ? err.message : "Unable to publish this design");
    } finally {
      setShareBusy(false);
    }
  };

  const copyShareLink = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setShareCopied(true);
    window.setTimeout(() => setShareCopied(false), 1800);
  };

  const sharePublicLink = async () => {
    if (!shareUrl) return;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: shareRecord?.title ?? fileName, url: shareUrl });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    await copyShareLink();
  };

  const revokeShare = async () => {
    if (!shareRecord) return;
    setShareBusy(true);
    setShareError(null);
    try {
      await revokeDesignArtifactShare(shareRecord.id);
      setShareRecord(null);
      setShareOpen(false);
    } catch (err) {
      setShareError(err instanceof Error ? err.message : "Unable to revoke this link");
    } finally {
      setShareBusy(false);
    }
  };

  return (
    <section
      data-id="design-preview-panel"
      className={fullscreen
        ? "fixed inset-0 z-50 flex min-w-0 flex-col bg-xyne-surface-subtle"
        : "flex min-w-0 flex-1 flex-col bg-xyne-surface-subtle"
      }
    >
      {/* min-h + wrap, not a fixed 54px row: the control set outgrew one line,
          and a fixed-height overflow-x row overlapped adjacent panels at
          moderate widths (Design system colliding with the status label). */}
      <header className="flex min-h-[54px] shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-xyne-border-subtle bg-xyne-surface px-4 py-2">
        <div className="flex min-w-0 max-w-[40%] items-center gap-2">
          <AppWindowIcon size={17} className="shrink-0 text-xyne-brand" />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-xyne-fg-primary">{fileName}</p>
            <p className="truncate text-[10px] uppercase tracking-[0.08em] text-xyne-fg-muted">
              {sending ? "Updating preview" : source ? "Live design" : "Preview"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onOpenDesignSystem}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-xyne-border-subtle px-2.5 text-[11px] font-medium text-xyne-fg-secondary transition hover:border-xyne-border-strong hover:text-xyne-fg-primary"
          >
            <SparkleIcon size={13} /> Design system
          </button>
          <div data-id="design-device-presets" className="flex shrink-0 items-center rounded-md border border-xyne-border-subtle bg-xyne-surface-subtle p-0.5">
            {devicePresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                data-id={`design-device-${preset.id}`}
                title={preset.title}
                aria-label={preset.title}
                aria-pressed={devicePreset === preset.id}
                onClick={() => setDevicePreset(preset.id)}
                className={devicePreset === preset.id
                  ? "inline-flex h-7 items-center gap-1.5 rounded bg-xyne-surface px-2 text-[10px] font-medium text-xyne-fg-primary shadow-sm"
                  : "inline-flex h-7 items-center gap-1.5 rounded px-2 text-[10px] font-medium text-xyne-fg-muted hover:text-xyne-fg-primary"
                }
              >
                <span aria-hidden="true" className={`${preset.iconClass} inline-block rounded-[2px] border border-current`} />
                {preset.label}
              </button>
            ))}
          </div>
          {versions.length > 0 && displayedVersion && (
            <div data-id="design-version-strip" className="flex items-center gap-1 rounded-md border border-xyne-border-subtle bg-xyne-surface-subtle px-1 py-1">
              <button
                type="button"
                aria-label="Previous design version"
                disabled={!canGoPrev}
                onClick={() => {
                  if (displayedVersionIndex != null) onSelectVersion(displayedVersionIndex - 1);
                }}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-xyne-fg-muted hover:bg-xyne-surface hover:text-xyne-fg-primary disabled:cursor-not-allowed disabled:opacity-35"
              >
                <CaretLeftIcon size={12} />
              </button>
              <BaseMenu.Root>
                <BaseMenu.Trigger
                  render={(triggerProps) => (
                    <button
                      {...(triggerProps as React.ButtonHTMLAttributes<HTMLButtonElement>)}
                      type="button"
                      data-id="design-version-menu-trigger"
                      className="inline-flex h-6 min-w-[62px] items-center justify-center gap-1 rounded px-1.5 text-[11px] font-medium text-xyne-fg-secondary hover:bg-xyne-surface hover:text-xyne-fg-primary"
                    >
                      {displayedVersion.label} of {versions.length}
                      <CaretDownIcon size={10} />
                    </button>
                  )}
                />
                <BaseMenu.Portal>
                  <BaseMenu.Positioner side="bottom" align="end" sideOffset={6}>
                    <BaseMenu.Popup className="z-50 w-64 rounded-lg border border-xyne-border bg-xyne-surface p-1 shadow-lg">
                      {versions.map((version, index) => (
                        <BaseMenu.Item
                          key={`${version.messageId}:${version.label}`}
                          data-id="design-version-menu-item"
                          onClick={() => onSelectVersion(index)}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12px] outline-none hover:bg-xyne-surface-subtle data-[highlighted]:bg-xyne-surface-subtle"
                        >
                          <span className={index === displayedVersionIndex
                            ? "inline-flex h-5 min-w-7 items-center justify-center rounded bg-xyne-brand px-1.5 text-[10px] font-semibold text-xyne-fg-inverse"
                            : "inline-flex h-5 min-w-7 items-center justify-center rounded bg-xyne-surface-subtle px-1.5 text-[10px] font-semibold text-xyne-fg-muted"
                          }>
                            {version.label}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-xyne-fg-primary">{designVersionFileName(version)}</span>
                            <span className="block truncate text-[10px] text-xyne-fg-muted">
                              Message {version.messageIndex + 1} · {fmtDateShort(version.createdAt)}
                            </span>
                          </span>
                        </BaseMenu.Item>
                      ))}
                    </BaseMenu.Popup>
                  </BaseMenu.Positioner>
                </BaseMenu.Portal>
              </BaseMenu.Root>
              <button
                type="button"
                aria-label="Next design version"
                disabled={!canGoNext}
                onClick={() => {
                  if (displayedVersionIndex != null) onSelectVersion(displayedVersionIndex + 1);
                }}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-xyne-fg-muted hover:bg-xyne-surface hover:text-xyne-fg-primary disabled:cursor-not-allowed disabled:opacity-35"
              >
                <CaretRightIcon size={12} />
              </button>
            </div>
          )}
          {latestVersionAvailable && (
            <button
              type="button"
              data-id="design-latest-version-jump"
              onClick={onFollowLatest}
              className="inline-flex h-8 items-center rounded-md border border-xyne-brand/25 bg-xyne-brand/5 px-2.5 text-[11px] font-medium text-xyne-brand transition hover:bg-xyne-brand/10"
            >
              Latest: {versions.at(-1)?.label}
            </button>
          )}
          <button
            type="button"
            data-id="design-canvas-background-toggle"
            title={`Canvas background: ${canvasBackground}. Click to cycle.`}
            aria-label={`Canvas background: ${canvasBackground}. Click to cycle.`}
            onClick={cycleCanvasBackground}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-xyne-border-subtle text-xyne-fg-secondary transition hover:border-xyne-border-strong hover:text-xyne-fg-primary"
          >
            <ChartBarIcon size={13} />
          </button>
          <button
            type="button"
            data-id="design-view-source-toggle"
            title={viewSource ? "Show rendered preview" : "View HTML source"}
            aria-label={viewSource ? "Show rendered preview" : "View HTML source"}
            aria-pressed={viewSource}
            disabled={!rawHtml}
            onClick={() => setViewSource((value) => !value)}
            className={viewSource
              ? "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-xyne-brand text-xyne-fg-inverse"
              : "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-xyne-border-subtle text-xyne-fg-secondary transition hover:border-xyne-border-strong hover:text-xyne-fg-primary disabled:cursor-not-allowed disabled:opacity-40"
            }
          >
            <PencilSimpleIcon size={13} />
          </button>
          <button
            type="button"
            data-id="design-inspector-toggle"
            disabled={!previewUrl || viewSource}
            aria-pressed={inspecting}
            onClick={() => setInspecting((value) => !value)}
            className={inspecting
              ? "inline-flex h-8 items-center gap-1.5 rounded-md bg-xyne-brand px-2.5 text-[11px] font-medium text-xyne-fg-inverse"
              : "inline-flex h-8 items-center gap-1.5 rounded-md border border-xyne-border-subtle px-2.5 text-[11px] font-medium text-xyne-fg-secondary transition hover:border-xyne-border-strong hover:text-xyne-fg-primary disabled:cursor-not-allowed disabled:opacity-40"
            }
          >
            <CursorClickIcon size={13} /> {inspecting ? "Inspecting" : "Select"}
          </button>
          <button
            type="button"
            data-id="design-refresh-preview"
            disabled={!source}
            onClick={() => setReloadVersion((value) => value + 1)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-xyne-border-subtle px-2.5 text-[11px] font-medium text-xyne-fg-secondary transition hover:border-xyne-border-strong hover:text-xyne-fg-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowsClockwiseIcon size={12} /> Refresh
          </button>
          <button
            type="button"
            data-id="design-open-new-tab"
            title="Open current HTML in a new tab"
            disabled={!rawHtml}
            onClick={openInNewTab}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-xyne-border-subtle text-xyne-fg-secondary transition hover:border-xyne-border-strong hover:text-xyne-fg-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowSquareOutIcon size={13} />
          </button>
          <button
            type="button"
            data-id="design-fullscreen-toggle"
            title={fullscreen ? "Exit fullscreen (Escape)" : "Open fullscreen preview"}
            aria-label={fullscreen ? "Exit fullscreen preview" : "Open fullscreen preview"}
            onClick={() => setFullscreen((value) => !value)}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-xyne-border-subtle text-xyne-fg-secondary transition hover:border-xyne-border-strong hover:text-xyne-fg-primary"
          >
            {fullscreen ? <XIcon size={14} /> : <AppWindowIcon size={14} />}
          </button>
          <button
            type="button"
            disabled={!rawHtml}
            onClick={() => { void openShare(); }}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-xyne-border-subtle px-2.5 text-[11px] font-medium text-xyne-fg-secondary transition hover:border-xyne-border-strong hover:text-xyne-fg-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ShareNetworkIcon size={13} /> Share
          </button>
          {projectAttachment && (
            <button
              type="button"
              data-id="design-download-react-project"
              onClick={() => { void downloadProject(); }}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-xyne-border-subtle px-2.5 text-[11px] font-medium text-xyne-fg-secondary transition hover:border-xyne-border-strong hover:text-xyne-fg-primary"
            >
              <FileIcon size={13} /> React project
            </button>
          )}
          <button
            type="button"
            disabled={!rawHtml}
            onClick={download}
            className="inline-flex h-8 items-center rounded-md bg-xyne-fg-primary px-3 text-[11px] font-medium text-xyne-fg-inverse transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Download HTML
          </button>
        </div>
      </header>

      {manualEdits.length > 0 && (
        <div
          data-id="design-manual-edits-bar"
          className="flex h-9 shrink-0 items-center justify-end gap-2 border-b border-xyne-border-subtle bg-xyne-surface px-4 text-[11px] text-xyne-fg-secondary"
        >
          <span data-id="design-manual-edits-count">
            {manualEdits.length} manual {manualEdits.length === 1 ? "edit" : "edits"}
          </span>
          <button
            type="button"
            data-id="design-manual-edits-undo"
            onClick={() => onManualEditsChange((current) => current.slice(0, -1))}
            className="inline-flex h-6 items-center rounded px-2 font-medium text-xyne-fg-primary hover:bg-xyne-surface-subtle"
          >
            Undo
          </button>
          <button
            type="button"
            data-id="design-manual-edits-reset"
            onClick={() => onManualEditsChange([])}
            className="inline-flex h-6 items-center rounded px-2 font-medium text-xyne-fg-muted hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary"
          >
            Reset
          </button>
        </div>
      )}

      <div
        ref={canvasRef}
        data-id="design-preview-canvas"
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4"
        style={canvasStyle}
      >
        {selection && !viewSource && (
          <DesignStyleInspector
            key={selection.selector}
            selection={selection}
            onApply={applyVisualStyle}
            onClose={() => onSelectionChange(null)}
          />
        )}
        {viewSource && editedHtml ? (
          <div data-id="design-source-view" className="relative h-full w-full overflow-hidden rounded-lg border border-black/10 bg-[#17181a] shadow-[0_18px_55px_rgba(0,0,0,0.16)]">
            <button
              type="button"
              data-id="design-copy-source"
              onClick={() => { void copySource(); }}
              className="absolute right-3 top-3 z-10 inline-flex h-8 items-center gap-1.5 rounded-md border border-white/15 bg-black/50 px-2.5 text-[11px] font-medium text-white shadow-sm backdrop-blur hover:bg-black/70"
            >
              {sourceCopied ? <CheckIcon size={13} /> : <CopySimpleIcon size={13} />}
              {sourceCopied ? "Copied" : "Copy"}
            </button>
            <pre className="h-full overflow-auto p-5 pr-24 font-mono text-[12px] leading-relaxed text-zinc-200">
              <code>{editedHtml}</code>
            </pre>
          </div>
        ) : previewUrl ? (
          presetWidth ? (
            <div
              data-id="design-device-frame"
              className="relative shrink-0"
              style={{ width: presetWidth * previewScale, height: scaledPreviewHeight }}
            >
              <iframe
                ref={iframeRef}
                key={`${previewUrl}:${reloadVersion}`}
                src={previewUrl}
                onLoad={syncInspectorMode}
                title="Design preview"
                // Deliberately omit allow-same-origin: generated scripts execute
                // in an opaque origin and cannot access Claw's cookies or DOM.
                sandbox="allow-scripts allow-forms allow-modals"
                referrerPolicy="no-referrer"
                className="absolute left-1/2 top-0 rounded-[14px] border-[5px] border-black/20 bg-white shadow-[0_18px_55px_rgba(0,0,0,0.24)]"
                style={{
                  width: presetWidth,
                  height: naturalPreviewHeight,
                  transform: `translateX(-50%) scale(${previewScale})`,
                  transformOrigin: "top center",
                }}
              />
              <span
                data-id="design-effective-zoom"
                className="pointer-events-none absolute right-1.5 top-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[9px] font-semibold text-white shadow-sm"
              >
                {Math.round(previewScale * 100)}%
              </span>
            </div>
          ) : (
            <iframe
              ref={iframeRef}
              key={`${previewUrl}:${reloadVersion}`}
              src={previewUrl}
              onLoad={syncInspectorMode}
              title="Design preview"
              // Deliberately omit allow-same-origin: generated scripts execute
              // in an opaque origin and cannot access Claw's cookies or DOM.
              sandbox="allow-scripts allow-forms allow-modals"
              referrerPolicy="no-referrer"
              className="h-full w-full rounded-lg border border-black/10 bg-white shadow-[0_18px_55px_rgba(0,0,0,0.16)]"
            />
          )
        ) : error ? (
          <div className="max-w-sm rounded-xl border border-xyne-error/25 bg-xyne-surface p-5 text-center shadow-sm">
            <p className="text-[13px] font-semibold text-xyne-error">Preview unavailable</p>
            <p className="mt-1 text-[12px] text-xyne-fg-muted">{error}</p>
          </div>
        ) : (
          <div className="max-w-md text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-xyne-surface shadow-sm ring-1 ring-xyne-border-subtle">
              <AppWindowIcon size={27} className="text-xyne-brand" />
            </div>
            <h2 className="mt-4 text-[18px] font-semibold text-xyne-fg-primary">Create your first design</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-xyne-fg-muted">
              Pick an agent, describe the interface, website, diagram, or visual you need, and the generated HTML will appear here.
            </p>
          </div>
        )}
        {sending && (
          <div className="absolute bottom-7 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-xyne-border-subtle bg-xyne-surface/95 px-3 py-1.5 text-[11px] text-xyne-fg-secondary shadow-md backdrop-blur">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-xyne-brand" />
            Agent is updating the design
          </div>
        )}
        {selection && !sending && (
          <div className="pointer-events-none absolute bottom-7 left-1/2 max-w-[70%] -translate-x-1/2 truncate rounded-full border border-xyne-brand/30 bg-xyne-surface/95 px-3 py-1.5 text-[11px] font-medium text-xyne-fg-primary shadow-md backdrop-blur">
            Selected: {selection.label}
          </div>
        )}
      </div>

      <Dialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        title="Share design"
        description="Anyone with this unlisted link can view the published artifact."
        maxWidth={520}
        footer={shareRecord ? (
          <>
            <button
              type="button"
              disabled={shareBusy}
              onClick={() => { void revokeShare(); }}
              className="mr-auto inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-[12px] font-medium text-xyne-error hover:bg-xyne-error/10 disabled:opacity-40"
            >
              <LinkBreakIcon size={14} /> Revoke link
            </button>
            <button
              type="button"
              onClick={() => window.open(shareUrl, "_blank", "noopener,noreferrer")}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-xyne-border px-3 text-[12px] font-medium text-xyne-fg-secondary hover:text-xyne-fg-primary"
            >
              <ArrowSquareOutIcon size={14} /> Open
            </button>
            <button
              type="button"
              onClick={() => { void sharePublicLink(); }}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-xyne-fg-primary px-3 text-[12px] font-medium text-xyne-fg-inverse"
            >
              <ShareNetworkIcon size={14} /> Share link
            </button>
          </>
        ) : undefined}
      >
        {shareBusy && !shareRecord ? (
          <div className="flex items-center gap-2 rounded-lg bg-xyne-surface-subtle px-3 py-4 text-[12px] text-xyne-fg-secondary">
            <span className="h-2 w-2 animate-pulse rounded-full bg-xyne-brand" /> Publishing current design…
          </div>
        ) : shareError ? (
          <div className="rounded-lg border border-xyne-error/25 bg-xyne-error/5 px-3 py-3 text-[12px] text-xyne-error">
            {shareError}
          </div>
        ) : shareRecord ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg border border-xyne-border bg-xyne-surface-subtle p-2">
              <input
                readOnly
                aria-label="Public design link"
                value={shareUrl}
                onFocus={(event) => event.currentTarget.select()}
                className="min-w-0 flex-1 bg-transparent px-1 font-mono text-[11px] text-xyne-fg-secondary outline-none"
              />
              <button
                type="button"
                onClick={() => { void copyShareLink(); }}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-xyne-surface px-2.5 text-[11px] font-medium text-xyne-fg-primary shadow-sm ring-1 ring-xyne-border-subtle"
              >
                {shareCopied ? <CheckIcon size={13} /> : <CopySimpleIcon size={13} />}
                {shareCopied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="flex items-center justify-between text-[11px] text-xyne-fg-muted">
              <span>Published version updates when you share this design again.</span>
              <span>{shareRecord.viewCount} view{shareRecord.viewCount === 1 ? "" : "s"}</span>
            </div>
          </div>
        ) : null}
      </Dialog>
    </section>
  );
}

export interface ChatPageV3Props {
  mode?: "chat" | "design";
}

export function ChatPageV3({ mode = "chat" }: ChatPageV3Props) {
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
    planTodos: livePlanTodos,
    reasoning: liveReasoning,
    invocationsByMsgId,
    reasoningByMsgId,
    branchInfoByMsgId,
    pendingActionsByMsgId,
    streamingMsgId,
    debugEvents,
    debugArtifactsReadyVersion,
    activeAgentSlug: ctxAgentSlug,
    setActiveAgentSlug: setCtxAgentSlug,
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
  } = useChat();

  const [searchParams] = useSearchParams();
  // URL ?agent= takes precedence on mount, but global context survives navigation
  // and lets the in-flight chat resume when the user comes back to /v3/chat.
  const urlAgent = searchParams.get("agent");
  // ?conversation=<id> — deep-link from Home / Dashboard's session rows.
  // We don't keep this in state; once we've auto-loaded the conv once we
  // mark it consumed so URL changes from in-page nav don't re-trigger.
  const urlConversation = searchParams.get("conversation");
  // ?allRuns=1 — set by the agent "All Runs" inspector when an admin deep-links
  // into ANOTHER user's conversation. It opts this view into cross-user reads
  // (backend gates on admin + this flag). It applies ONLY to the deep-linked
  // conversation: the instant the user opens any other (their own) conversation,
  // allRunsActive() returns false and the view is own-turns-only again.
  const urlAllRuns = searchParams.get("allRuns") === "1";
  const allRunsActive = useCallback(
    (cid: string | null | undefined): boolean => !!cid && urlAllRuns && cid === urlConversation,
    [urlAllRuns, urlConversation],
  );
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
  const [designSelection, setDesignSelection] = useState<DesignNodeSelection | null>(null);
  const [manualEdits, setManualEdits]         = useState<DesignManualEdit[]>([]);
  const [editedDesignHtml, setEditedDesignHtml] = useState<string | null>(null);
  const [designEditScope, setDesignEditScope] = useState<DesignEditScope>("element");
  const [showModal, setShowModal]             = useState(false);
  const [showDebugger, setShowDebugger]       = useState(false);
  const [debugTurnIndex, setDebugTurnIndex]   = useState<number | null>(null);
  const [debugTurnLive, setDebugTurnLive]     = useState(false);
  // Branching-safe debugger selector. The Nth visible assistant no longer maps
  // to the Nth chronological run, so we pin selection by run sessionId derived
  // from the assistant message's AgentRun.chatMessageId.
  const [debugSessionId, setDebugSessionId]   = useState<string | null>(null);
  // Map: assistant message id → { sessionId, rating, ratingComment } for the
  // AgentRun that produced it. Populated when the active conversation is loaded.
  // Used by the "Debug this response" button (sessionId) and the per-message
  // 👍/👎 rating control (rating + comment).
  const [runByMsgId, setRunByMsgId] = useState<Map<string, RunRatingInfo>>(new Map());
  const [selectedCitation, setSelectedCitation] = useState<CitationSelection | null>(null);
  const [citationPanelWidth, setCitationPanelWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("chat-citation-panel-width");
      return saved ? parseInt(saved, 10) : 480;
    } catch {
      return 480;
    }
  });
  const [debuggerWidth, setDebuggerWidth]     = useState<number>(() => {
    try {
      const saved = localStorage.getItem("chat-debugger-width");
      return saved ? parseInt(saved, 10) : 420;
    } catch {
      return 420;
    }
  });
  const [providers, setProviders]             = useState<ProviderCredential[]>([]);
  const [selectedProvider, setSelectedProvider] = useState("spaces");
  const [providerChanging, setProviderChanging] = useState(false);
  // Per-chat LiteLLM model switcher: models the agent's shared key can access,
  // its configured default, and the currently-picked model ("" = agent default).
  const [litellmModels, setLitellmModels] = useState<Array<{ id: string; name: string }>>([]);
  const [litellmDefaultModel, setLitellmDefaultModel] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>("");
  // Per-chat provider fast mode — remembered per agent in localStorage so the
  // choice sticks across reloads. ON ⇒ every turn in this chat sends speed=fast.
  const [fastMode, setFastMode] = useState<boolean>(false);
  // Per-chat thinking level from the composer's model menu (null = agent default).
  const [thinkingLevel, setThinkingLevel] = useState<ChatThinkingLevel | null>(null);
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

  // Always-current ref for sending state — used in async callbacks where the
  // closure would otherwise capture a stale value from a previous render.
  const sendingRef = useRef(sending);
  sendingRef.current = sending;

  // Composer attachments — files queued for upload, kept on the parent so
  // they survive composer re-renders. previewUrl is an object URL that we
  // revoke on removal / after upload completes.
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);

  const handleAddFiles = useCallback((files: File[]) => {
    setPendingFiles((prev) => {
      const available = Math.max(0, 10 - prev.length);
      const accepted = files
        .filter((file) => file.size <= 25 * 1024 * 1024)
        .slice(0, available);
      const additions = accepted.map((file) => ({
        file,
        previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      }));
      return additions.length > 0 ? [...prev, ...additions] : prev;
    });
  }, []);

  const handleRemoveFile = useCallback((idx: number) => {
    setPendingFiles((prev) => {
      const removed = prev[idx];
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
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
    setSelectedContext((prev) => {
      if (prev.some((c) => c.type === item.type && c.id === item.id)) return prev;
      if (item.type === "repository") {
        return [...prev.filter((c) => c.type !== "repository"), item];
      }
      return [...prev, item];
    });
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

  const citationIndex = useMemo(() => {
    const index = new Map<string, CitationLookup>();
    for (const msg of messages) {
      if (msg.role !== "assistant") continue;
      const invocations = msg.id === streamingMsgId
        ? liveInvocations
        : (invocationsByMsgId ?? new Map<string, ToolInvocation[]>()).get(msg.id) ?? [];
      for (const invocation of invocations) {
        if (!invocation.toolCallId || !invocation.result) continue;
        const chunks = parseInvocationCitationChunks(invocation);
        if (chunks.length === 0) continue;
        for (const chunk of chunks) {
          const lookup: CitationLookup = {
            invocation,
            messageId: msg.id,
            chunk,
            chunks,
          };
          for (const key of buildCitationKeyAliases(chunk.toolCallId, chunk.chunkIndex)) {
            index.set(key, lookup);
          }
          for (const key of buildCitationKeyAliases(invocation.toolCallId, chunk.chunkIndex)) {
            index.set(key, lookup);
          }
        }
      }
    }
    return index;
  }, [messages, streamingMsgId, liveInvocations, invocationsByMsgId]);

  const resolvedCitation = selectedCitation
    ? citationIndex.get(selectedCitation.key) ?? null
    : null;

  useEffect(() => {
    setSelectedCitation(null);
  }, [conversationId, activeAgentSlug]);

  // Refresh the debugger's msg→sessionId map after a turn finishes. Triggered
  // by `sending` going false on a known conversation: the new AgentRun row
  // gets a chatMessageId on finalize, and that's what the debugger keys by.
  useEffect(() => {
    if (sending || !conversationId || !activeAgentSlug) return;
    listRuns(userId, { conversationId, agentSlug: activeAgentSlug, limit: 200 })
      .then((runs) => {
        setRunByMsgId(buildRunByMsgId(runs));
      })
      .catch(() => {});
  }, [sending, conversationId, activeAgentSlug, userId]);

  const handleOpenCitation = useCallback((ref: CitationRef, citationNumber: number, numbers: Map<string, number>) => {
    setShowDebugger(false);
    setSelectedCitation({ key: ref.key, ref, citationNumber, numbers });
  }, []);

  const handleCloseCitation = useCallback(() => {
    setSelectedCitation(null);
  }, []);

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

  /* Load the agent's shared LiteLLM models for the in-chat model switcher, and
   * reset the per-chat model pick whenever the active agent changes. Empty list
   * (no litellm credential, or error) ⇒ the picker hides itself. */
  useEffect(() => {
    setSelectedModel("");
    setThinkingLevel(null);
    setFastMode(readStoredFastMode(activeAgentSlug));
    if (!activeAgentSlug || !userId) {
      setLitellmModels([]);
      setLitellmDefaultModel(null);
      return;
    }
    let cancelled = false;
    listChatLitellmModels(activeAgentSlug, userId)
      .then(({ models, defaultModel }) => {
        if (cancelled) return;
        setLitellmModels(models);
        setLitellmDefaultModel(defaultModel);
      })
      .catch(() => {
        if (cancelled) return;
        setLitellmModels([]);
        setLitellmDefaultModel(null);
      });
    return () => { cancelled = true; };
  }, [activeAgentSlug, userId]);

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
          // Honor ?conversation=<id> even when the target ISN'T in this user's
          // own conversation list. Admins open other users' runs from the
          // agent "All Runs" view, and those conversations are never in the
          // admin's user-scoped `convs`. The /messages endpoint is the ACL
          // boundary (admins get every message + tool invocation via
          // listByConversation; non-admins get only their own slice — an empty
          // pane for a conversation they can't see, never a leak), so it's safe
          // to always attempt the deep-link load here. Previously this required
          // `convs.find(...)`, which silently snapped foreign deep-links back to
          // the admin's own most-recent conversation.
          const deepLinkTarget =
            urlConversation && consumedDeepLinkRef.current !== urlConversation
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
            pollChatMessages(activeAgentSlug, targetConvId, allRunsActive(targetConvId))
              .then(({ messages: msgs, invocationsByMsgId, reasoningByMsgId }) => {
                // Skip auto-load if the user started sending while we were
                // fetching — the draft session is already the active one.
                // Deep-links always go through (user explicitly asked for it).
                if (!deepLinkTarget && sendingRef.current) return;
                loadConversation(msgs, targetConvId, invocationsByMsgId, reasoningByMsgId);
              })
              .catch(() => {});
            // Side-load AgentRuns to build the msg→sessionId map the debugger
            // needs to pick the right run under branching. Independent of the
            // messages fetch — runs are an admin-side projection, not part of
            // the chat thread, so failure here is silent.
            listRuns(userId, { conversationId: targetConvId, agentSlug: activeAgentSlug, limit: 200 })
              .then((runs) => {
                setRunByMsgId(buildRunByMsgId(runs));
              })
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

  /* Live tool calls for a VIEWED (not driven) conversation. Spaces-originated
   * runs report over the callback webhook; subscribe to the /live SSE so this
   * window shows tool calls + progress in real time. Skipped while THIS tab is
   * driving the run (its own stream owns liveness; applyLiveEvent guards against
   * double-apply too). On `done`, refetch the canonical transcript with a short
   * retry, since the assistant ChatMessage save is fire-and-forget. The /live
   * route 404s when the feature flag is off → the helper ends silently. */
  useEffect(() => {
    if (!conversationId || !activeAgentSlug || !userId) return;
    if (sending) return; // this tab is driving — its SSE handles liveness
    const slug = activeAgentSlug;
    const convId = conversationId;
    const close = subscribeLiveConversation(slug, convId, userId, {
      onSnapshot: ({ inProgress, partial }) => applyLiveEvent(convId, { type: "snapshot", inProgress, ...(partial ? { partial } : {}) }),
      onLabel: (label) => applyLiveEvent(convId, { type: "label", toolLabel: label }),
      onInvocation: (inv) => applyLiveEvent(convId, { type: "invocation", toolInvocation: inv }),
      onTextDelta: (d) => applyLiveEvent(convId, { type: "delta", textDelta: d }),
      onReasoningDelta: (d) => applyLiveEvent(convId, { type: "delta", reasoningDelta: d }),
      onDone: () => {
        applyLiveEvent(convId, { type: "done" });
        let attempts = 0;
        const tryLoad = () => {
          pollChatMessages(slug, convId, allRunsActive(convId))
            .then(({ messages: msgs, invocationsByMsgId: invMap, reasoningByMsgId: reasonMap }) => {
              const last = msgs[msgs.length - 1];
              if (last?.role !== "assistant" && attempts < 4) {
                attempts++;
                window.setTimeout(tryLoad, 700);
                return;
              }
              loadConversation(msgs, convId, invMap, reasonMap);
            })
            .catch(() => {});
        };
        tryLoad();
      },
    }, allRunsActive(convId));
    return close;
  }, [conversationId, activeAgentSlug, userId, sending, applyLiveEvent, loadConversation, allRunsActive]);

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
    setSelectedCitation(null);
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
    setSelectedCitation(null);
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
      setSelectedCitation(null);
      // Wait for the agent panel + input to mount before grabbing focus.
      window.setTimeout(() => inputAreaRef.current?.focus(), 50);
    },
    [activeAgentSlug, clear],
  );

  const handleUseDesignTemplate = useCallback((prompt: string) => {
    setInputValue(prompt);
    window.setTimeout(() => inputAreaRef.current?.focus(), 0);
  }, []);

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
      const { messages: msgs, invocationsByMsgId, reasoningByMsgId } = await pollChatMessages(conv.agentSlug, conv.conversationId, allRunsActive(conv.conversationId));
      loadConversation(msgs, conv.conversationId, invocationsByMsgId, reasoningByMsgId);
      setSelectedCitation(null);
      // Per-chat model pick doesn't carry across conversations — start each at
      // the agent default.
      setSelectedModel("");
      if (switchingAgent) {
        setActiveAgentSlug(conv.agentSlug);
        setInputValue("");
      }
      // Refresh the debugger's msg→sessionId map for the new conversation so
      // "Debug this response" picks the right run under branching.
      listRuns(userId, { conversationId: conv.conversationId, agentSlug: conv.agentSlug, limit: 200 })
        .then((runs) => {
          setRunByMsgId(buildRunByMsgId(runs));
        })
        .catch(() => {});
    } catch {
      // no-op — error is non-critical
    }
  }, [activeAgentSlug, loadConversation, userId, allRunsActive]);

  const handleNewConversation = useCallback(() => {
    if (activeAgent) {
      clear();
      setInputValue("");
      setSelectedCitation(null);
      setSelectedModel("");
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
        localStorage.setItem("chat-debugger-width", String(currentWidth));
      } catch {}
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [debuggerWidth]);

  const handleCitationResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = citationPanelWidth;
    let currentWidth = startWidth;

    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX;
      currentWidth = Math.max(320, Math.min(760, startWidth + delta));
      setCitationPanelWidth(currentWidth);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      try {
        localStorage.setItem("chat-citation-panel-width", String(currentWidth));
      } catch {}
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [citationPanelWidth]);

  // Latest visible user message id — gates the "Edit" affordance (older edits
  // would re-root the branch tree, which is intentionally out of scope).
  const latestUserMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (m.role === "user") return m.id;
    }
    return null;
  }, [messages]);

  const [activeVersionIndex, setActiveVersionIndex] = useState<number | null>(null);
  const [designSystemOpen, setDesignSystemOpen] = useState(false);

  const designVersionList = useMemo(
    () => mode === "design" ? designVersions(messages) : [],
    [messages, mode],
  );
  const displayedVersionIndex = activeVersionIndex == null
    ? designVersionList.length - 1
    : Math.min(activeVersionIndex, designVersionList.length - 1);
  const displayedDesignVersion = displayedVersionIndex >= 0 ? designVersionList[displayedVersionIndex] ?? null : null;
  const designPreviewSource = displayedDesignVersion?.source ?? null;
  const designVersionByMessageId = useMemo(() => {
    const next = new Map<string, DesignVersion>();
    for (const version of designVersionList) next.set(version.messageId, version);
    return next;
  }, [designVersionList]);
  const latestVersionAvailable = activeVersionIndex != null && activeVersionIndex < designVersionList.length - 1;

  useEffect(() => {
    setActiveVersionIndex(null);
  }, [conversationId, mode]);

  useEffect(() => {
    if (activeVersionIndex != null && activeVersionIndex >= designVersionList.length) {
      setActiveVersionIndex(designVersionList.length > 0 ? designVersionList.length - 1 : null);
    }
  }, [activeVersionIndex, designVersionList.length]);

  const handleDesignSelection = useCallback((selection: DesignNodeSelection | null) => {
    setDesignSelection(selection);
    if (selection) {
      setDesignEditScope("element");
      window.setTimeout(() => inputAreaRef.current?.focus(), 0);
    }
  }, []);

  useEffect(() => {
    setDesignSelection(null);
  }, [displayedVersionIndex]);

  useEffect(() => {
    setManualEdits([]);
    setEditedDesignHtml(null);
  }, [conversationId, displayedDesignVersion?.messageId, mode]);

  const handleFastModeChange = useCallback((enabled: boolean) => {
    setFastMode(enabled);
    if (activeAgentSlug) writeStoredFastMode(activeAgentSlug, enabled);
  }, [activeAgentSlug]);
  // Only an explicit ON is sent — OFF means "whatever the agent is configured
  // with", so the agent-level setting still applies.
  const speedOverride = fastMode ? ("fast" as const) : undefined;
  const thinkingOverride = thinkingLevel ?? undefined;

  const handleRegenerate = useCallback((assistantMessageId: string) => {
    if (!activeAgentSlug || sending) return;
    void regenerate(activeAgentSlug, userId, assistantMessageId, selectedModel || undefined, speedOverride, thinkingOverride);
  }, [activeAgentSlug, sending, regenerate, userId, selectedModel, speedOverride, thinkingOverride]);

  const handleEditUserMessage = useCallback((userMessageId: string, text: string) => {
    if (!activeAgentSlug || sending) return;
    void editLatestUserMessage(activeAgentSlug, userId, userMessageId, text, selectedModel || undefined, speedOverride, thinkingOverride);
  }, [activeAgentSlug, sending, editLatestUserMessage, userId, selectedModel, speedOverride, thinkingOverride]);

  const handleSend = useCallback(() => {
    const text = inputValue.trim();
    const hasFiles = pendingFiles.length > 0;
    const hasContext = selectedContext.length > 0;
    // Allow empty text if there's at least an attachment or @-mention — same
    // behaviour as V1. Block while a stream is already in flight.
    if (!activeAgentSlug || sending) return;
    if (!text && !hasFiles && !hasContext) return;
    if (mode === "design" && manualEdits.length > 0 && !editedDesignHtml) return;

    // Snapshot composer state and clear immediately for snappy UX.
    const filesSnapshot = pendingFiles.map((p) => p.file);
    const previewsToRevoke = pendingFiles.map((p) => p.previewUrl);
    const selectedSnapshot = [...selectedContext];
    const repositoryContext = selectedSnapshot.find((item) => item.type === "repository");
    const contextSnapshot: AttachedContextRef[] = selectedSnapshot
      .filter((item) => item.type !== "repository")
      .map((item) => ({
      type: item.type,
      id: item.id,
      title: item.title,
      ...(typeof item.meta?.["conversationId"] === "string" &&
      item.meta["conversationId"].trim().length > 0
        ? { threadId: item.meta["conversationId"].trim() }
        : {}),
    } as AttachedContextRef));
    const designSelectionSnapshot = mode === "design" && designSelection
      ? { ...designSelection, scope: designEditScope }
      : undefined;
    const manualEditsSnapshot = mode === "design" ? manualEdits : [];
    const editedHtmlSnapshot = manualEditsSnapshot.length > 0 ? editedDesignHtml : null;
    const designArtifactAttachmentId = mode === "design" && manualEditsSnapshot.length === 0 && designPreviewSource?.kind === "attachment"
      ? designPreviewSource.attachment.id
      : undefined;
    const editedBaseFile = editedHtmlSnapshot
      ? new File(
          [editedHtmlSnapshot],
          `${(designPreviewSource?.kind === "attachment"
            ? designPreviewSource.attachment.originalFilename
            : designPreviewSource?.fileName ?? "xyne-design").replace(/\.html?$/i, "") || "xyne-design"}-edited.html`,
          { type: "text/html" },
        )
      : null;
    const designCompatibilityInstruction = designSelectionSnapshot
      ? [
          DESIGN_STUDIO_COMPAT_INSTRUCTION,
          `Selected node fallback — scope=${designSelectionSnapshot.scope}; selector=${designSelectionSnapshot.selector}; ` +
            `node=${designSelectionSnapshot.tagName}; label=${designSelectionSnapshot.label}; ` +
            `current styles=${JSON.stringify(designSelectionSnapshot.styles)}. Apply the user's request to that node. ` +
            "For component or design-system scope, change the shared rule and all matching instances rather than adding one inline override.",
        ].join("\n\n")
      : DESIGN_STUDIO_COMPAT_INSTRUCTION;
    const placeholderText =
      text ||
      (hasFiles
        ? `Attached ${filesSnapshot.length} file${filesSnapshot.length !== 1 ? "s" : ""}`
        : `Attached ${contextSnapshot.length} context item${contextSnapshot.length !== 1 ? "s" : ""}`);

    setInputValue("");
    setPendingFiles([]);
    setSelectedContext([]);
    setMentionOpen(false);
    if (mode === "design" && manualEditsSnapshot.length === 0) setActiveVersionIndex(null);

    const dispatch = async () => {
      let uploadedIds: string[] = [];
      const filesToUpload = editedBaseFile ? [...filesSnapshot, editedBaseFile] : filesSnapshot;
      if (filesToUpload.length > 0) {
        try {
          const uploaded = await uploadChatAttachments(activeAgentSlug, userId, filesToUpload);
          uploadedIds = uploaded.map((a) => a.id);
        } catch (err) {
          console.error("[chat] upload failed:", err);
          // Restore composer state so the user can retry / edit without losing work.
          setPendingFiles((prev) => [
            ...filesSnapshot.map((f, i) => ({
              file: f,
              previewUrl: previewsToRevoke[i] ?? (f.type.startsWith("image/") ? URL.createObjectURL(f) : null),
            })),
            ...prev,
          ]);
          setSelectedContext((prev) => [...selectedSnapshot, ...prev]);
          setInputValue(text);
          return;
        }
      }

      try {
        await send(activeAgentSlug, userId, placeholderText, {
          attachmentIds: uploadedIds.length > 0 ? uploadedIds : undefined,
          attachedContext: contextSnapshot.length > 0 ? contextSnapshot : undefined,
          ...(mode === "design" ? { studioMode: "design" as const } : {}),
          ...(mode === "design" ? { additionalInstructions: designCompatibilityInstruction } : {}),
          // A materialized manual-edit upload is the revision base; sending the prior artifact too would duplicate it.
          ...(designArtifactAttachmentId ? { designArtifactAttachmentId } : {}),
          ...(designSelectionSnapshot ? { designSelection: designSelectionSnapshot } : {}),
          ...(repositoryContext ? {
            researchContext: { type: "repository", id: repositoryContext.id, name: repositoryContext.title },
          } : {}),
          // Per-chat model switch: pin the picked LiteLLM model for this turn.
          ...(selectedModel ? { modelOverride: selectedModel } : {}),
          // Per-chat provider fast mode (composer toggle).
          ...(speedOverride ? { speed: speedOverride } : {}),
          // Per-chat thinking level (composer model menu).
          ...(thinkingOverride ? { thinkingLevel: thinkingOverride } : {}),
        });
        if (designSelectionSnapshot) setDesignSelection(null);
        if (manualEditsSnapshot.length > 0) {
          setManualEdits([]);
          setActiveVersionIndex(null);
        }
        listChatConversations(activeAgentSlug, userId)
          .then((convs) => setConversations(convs.map((c) => ({ ...c, agentSlug: activeAgentSlug }))))
          .catch(() => {});
      } finally {
        // Revoke object URLs whether send succeeded or not — they're a memory leak.
        previewsToRevoke.forEach((u) => {
          try {
            if (u) URL.revokeObjectURL(u);
          } catch {}
        });
      }
    };

    void dispatch();
  }, [inputValue, pendingFiles, selectedContext, activeAgentSlug, userId, sending, send, mode, selectedModel, speedOverride, thinkingOverride, designSelection, designEditScope, designPreviewSource, manualEdits, editedDesignHtml]);

  const handleApproveAction = useCallback(async (msgId: string, action: PendingAction) => {
    if (!activeAgentSlug) throw new Error("No active agent selected");
    const resultText = await approveChatAction(activeAgentSlug, userId, action);
    approvePendingAction(msgId, action, resultText);
  }, [activeAgentSlug, userId, approvePendingAction]);

  const handleApproveAndContinueAction = useCallback(async (msgId: string, action: PendingAction) => {
    if (!activeAgentSlug) throw new Error("No active agent selected");

    const latestUserIntent = [...messages].reverse().find((m) => m.role === "user")?.content?.trim();

    try {
      const resultText = await approveChatAction(activeAgentSlug, userId, action);
      approvePendingAction(msgId, action, resultText);

      const normalized = (resultText ?? "").trim();
      const cappedResult = normalized.length > 5000 ? `${normalized.slice(0, 5000)}\n... (truncated)` : normalized;

      const additionalInstructions = [
        "Approved write-action continuation:",
        `- Tool: ${action.tool}`,
        latestUserIntent ? `- Latest user intent: ${latestUserIntent}` : "",
        "Use only the approved result below to answer.",
        "Do not call tools. Do not request any further approval.",
        "Respond like a normal assistant: concise summary, intent mapping, and next best step.",
        `Approved result:\n${cappedResult || "(empty output)"}`,
      ].filter(Boolean).join("\n\n");

      await send(activeAgentSlug, userId, "Continue with approved result.", {
        disableTools: true,
        additionalInstructions,
      });
      return;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const additionalInstructions = [
        "Approved write-action attempt failed:",
        `- Tool: ${action.tool}`,
        latestUserIntent ? `- Latest user intent: ${latestUserIntent}` : "",
        `- API/Execution error: ${errorMessage || "Unknown error"}`,
        "Explain this failure to the user in plain terms.",
        "Ask the user exactly which missing/invalid key or value is needed to retry.",
        "Do not call tools in this turn.",
      ].filter(Boolean).join("\n\n");

      await send(activeAgentSlug, userId, "Continue after failed approved action.", {
        disableTools: true,
        additionalInstructions,
      });
      throw err;
    }
  }, [activeAgentSlug, userId, approvePendingAction, messages, send]);

  const handleDeclineAction = useCallback((msgId: string, action: PendingAction) => {
    declinePendingAction(msgId, action);
  }, [declinePendingAction]);

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
            {mode === "design" && (
              <DesignPreviewPanel
                source={designPreviewSource}
                versions={designVersionList}
                activeVersionIndex={activeVersionIndex}
                latestVersionAvailable={latestVersionAvailable}
                userId={userId}
                sending={sending}
                conversationId={conversationId ?? null}
                selection={designSelection}
                manualEdits={manualEdits}
                onSelectVersion={setActiveVersionIndex}
                onFollowLatest={() => setActiveVersionIndex(null)}
                onSelectionChange={handleDesignSelection}
                onManualEditsChange={setManualEdits}
                onEditedHtmlChange={setEditedDesignHtml}
                onOpenDesignSystem={() => setDesignSystemOpen(true)}
              />
            )}
            {mode === "design" && (
              <DesignSystemSheet
                open={designSystemOpen}
                agentSlug={activeAgent.slug}
                agentName={activeAgent.name}
                onClose={() => setDesignSystemOpen(false)}
              />
            )}
            <div className={mode === "design"
              ? "flex w-[min(560px,44%)] min-w-[360px] shrink-0 overflow-hidden border-l border-xyne-border-subtle"
              : "flex flex-1 min-w-0 overflow-hidden"
            }>
              <div
                data-id="chat-center-panel"
                className="flex min-w-0 flex-1 flex-col overflow-hidden bg-xyne-surface-subtle"
              >
                <CenterHeader
                  agent={activeAgent}
                  convTitle={activeConv?.title}
                  conversationId={conversationId}
                  userId={userId}
                  userAbbr={userAbbr}
                  messageCount={messages.length}
                  onOpenSettings={() => navigate(`/v3/agents/${activeAgent.slug}`)}
                  onOpenDashboard={() => navigate("/v3/dashboard")}
                  onOpenDebugger={() => {
                    setSelectedCitation(null);
                    setDebugTurnIndex(null);
                    setDebugTurnLive(false);
                    setShowDebugger(true);
                  }}
                />

                {messages.length === 0 && !sending && mode === "design" ? (
                  <DesignGallery
                    conversations={conversations.filter((conv) => conv.agentSlug === activeAgent.slug)}
                    userId={userId}
                    onSelectConversation={handleSelectConv}
                    onUseTemplate={handleUseDesignTemplate}
                  />
                ) : messages.length === 0 && !sending ? (
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
                    livePlanTodos={livePlanTodos}
                    liveReasoning={liveReasoning}
                    invocationsByMsgId={invocationsByMsgId}
                    reasoningByMsgId={reasoningByMsgId}
                    branchInfoByMsgId={branchInfoByMsgId}
                    onSelectBranch={selectBranch}
                    onRegenerate={handleRegenerate}
                    latestUserMessageId={latestUserMessageId}
                    onEditUserMessage={handleEditUserMessage}
                    selectedCitationKey={selectedCitation?.key ?? null}
                    onOpenTurnDebugger={(turnIndex, live, assistantMessageId) => {
                      setDebugTurnIndex(turnIndex);
                      setDebugTurnLive(live);
                      // Resolve to sessionId via the runs map. Falls back to
                      // null when the run isn't ready yet (streaming) — the
                      // drawer's selectedTurnIndex still gets us close.
                      setDebugSessionId(runByMsgId.get(assistantMessageId)?.sessionId ?? null);
                      setSelectedCitation(null);
                      setShowDebugger(true);
                    }}
                    onOpenCitation={handleOpenCitation}
                    userId={userId}
                    runByMsgId={runByMsgId}
                    onRated={(msgId, rating, comment) => {
                      // Optimistically reflect the new rating in the shared map
                      // so the buttons stay truthful without a full refetch.
                      setRunByMsgId((prev) => {
                        const existing = prev.get(msgId);
                        if (!existing) return prev;
                        const next = new Map(prev);
                        next.set(msgId, { ...existing, rating, ratingComment: comment ?? null });
                        return next;
                      });
                    }}
                    pendingActionsByMsgId={pendingActionsByMsgId}
                    onApproveAction={handleApproveAction}
                    onApproveAndContinueAction={handleApproveAndContinueAction}
                    onDeclineAction={handleDeclineAction}
                    hideHtmlSource={mode === "design"}
                    designVersionByMessageId={mode === "design" ? designVersionByMessageId : undefined}
                    onSelectDesignVersion={mode === "design" ? setActiveVersionIndex : undefined}
                  />
                )}

                {mode === "design" && designSelection && (
                  <div className="mx-3 mb-2 rounded-lg border border-xyne-brand/25 bg-xyne-surface px-3 py-2 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <CursorClickIcon size={13} className="shrink-0 text-xyne-brand" />
                          <p className="truncate text-[11px] font-semibold text-xyne-fg-primary">{designSelection.label}</p>
                        </div>
                        <p className="mt-0.5 truncate font-mono text-[10px] text-xyne-fg-muted">{designSelection.selector}</p>
                      </div>
                      <button
                        type="button"
                        aria-label="Clear selected design element"
                        onClick={() => setDesignSelection(null)}
                        className="rounded p-0.5 text-xyne-fg-muted hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary"
                      >
                        <XIcon size={13} />
                      </button>
                    </div>
                    <div className="mt-2 flex gap-1" aria-label="Design edit scope">
                      {([
                        ["element", "This element"],
                        ["component", "Component"],
                        ["design-system", "Design system"],
                      ] as const).map(([scope, label]) => (
                        <button
                          key={scope}
                          type="button"
                          aria-pressed={designEditScope === scope}
                          onClick={() => setDesignEditScope(scope)}
                          className={designEditScope === scope
                            ? "rounded-md bg-xyne-brand px-2 py-1 text-[10px] font-medium text-xyne-fg-inverse"
                            : "rounded-md bg-xyne-surface-subtle px-2 py-1 text-[10px] font-medium text-xyne-fg-secondary hover:text-xyne-fg-primary"
                          }
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
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
                  fastMode={fastMode}
                  onToggleFastMode={handleFastModeChange}
                  modelMenu={
                    <ModelThinkingMenu
                      models={litellmModels}
                      defaultModel={litellmDefaultModel}
                      selectedModel={selectedModel}
                      onSelectModel={setSelectedModel}
                      thinkingLevel={thinkingLevel}
                      onSelectThinking={setThinkingLevel}
                      disabled={sending}
                    />
                  }
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

              {selectedCitation && !showDebugger && (
                <>
                  <div
                    data-id="chat-citation-resizer"
                    className="group relative flex w-1 shrink-0 cursor-col-resize items-center justify-center"
                    onMouseDown={handleCitationResizeStart}
                  >
                    <div className="h-full w-px bg-xyne-border-subtle group-hover:w-0.5 group-hover:bg-xyne-border-strong transition-all" />
                  </div>
                  <CitationPanel
                    selection={selectedCitation}
                    citation={resolvedCitation}
                    width={citationPanelWidth}
                    onClose={handleCloseCitation}
                    onOpenCitation={handleOpenCitation}
                  />
                </>
              )}

              {showDebugger && (
                <>
                  <div
                    data-id="chat-debugger-resizer"
                    className="group relative flex w-1 shrink-0 cursor-col-resize items-center justify-center bg-transparent"
                    onMouseDown={handleDebuggerResizeStart}
                  >
                    <div className="h-full w-px bg-xyne-border-subtle group-hover:w-0.5 group-hover:bg-xyne-border-strong transition-all" />
                  </div>
                  <DebugDrawer
                    open={showDebugger}
                    inline
                    width={debuggerWidth}
                    agentSlug={activeAgentSlug ?? ""}
                    conversationId={conversationId}
                    liveEvents={debugEvents}
                    running={sending}
                    artifactsReadyVersion={debugArtifactsReadyVersion}
                    selectedTurnIndex={debugTurnIndex}
                    selectedTurnLive={debugTurnLive}
                    selectedSessionId={debugSessionId}
                    onClose={() => {
                      setShowDebugger(false);
                    }}
                  />
                </>
              )}
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
