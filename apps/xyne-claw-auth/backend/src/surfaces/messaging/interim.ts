import { activeRun } from "./commands.js";
import { enqueueOutbound } from "./delivery.js";
import { getChannel, type ChannelDeliveryTarget } from "./plugin.js";

/**
 * Put "typing…" back up while a run is still working. Sending ANY message
 * clears the indicator on the person's phone (WhatsApp ties it to the reply),
 * so without this an interim line or a mid-run card leaves the chat looking
 * finished until the plugin's next refresh, up to 20 seconds later — and the
 * person reads the silence as the answer having arrived.
 */
export async function resumeTyping(target: ChannelDeliveryTarget): Promise<void> {
  if (!getChannel(target.channel)?.capabilities.typing) return;
  await enqueueOutbound(target.connectedSurfaceId, {
    kind: "typing",
    chatId: target.chatId,
    on: true,
    ...(target.quoted?.messageId ? { messageId: target.quoted.messageId } : {}),
  });
}

export async function sendInterimMessage(sessionId: string, target: ChannelDeliveryTarget, text: string): Promise<boolean> {
  const body = text.trim();
  if (!body) return false;
  const run = await activeRun(target.connectedSurfaceId, target.chatId);
  if (!run || run.sessionId !== sessionId) return false;
  await enqueueOutbound(target.connectedSurfaceId, { kind: "text", chatId: target.chatId, text: body, markdown: true });
  await resumeTyping(target);
  return true;
}
