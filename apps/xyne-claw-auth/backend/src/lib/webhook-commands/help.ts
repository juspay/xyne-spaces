import type { WebhookCommandCtx } from "./context.js";

// ── /help ── list the available slash commands, then stop.
export async function handleHelp(ctx: WebhookCommandCtx): Promise<void> {
  await ctx.reply([
    // KEEP IN SYNC with what actually parses: parseSlashCommand (this
    // file's control commands), parseExperimentCommand (lib/experiment.ts)
    // and TASK_COMMANDS (apps/xyne-claw/src/task-commands.ts). Every entry
    // below is routable today; a command that works but is missing here is
    // a command nobody discovers — /design, /dashboard, /explainer and
    // /record-skill shipped unlisted for months.
    "**Slash commands**",
    "",
    "*Autonomy*",
    "- `/goal <condition>` — work autonomously until the condition is met · `/goal status`",
    "- `/experiment <duration> [provider=… model=…] [focus...]` — explore until the deadline",
    "   ↳ duration is `<number><m|h|d>` — e.g. `/experiment 90m`, `/experiment 8h`, `/experiment 14d`. Omit it for 1h; anything longer than the 30d cap is clamped to 30d.",
    "- `/understanding [duration cap] [focus...]` — explain every path in scope; ends when the frontier is exhausted, not on the clock",
    "- `/experiment status` · `/experiment list` · `/experiment findings [id]` · `/experiment stop`",
    "",
    "*Producing something*",
    "- `/design <brief>` — design-studio run: produces a self-contained HTML artifact",
    "- `/dashboard <brief>` — live-data dashboard snapshot, refreshable on a schedule",
    "- `/explainer <topic>` — narrated explainer video",
    "- `/record-skill` — turn a recorded walkthrough into a reusable skill",
    "- `/spec <ticket>` — interview you, then write the specification onto the ticket",
    "",
    "*Controlling this thread*",
    "- `/stop` (or `/goal clear`) — stop the current run, drop queued messages, and clear any active goal",
    "- `/clear` — wipe this thread's context and start fresh",
    "- `/compact [focus]` — summarize & shrink the context, then continue",
    "- `/queue` — show messages waiting behind the current run · `/queue <message>` — run it after the current run without interrupting · `/queue clear` — drop waiting messages",
    "- `/fast [task]` / `/fast off` — fast mode: the agent calls tools directly instead of delegating to subagents (quicker for short asks; use normal mode for deep investigations)",
    "- `/status` — debug panel for this thread's current run: what it's doing now, tool activity in the last 5 minutes, and whether it's stuck or just slow",
    "- `/debug` — one HTML file with the full execution trace of this thread's current run: every tool call and LLM turn with timings (no tool outputs)",
    "- `/help` — show this list",
  ].join("\n"), "Failed to post /help reply");
}
