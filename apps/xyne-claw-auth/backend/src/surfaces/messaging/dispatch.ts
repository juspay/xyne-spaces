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
import { setSession, type SessionContext } from "../../lib/session-context.js";
import { channelAgentTools } from "./agent-tools.js";
import { getChannel, type ChannelDeliveryTarget, type MessagingChannelKey } from "./plugin.js";
import { channelConversationId } from "./ids.js";
import type { BoundAgent } from "./store.js";


/**
 * What the agent must know about answering here.
 *
 * Two things differ from Spaces, and both are spelled out because the model
 * otherwise writes for the web app:
 *
 *  - The register. This is a chat between two people on a phone, so the
 *    guide is texting etiquette (after Poke's published rules: match their
 *    length, no preamble or sign-off, no emoji unless they use them, long
 *    content goes in a file) rather than document formatting.
 *  - The cards. Some Spaces cards now have a messenger counterpart (questions,
 *    connector sign-ins, code/diff/chart — widgets.ts), and the model must
 *    lean on those; every other card is dropped, and a tool claiming one
 *    "will be shown" must be contradicted or the person is told to look at
 *    nothing. A write approval is real and must not be suppressed: the run
 *    paused and an Approve/Decline prompt follows (approvals.ts).
 */
export function channelSurfaceInstructions(channel: MessagingChannelKey): string {
  const plugin = getChannel(channel);
  const name = channel.startsWith("whatsapp") ? "WhatsApp" : channel;
  const caps = plugin?.capabilities;
  const tappable = !!caps?.interactive;
  const lines = [
    `## You're texting on ${name}`,
    `This conversation is a ${name} chat on the person's phone, not the Xyne Spaces web app. Text like a sharp, warm friend who is great at this — not like a document, a report or a support bot.`,
    "",
    "**How to text**",
    "- Match their length. A few words from them gets a line or two back. Go longer only when they asked for information, and even then keep it tight.",
    "- Lead with the answer or the action. No preamble (\"Sure!\", \"Great question\", \"Certainly\"), no restating what they asked, no sign-off (\"Let me know if you need anything else\", \"Hope this helps\") and no offer of more help.",
    "- Plain words and contractions. Mirror their register — casual if they are, clean and brief if they're formal. No corporate phrasing.",
    "- No emoji unless they used one first, and even then at most one.",
    "- One message, short paragraphs, a blank line between ideas. A list only when there really are several items.",
    "- Ask at most one question at a time, and only when you can't sensibly assume. If you assume, say so in a few words and keep going.",
    "- Never mention tools, subagents, systems or what you are \"calling\". Talk about the work, not the plumbing.",
    "",
    "**Long answers**",
    "- Nobody reads a wall of text on a phone. If the full answer runs past about 10 short lines — a report, a long list, a table, a document, a lot of code — text the 1–3 line takeaway and put the full thing in a file instead of pasting it.",
    ...(caps?.media
      ? [`- For that, use ${channel.replace(/-/g, "_")}_send_document: pass the full content as markdown and it arrives as a PDF straight away. Files you build yourself reach them only through a tool that sends files (sandbox-deliver-files and the like) — writing one into your workspace sends nothing.`]
      : ["- Files can't be sent here: give the most important part as text and offer to go through the rest."]),
    "- Never say something is attached unless you delivered it in this reply. If you couldn't make the file, say so and send the most important part as text.",
    "",
    "**While you work**",
    "- They're waiting on a phone and see nothing while you work. When a task will take more than a few seconds, put one short line next to your first tool call — \"on it, checking your calendar\" — it's sent straight away, and \"typing…\" stays up until you answer.",
    "- After that, write a line only for a real finding (\"2 of your 3 PRs have failing CI\") or a blocker. Never \"still working\", never plumbing.",
    "- Those lines are already on their screen. Your final answer gives the conclusion; it doesn't repeat them.",
    "",
    "**Formatting**",
    "- Write markdown: **bold**, _italic_, ~~strike~~, `code`, code blocks and `- ` bullets. It's converted to WhatsApp styling on the way out. No headings, no tables, no markdown links — write the URL itself.",
    "- Bold only the few names they'll scan for: a person, a ticket, a file.",
    "- Don't write citation tokens like [clf-…] or a sources section. They can't be shown here and are removed.",
    `- Replies longer than ${caps?.maxTextChars ?? 4000} characters are split into several messages — one more reason to keep them short.`,
    "",
    `**What shows up on ${name}**`,
    tappable
      ? "- ask-user-question works here: each question arrives as tap-to-answer buttons, a list or a short form. Keep options short (under 20 characters reads best). After asking, say in one short line that you need their pick, and stop."
      : "- ask-user-question works here: each question arrives as a numbered list they answer by replying with the number. Keep options short. After asking, say in one short line that you need their pick, and stop.",
    "- suggest-connectors works here: the person gets a Connect link that opens the sign-in, and once they finish you're asked to carry on. Say in one line what connecting will let you do. Never paste a sign-in link yourself.",
    "- Code, diffs and charts posted with the presentation tools arrive as a code block, a file or a few lines of numbers. Don't repeat them in your text.",
    "- describe-agent works here: an agent or a roster of agents arrives as a list they can tap to start talking to one. Keep your text to a line about why.",
    "- Nothing else card-like exists here — no other pickers, plan cards, agent drafts or tables. A tool that says such a card \"will be shown with your reply\" is wrong here: don't call it again, write the content out in a few short lines instead, and never refer to something the text itself does not contain (\"see below\", \"click Connect\" when nothing was sent).",
    tappable
      ? '- EXCEPTION — actions that need approval. A tool answering "Action queued for approval" really did pause, and an Approve/Decline prompt is sent right after your reply. Say in one line what you are about to do and that it needs their OK. Do NOT call the tool again, do NOT say it is done, and do NOT send them to another app.'
      : '- EXCEPTION — actions that need approval. A tool answering "Action queued for approval" really did pause, and a numbered Approve/Decline choice is sent right after your reply. Say in one line what you are about to do and that it needs their OK. Do NOT call the tool again, do NOT say it is done, and do NOT send them to another app.',
  ];
  if (caps?.media && channel === "whatsapp-cloud") {
    // The Cloud API rejects any document outside Meta's allowlist, HTML included.
    lines.push(
      "- Only PDF, Word, Excel, PowerPoint, plain-text, JPEG and PNG files can be sent here. Never produce an HTML file or HTML report: when they want a document, make a PDF. If the PDF cannot be made, say so instead of sending another format.",
    );
  }
  if (channel === "whatsapp-cloud") {
    lines.push("- Free-form messages only reach them within 24 hours of their last message. If you set something up that will message them later, tell them plainly it may come through as a short notification.");
  }
  lines.push("- Slash commands work here as in Spaces — /new for a fresh conversation, /stop to give up on a slow answer, /status, /debug, /goal, /compact, /agents, and /help to list them all. Mention them only if they ask how to do one of those things.");
  if (plugin && !plugin.capabilities.groups) lines.push("- This is a one-to-one conversation. There are no groups or threads here.");
  return lines.join("\n");
}

/**
 * For a run whose answer is delivered to someone's WhatsApp although it did
 * not start there — a scheduled job set up from a chat. It is a text arriving
 * unprompted, so it has to read like one.
 */
export function notificationSurfaceInstructions(): string {
  return [
    "## Your answer is sent as a WhatsApp message",
    "When this run finishes, your final answer is texted to the person on WhatsApp — they set this up from a chat with you, and it will arrive out of the blue on their phone.",
    "- Write it like a text from a friend: the key fact or outcome first, a few short lines at most, no greeting, no sign-off, no headings or tables.",
    "- Nothing worth saying? Say so in one line (\"nothing new in your inbox since this morning\").",
    "- Long content goes in a PDF you deliver as a file, with a 1–2 line takeaway as the message.",
    "- Don't write citation tokens like [clf-…]; they're removed. Don't also message them with a notify tool — your answer IS the message.",
  ].join("\n");
}

/**
 * The agent's own config for a chat run, plus the chat's own tools (send,
 * react, send a document…), which the stored selection would otherwise strip
 * back out. They are granted as DIRECT picks: claw's live gate admits a
 * virtual server's tools only that way (a `tools.subagents` grant counts for
 * servers with a subagent wrapper, which a chat has not), and claw-auth's
 * listing gate is covered by withSurfaceDefaultToolsConfig (routes/mcp.ts).
 *
 * An agent with no selection gets an empty one in claw unless it is an
 * orchestrator, which is unrestricted — so only the orchestrator is left
 * alone; for anyone else "no selection" plus these tools is still additive.
 *
 * Plan cards and the citation-reflection nudge are off: neither has anything
 * to show here, and the nudge rewrites a finished answer to add [clf-…]
 * tokens that are only stripped again on the way out.
 */
export function channelAgentConfig(
  config: unknown,
  channel: MessagingChannelKey,
  delegationTier?: string,
): Record<string, unknown> {
  const base = config && typeof config === "object" && !Array.isArray(config) ? (config as Record<string, unknown>) : {};
  const stored = base["tools"] && typeof base["tools"] === "object" && !Array.isArray(base["tools"])
    ? (base["tools"] as Record<string, unknown>)
    : null;
  const tools = stored ?? (delegationTier === "orchestrator" ? null : {});
  const direct = (list: unknown): string[] => {
    const values = Array.isArray(list) ? list.filter((value): value is string => typeof value === "string") : [];
    return [...new Set([...values, ...channelAgentTools(channel).map((tool) => tool.name)])];
  };
  return {
    ...base,
    planTracking: false,
    citationReflection: false,
    ...(tools ? { tools: { ...tools, direct: direct(tools["direct"]) } } : {}),
  };
}

export const CHANNEL_RUN_OPTIMIZATIONS = "+subagent_direct_only,+interim_messages";

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

export interface ChannelRunInput {
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
  /** /compact: compact the resumed session before answering. */
  compactBeforeRun?: boolean;
  /** /goal provider=… model=…: this run's provider. */
  providerOverride?: { provider: string; model?: string };
  /** /queue <message>: wait behind the active run instead of interrupting it. */
  explicitQueueOnly?: boolean;
}

export interface ChannelRun {
  body: Record<string, unknown>;
  sessionContext: SessionContext;
}

export async function buildChannelRun(input: ChannelRunInput): Promise<ChannelRun> {
  // Invocation whitelist — fail fast with a clear reason before the dispatch
  // round-trip; /internal/run enforces it again as the backstop.
  if (!isAgentInvocableBy(input.agent.config as Record<string, unknown> | null, input.userId)) {
    throw new Error(`agent "${input.agent.slug}" is restricted — you don't have access to it`);
  }
  const runAttachments = await toRunAttachments(input.conversationId, input.idempotencyKey, input.attachments ?? []);

  const providers = await resolveAgentProviderConfigs({ id: input.agent.id, config: input.agent.config });
  return {
    body: {
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
      ...(input.compactBeforeRun ? { compactBeforeRun: true } : {}),
      ...(input.providerOverride ? { providerOverride: input.providerOverride } : {}),
      additionalInstructions: channelSurfaceInstructions(input.target.channel),
      subagentProviderMode: resolveSubagentProviderMode(input.agent.config),
      optimizations: CHANNEL_RUN_OPTIMIZATIONS,
      agentConfig: channelAgentConfig(input.agent.config, input.target.channel, input.agent.delegationTier),
    },
    sessionContext: {
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
    },
  };
}

export async function postChannelRun(run: ChannelRun): Promise<string> {
  const response = await httpFetch(`${CONFIG.internalUrl}/claw/api/v1/internal/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
    },
    body: JSON.stringify(run.body),
  });
  const body = (await response.json().catch(() => null)) as {
    success?: boolean;
    sessionId?: string;
    error?: string;
  } | null;
  if (!response.ok || !body?.success || !body.sessionId) {
    const channel = run.sessionContext.channelDelivery?.channel ?? "channel";
    throw new Error(`${channel} run dispatch failed: ${body?.error ?? `HTTP ${response.status}`}`);
  }
  await setSession(body.sessionId, run.sessionContext);
  return body.sessionId;
}
