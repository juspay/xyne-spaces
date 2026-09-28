import { activeRun } from "./commands.js";
import { enqueueOutbound } from "./delivery.js";
import type { ChannelDeliveryTarget } from "./plugin.js";

export async function sendInterimMessage(sessionId: string, target: ChannelDeliveryTarget, text: string): Promise<boolean> {
  const body = text.trim();
  if (!body) return false;
  const run = await activeRun(target.connectedSurfaceId, target.chatId);
  if (!run || run.sessionId !== sessionId) return false;
  await enqueueOutbound(target.connectedSurfaceId, { kind: "text", chatId: target.chatId, text: body, markdown: true });
  return true;
}
