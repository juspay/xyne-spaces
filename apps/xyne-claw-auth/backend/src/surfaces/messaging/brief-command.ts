/**
 * `/brief off | on | status` — the chat-side switch for the WhatsApp copy of
 * the Daily Brief. Separate from the control commands because it changes a
 * user preference rather than anything about the conversation, and `/stop`
 * already means "cancel the running turn".
 *
 * Identity: it always acts on the user the inbound pipeline resolved from the
 * sender's linked identity — never on anything in the message text.
 */
import { createLogger } from "../../logger.js";
import { errMsg } from "../../lib/errors.js";

const log = createLogger("channel-brief-command");

export type BriefCommand = "on" | "off" | "status";

const BRIEF_RE = /^\/brief(?:\s+(on|off|status|stop|start))?\s*$/i;

/** Parse `/brief`, `/brief on|off|status` (and `stop`/`start` aliases). Bare
 *  `/brief` reports status. Anything else is not ours. */
export function parseBriefCommand(text: string): BriefCommand | null {
  const match = BRIEF_RE.exec(text.trim());
  if (!match) return null;
  const arg = (match[1] ?? "status").toLowerCase();
  if (arg === "off" || arg === "stop") return "off";
  if (arg === "on" || arg === "start") return "on";
  return "status";
}

export const BRIEF_OFF_TEXT =
  "Done — your Daily Brief will no longer be sent here. It is still in Spaces. Reply /brief on to get it back.";
export const BRIEF_ON_TEXT = "Done — your Daily Brief will be sent here each morning. Reply /brief off to stop.";
export const BRIEF_FAILED_TEXT = "Sorry, I couldn't change that just now. Please try again in a minute.";

export async function handleBriefCommand(input: {
  command: BriefCommand;
  userId: string;
  reply: (body: string) => Promise<unknown>;
}): Promise<void> {
  const { command, userId, reply } = input;
  try {
    const { prisma } = await import("../../db.js");
    if (command === "status") {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { dailyBriefEnabled: true, dailyBriefWhatsappEnabled: true },
      });
      if (!user?.dailyBriefEnabled) {
        await reply("Your Daily Brief is turned off in Spaces, so nothing is sent here. Turn it on in Settings first.");
      } else if (user.dailyBriefWhatsappEnabled) {
        await reply("Your Daily Brief is sent here each morning. Reply /brief off to stop.");
      } else {
        await reply("Your Daily Brief is not sent here. Reply /brief on to get it each morning.");
      }
      return;
    }
    const { setDailyBriefWhatsappEnabled } = await import("../../services/dailyBriefWhatsapp.js");
    await setDailyBriefWhatsappEnabled(userId, command === "on", "chat");
    await reply(command === "on" ? BRIEF_ON_TEXT : BRIEF_OFF_TEXT);
  } catch (err) {
    log.warn(`[brief-command] ${command} failed for user=${userId}: ${errMsg(err)}`);
    await reply(BRIEF_FAILED_TEXT);
  }
}
