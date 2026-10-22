import { findClawCommand, renderCommandHelp, renderCommandList } from "../command-help.js";
import type { WebhookCommandCtx } from "./context.js";

const CHAT_ONLY_LINES = [
  "",
  "*In this chat*",
  "- `/new` (or `/reset`, `/clear`) — start a fresh conversation",
  "- `/agents` — the agents you can talk to here · `/<agent> <message>` — send a message to one of them",
  "- `/stop` also works as `/cancel` or `/abort`",
  "- Files a chat can't carry (HTML traces, big downloads) arrive as a link that opens in your browser",
];

export function buildHelpText(opts: { chat: boolean; command?: string }): string {
  if (opts.command) {
    const def = findClawCommand(opts.command);
    if (def) return renderCommandHelp(def);
    return [`No command called \`/${opts.command.replace(/^\//, "")}\`.`, "", ...renderCommandList()].join("\n");
  }
  return [
    "**Slash commands** · `/help <command>` for details",
    "",
    ...renderCommandList(),
    ...(opts.chat ? CHAT_ONLY_LINES : []),
  ].join("\n");
}

export async function handleHelp(ctx: WebhookCommandCtx, command?: string): Promise<void> {
  await ctx.reply(
    buildHelpText({ chat: Boolean(ctx.channelDelivery), ...(command ? { command } : {}) }),
    "Failed to post /help reply",
  );
}
