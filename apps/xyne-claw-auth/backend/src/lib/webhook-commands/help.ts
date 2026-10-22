import { findCommand, renderCommandHelp, renderCommandList } from "@xyne/shared/commands";
import { getLoopTemplate } from "xyne-claw-shared";
import type { WebhookCommandCtx } from "./context.js";

const CHAT_ONLY_LINES = [
  "",
  "*In this chat*",
  "- `/new` (or `/reset`, `/clear`) — start a fresh conversation",
  "- `/agents` — the agents you can talk to here · `/<agent> <message>` — send a message to one of them",
  "- `/stop` also works as `/cancel` or `/abort`",
  "- Files a chat can't carry (HTML traces, big downloads) arrive as a link that opens in your browser",
];

export interface HelpLoopCommand {
  name: string;
  description: string;
  template: string;
  published: boolean;
  maxDurationMinutes: number;
}

function loopCommandHelp(c: HelpLoopCommand): string {
  const t = getLoopTemplate(c.template);
  return [
    `**/${c.name}** — ${c.description}`,
    `Loop: ${t?.title ?? c.template}${c.published ? "" : " · draft (only you can run it)"}`,
    `Usage: \`/${c.name} [duration] [focus…]\` (duration up to ${c.maxDurationMinutes}m, defaults to that)`,
    `Also: \`/experiment status\`, \`/experiment stop\`, \`/experiment findings\` work on a running /${c.name}.`,
  ].join("\n");
}

export function buildHelpText(opts: { chat: boolean; command?: string; loops?: HelpLoopCommand[] }): string {
  const loops = opts.loops ?? [];
  if (opts.command) {
    const def = findCommand(opts.command);
    if (def) return renderCommandHelp(def);
    const custom = loops.find((c) => c.name === opts.command!.replace(/^\//, "").toLowerCase());
    if (custom) return loopCommandHelp(custom);
    return [`No command called \`/${opts.command.replace(/^\//, "")}\`.`, "", ...renderCommandList("webhook")].join("\n");
  }
  return [
    "**Slash commands** · `/help <command>` for details",
    "",
    ...renderCommandList("webhook"),
    ...(loops.length > 0
      ? ["", "*Loop commands built in your org*", ...loops.map((c) => `- \`/${c.name}\` — ${c.description}${c.published ? "" : " _(draft, only you)_"}`)]
      : []),
    ...(opts.chat ? CHAT_ONLY_LINES : []),
  ].join("\n");
}

export async function handleHelp(ctx: WebhookCommandCtx, command?: string): Promise<void> {
  const loops = ctx.agent.orgId
    ? await import("../loop-command-defs.js").then((m) => m.listRunnableLoopCommands(ctx.agent.orgId!, ctx.payload.userId)).catch(() => [])
    : [];
  await ctx.reply(
    buildHelpText({ chat: Boolean(ctx.channelDelivery), ...(command ? { command } : {}), loops }),
    "Failed to post /help reply",
  );
}
