/**
 * The one run-dispatch path for messaging channels — DMs and group mentions
 * on every channel go through here so provider resolution, the session ctx
 * and the result callback can never drift apart per entry point (the Slack
 * surface's phase-4 parity lesson, see surfaces/slack/dispatch.ts).
 */
import { isAgentInvocableBy } from "xyne-claw-shared";
import { fetch as httpFetch } from "undici";
import { CONFIG } from "../../config.js";
import { resolveAgentProviderConfigs, resolveSubagentProviderMode } from "../../lib/agent-provider-config.js";
import { runAttachmentRefsEnabled, uploadRunAttachment } from "../../lib/run-attachment-store.js";
import { setSession } from "../../lib/session-context.js";
import { getChannel, type ChannelDeliveryTarget, type MessagingChannelKey } from "./plugin.js";
import { channelConversationId } from "./ids.js";
import type { BoundAgent } from "./store.js";


/**
 * What the agent must know about answering here.
 *
 * Claw's tools were written for the Spaces web app, where rich output arrives
 * as a card the model is explicitly told NOT to describe. On a messenger that
 * splits in two, and the two need OPPOSITE handling:
 *
 *  - Display-only cards (connector pickers, agent rosters) have no counterpart
 *    here. The model must ignore the tool's "a card will be shown" line and
 *    write the content out, or the person is told to look at nothing.
 *  - A write approval is real: the run genuinely paused, and the core sends
 *    an Approve/Decline card of its own (approvals.ts). The model must NOT
 *    re-run the tool or claim the work is done — but it must not suppress it
 *    either, because the person is about to be asked.
 *
 * Getting this backwards is how the agent ended up telling someone to approve
 * a card that was never on their screen.
 */
function channelSurfaceInstructions(channel: MessagingChannelKey): string {
  const plugin = getChannel(channel);
  const name = channel.startsWith("whatsapp") ? "WhatsApp" : channel;
  const limit = plugin?.capabilities.maxTextChars ?? 4000;
  // Approvals are the one case where a card genuinely follows the reply.
  const approvalLine = plugin?.capabilities.interactive
    ? '- EXCEPTION — actions that need approval. A tool answering "Action queued for approval" really did pause, and an Approve/Decline prompt is sent right after your reply. Say in one line what you are about to do and that it needs their OK. Do NOT call the tool again, do NOT say it is done, and do NOT send them to another app.'
    : '- EXCEPTION — actions that need approval. A tool answering "Action queued for approval" really did pause, and a numbered Approve/Decline choice is sent right after your reply. Say in one line what you are about to do and that it needs their OK. Do NOT call the tool again, do NOT say it is done, and do NOT send them to another app.';
  const lines = [
    `## Answering on ${name}`,
    `This reply is delivered as a ${name} message, not in the Xyne Spaces web app.`,
    "",
    "- Plain text only. Any card, button, picker or table YOU produce is dropped before the person sees it.",
    '- Never refer to something the text itself does not contain. No "see the list below", "click Connect", "choose from the options", "as shown above".',
    "- If you would normally show a card or a list, write it out: one short line per item, and say what the person should reply to pick one.",
    // Several claw tools (the connector picker most of all) end by telling the
    // model a card "will be shown with your reply" and to keep its text short.
    // That is true in Spaces and false here, and the model obeys the tool over
    // any general guidance — so contradict it explicitly.
    '- A tool that says a picker, roster or connector list "will be shown with your reply" is wrong here: nothing is shown. Ignore that instruction, do not call the tool again, and write the content out in your own words instead.',
    "- Avoid tools whose only output is a picker or card. If you cannot state the answer in text, say what you can do next in one line rather than describing something the person cannot see.",
    // The one real exception, and it must not be swept up by the rule above.
    approvalLine,
    // Write markdown, NOT WhatsApp syntax: plugin.formatText converts it on the
    // way out, and a single-asterisk pair is read as italics there, so a model
    // asked for WhatsApp-style *bold* produces _italics_ on the phone.
    "- Write markdown: **bold**, _italic_, ~~strike~~, `code`, code blocks and `- ` bullets. It is converted to the messenger's own styling on the way out. There is no underline and no heading — bold a line instead. No tables. No markdown links — write the URL itself.",
    "- Bold the names you hand back — a channel, a person, a ticket, a file — so they are findable in a wall of phone text.",
    `- Be brief. Replies longer than ${limit} characters are split across several messages.`,
  ];
  if (plugin?.capabilities.media) {
    // The old wording here ("files you produce are sent as attachments") was
    // read as a promise that writing a file delivers it. It does not: only a
    // file handed to a delivery tool ever reaches the chat, so the model
    // announced attachments that were never sent.
    lines.push(
      "- A file reaches them only if you DELIVER it with a tool that sends files (sandbox-deliver-files and the like). Writing a file into your workspace sends nothing.",
      "- Never say something is attached unless you delivered it in this reply. If you could not send it, say so and paste the content as text when it is short enough.",
    );
  }
  lines.push("- They can send /new to start a fresh conversation, /stop to give up on a slow answer, /status to ask what you are doing, and /agents to see who else they can talk to. Mention these only if they ask how to do one of those things.");
  if (plugin && !plugin.capabilities.groups) lines.push("- This is a one-to-one conversation. There are no groups or threads here.");
  return lines.join("\n");
}

/** A photo or PDF is the same weight here as in Spaces, so it takes the same
 *  route: bytes to object storage and a ref in the body, falling back to
 *  base64 when the flag is off or the upload fails — a storage hiccup must
 *  never cost the person their attachment. */
async function toRunAttachments(
  conversationId: string,
  messageKey: string,
  files: ReadonlyArray<{ fileName: string; mimeType: string; data: Buffer }>,
): Promise<Array<{ fileName: string; mimeType: string; data?: string; gcsRef?: string; sizeBytes: number }>> {
  const useRefs = runAttachmentRefsEnabled();
  return Promise.all(
    files.map(async (file, index) => {
      const uploaded = useRefs
        ? await uploadRunAttachment(conversationId, `${messageKey}-${index}`, file.data, file.mimeType)
        : null;
      return uploaded
        ? { fileName: file.fileName, mimeType: file.mimeType, gcsRef: uploaded.gcsRef, sizeBytes: uploaded.sizeBytes }
        : { fileName: file.fileName, mimeType: file.mimeType, data: file.data.toString("base64"), sizeBytes: file.data.length };
    }),
  );
}

export async function dispatchChannelRun(input: {
  agent: BoundAgent;
  userId: string;
  task: string;
  /** Files the person sent with the message, as raw bytes. Parked in object
   *  storage when XYNE_RUN_ATTACHMENT_REFS is on and inlined as base64
   *  otherwise — see toRunAttachments. */
  attachments?: Array<{ fileName: string; mimeType: string; data: Buffer }>;
  conversationId: string;
  eventType: "APP_MENTIONED" | "DIRECT_MESSAGE";
  idempotencyKey: string;
  senderName?: string;
  target: ChannelDeliveryTarget;
}): Promise<string> {
  // Invocation whitelist — fail fast with a clear reason before the dispatch
  // round-trip; /internal/run enforces it again as the backstop.
  if (!isAgentInvocableBy(input.agent.config as Record<string, unknown> | null, input.userId)) {
    throw new Error(`agent "${input.agent.slug}" is restricted — you don't have access to it`);
  }
  const runAttachments = await toRunAttachments(input.conversationId, input.idempotencyKey, input.attachments ?? []);

  const providers = await resolveAgentProviderConfigs({ id: input.agent.id, config: input.agent.config });
  const response = await httpFetch(`${CONFIG.internalUrl}/claw/api/v1/internal/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
    },
    body: JSON.stringify({
      userId: input.userId,
      task: input.task,
      conversationId: input.conversationId,
      agentSlug: input.agent.slug,
      orgId: input.agent.orgId,
      eventType: input.eventType,
      triggerSource: input.target.channel,
      idempotencyKey: input.idempotencyKey,
      progressUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/progress`,
      channelId: input.target.chatId,
      channelDelivery: input.target,
      ...(providers.parent ? { provider: providers.parent } : {}),
      ...(providers.providerOrder.length > 1 ? { providerOrder: providers.providerOrder } : {}),
      ...(Object.keys(providers.providerConfigs).length > 0 ? { providerConfigs: providers.providerConfigs } : {}),
      ...(runAttachments.length ? { attachments: runAttachments } : {}),
      additionalInstructions: channelSurfaceInstructions(input.target.channel),
      subagentProviderMode: resolveSubagentProviderMode(input.agent.config),
      ...(input.agent.config ? { agentConfig: input.agent.config } : {}),
    }),
  });
  const body = (await response.json().catch(() => null)) as {
    success?: boolean;
    sessionId?: string;
    error?: string;
  } | null;
  if (!response.ok || !body?.success || !body.sessionId) {
    throw new Error(`${input.target.channel} run dispatch failed: ${body?.error ?? `HTTP ${response.status}`}`);
  }

  await setSession(body.sessionId, {
    mentionedUserId: input.userId,
    targetUserId: input.userId,
    senderId: input.userId,
    senderName: input.senderName ?? input.target.senderId,
    channelId: input.target.chatId,
    channelName: input.target.chatId,
    conversationId: input.conversationId,
    sourceMessageId: input.idempotencyKey,
    task: input.task,
    agentId: input.agent.id,
    agentOrgId: input.agent.orgId,
    agentSlug: input.agent.slug,
    responseMode: "conversation",
    appToken: "",
    spacesAppId: "",
    spacesAppUserId: "",
    rootAgentSlug: input.agent.slug,
    triggerSource: input.target.channel,
    channelDelivery: input.target,
  });
  return body.sessionId;
}
