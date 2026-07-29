/**
 * SessionExportMenu — download a chat session in one of three Claude-Code
 * compatible formats. Shared between ChatPageV3's center header and
 * ControlCenterPage's row actions so the offline-export flow lives in one
 * place. Ported from the v1 `ExportMenu` in `components/ActivityTab.tsx`,
 * including the post-download instructions modal that explains how to
 * unzip + `/resume` the bundle locally.
 *
 * Renders nothing when conversationId is missing.
 */

import { useEffect, useRef, useState } from "react";
import { DownloadSimpleIcon } from "@phosphor-icons/react";
import { exportSessionUrl } from "../../../lib/api";

interface Props {
  conversationId: string | null | undefined;
  agentSlug: string;
  /** Smaller padding + icon for use inside table rows. */
  compact?: boolean;
  /** Optional className override on the trigger button. */
  triggerClassName?: string;
  /** Icon size override; defaults vary per `compact`. */
  iconSize?: number;
}

export function SessionExportMenu({
  conversationId,
  agentSlug,
  compact = false,
  triggerClassName,
  iconSize,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [instructions, setInstructions] = useState<"claude-code" | "claude-project" | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Click-outside dismiss. Listener only attached while open so we
  // don't pay per-row when many menus exist on the page.
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  if (!conversationId) return null;

  const download = (format: "claude-code" | "markdown" | "claude-project") => {
    const url = exportSessionUrl(conversationId, agentSlug, format);
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setMenuOpen(false);
    if (format === "claude-code") setInstructions("claude-code");
    else if (format === "claude-project") setInstructions("claude-project");
  };

  const resolvedIconSize = iconSize ?? (compact ? 12 : 14);
  const defaultTriggerCls = compact
    ? "rounded p-[3px] text-xyne-fg-tertiary hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
    : "rounded p-[5px] text-xyne-fg-tertiary hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary";

  return (
    <>
      <div className="relative" ref={menuRef} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          title="Export session"
          aria-label="Export session"
          className={triggerClassName ?? defaultTriggerCls}
        >
          <DownloadSimpleIcon size={resolvedIconSize} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-md border border-xyne-border bg-xyne-surface shadow-xl">
            <button
              type="button"
              onClick={() => download("claude-project")}
              className="block w-full px-3 py-2 text-left text-[12px] hover:bg-xyne-surface-sunken"
            >
              <div className="font-medium text-xyne-fg-primary">
                Claude Code project <code className="text-xyne-fg-tertiary">.zip</code>
              </div>
              <div className="text-[11px] text-xyne-fg-tertiary">
                Full bundle: agent + subagents + skills + session
              </div>
            </button>
            <button
              type="button"
              onClick={() => download("claude-code")}
              className="block w-full border-t border-xyne-border-subtle px-3 py-2 text-left text-[12px] hover:bg-xyne-surface-sunken"
            >
              <div className="font-medium text-xyne-fg-primary">
                Session only <code className="text-xyne-fg-tertiary">.jsonl</code>
              </div>
              <div className="text-[11px] text-xyne-fg-tertiary">
                Just the transcript, resumable in <code>claude</code>
              </div>
            </button>
            <button
              type="button"
              onClick={() => download("markdown")}
              className="block w-full border-t border-xyne-border-subtle px-3 py-2 text-left text-[12px] hover:bg-xyne-surface-sunken"
            >
              <div className="font-medium text-xyne-fg-primary">
                Markdown <code className="text-xyne-fg-tertiary">.md</code>
              </div>
              <div className="text-[11px] text-xyne-fg-tertiary">Human-readable transcript</div>
            </button>
          </div>
        )}
      </div>

      {instructions && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setInstructions(null)}
        >
          <div
            className="w-full max-w-lg rounded-lg border border-xyne-border bg-xyne-surface p-5"
            onClick={(e) => e.stopPropagation()}
          >
            {instructions === "claude-project" ? (
              <>
                <h3 className="mb-2 text-sm font-semibold text-xyne-fg-primary">
                  Use the bundle in Claude Code
                </h3>
                <p className="mb-3 text-xs text-xyne-fg-tertiary">
                  You got a zip with the agent prompt, subagents, skills, and session transcript.
                  To activate it:
                </p>
                <pre className="mb-3 overflow-auto rounded bg-xyne-surface-sunken p-3 font-mono text-[11px] leading-relaxed text-xyne-fg-primary">{`# 1. Unzip wherever you like
unzip ~/Downloads/*.zip -d ~/my-agent-project

# 2. Move the session jsonl into Claude Code's project folder
mkdir -p ~/.claude/projects/$(basename ~/my-agent-project)
mv ~/my-agent-project/*.jsonl ~/.claude/projects/$(basename ~/my-agent-project)/

# 3. Open the project
cd ~/my-agent-project
claude

# Inside Claude Code:
/resume    # load the prior conversation
/agents    # list the imported subagents`}</pre>
                <p className="mb-4 text-xs text-xyne-fg-tertiary">
                  The bundle&apos;s <code>README.md</code> has full details including MCP caveats.
                  Subagents are prompt-only — install your own MCP servers if you want live tool
                  access.
                </p>
              </>
            ) : (
              <>
                <h3 className="mb-2 text-sm font-semibold text-xyne-fg-primary">
                  Resume in Claude Code
                </h3>
                <p className="mb-3 text-xs text-xyne-fg-tertiary">
                  Transcript saved as <code>&lt;sessionId&gt;.jsonl</code>. To open it:
                </p>
                <pre className="mb-3 overflow-auto rounded bg-xyne-surface-sunken p-3 font-mono text-[11px] leading-relaxed text-xyne-fg-primary">{`mkdir -p ~/.claude/projects/xyne-session
mv ~/Downloads/*.jsonl ~/.claude/projects/xyne-session/
cd ~/.claude/projects/xyne-session
claude
# then type /resume`}</pre>
                <p className="mb-4 text-xs text-xyne-fg-tertiary">
                  The transcript is loaded as context. Original xyne-claw tool calls appear as
                  prose summaries — Claude Code uses its own tools for any new actions.
                </p>
              </>
            )}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setInstructions(null)}
                className="rounded-md bg-xyne-fg-primary px-3 py-1.5 text-xs font-medium text-xyne-fg-inverse hover:opacity-90"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
