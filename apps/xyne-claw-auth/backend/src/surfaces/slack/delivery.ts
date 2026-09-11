import { prisma } from "../../db.js";
import { errMsg } from "../../lib/errors.js";
import { createLogger } from "../../logger.js";
import type { FilesUploadV2Arguments } from "@slack/web-api";
import { slackClient } from "./api.js";
import { decryptSurfaceSecret } from "../../lib/surface-resolver.js";
import { prepareSlackResultText } from "./mrkdwn.js";
import { MAX_SLACK_FILE_BYTES } from "./const.js";

const log = createLogger("slack-delivery");

export interface SlackDeliveryTarget {
  surfaceAgentId: string;
  /** Set for slash-command runs: reply with the umbrella app's bot token
   *  (ConnectedSurface.accessToken) instead of the per-agent app install. */
  connectedSurfaceId?: string;
  teamId: string;
  channelId: string;
  threadTs: string;
  slackUserId: string;
}

/** Decrypt the bot token from a registration's install in a workspace. */
export async function agentBotToken(surfaceAgentId: string, teamId: string): Promise<string | null> {
  const install = await prisma.surfaceAgentInstall.findUnique({
    where: { surfaceAgentId_surfaceTenantId: { surfaceAgentId, surfaceTenantId: teamId } },
    select: { encryptedBotToken: true },
  });
  if (!install?.encryptedBotToken) return null;
  return decryptSurfaceSecret(install.encryptedBotToken, "Slack bot token");
}

export async function postSlackMessage(
  botToken: string,
  input: { channel: string; threadTs?: string; text: string },
): Promise<{ ts: string }> {
  const body = await slackClient(botToken).chat.postMessage({
    channel: input.channel,
    ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
    text: input.text,
  });
  return { ts: body.ts ?? "" };
}

/** Decrypt the umbrella bot token stored on a ConnectedSurface row (legacy
 *  org-level OAuth install path). */
export async function connectedSurfaceBotToken(connectedSurfaceId: string): Promise<string | null> {
  const connection = await prisma.connectedSurface.findUnique({
    where: { id: connectedSurfaceId },
    select: { accessToken: true },
  });
  if (!connection?.accessToken) return null;
  return decryptSurfaceSecret(connection.accessToken, "Slack bot token");
}

export interface SlackAttachment {
  fileName: string;
  mimeType: string;
  /** base64-encoded file bytes (the claw result-payload attachment shape). */
  data: string;
}

// filesUploadV2 performs Slack's external upload flow internally (reserve an
// upload URL, PUT the bytes, complete into the channel/thread). Requires the
// files:write bot scope.

export async function uploadSlackFiles(
  botToken: string,
  input: { channelId: string; threadTs?: string; attachments: SlackAttachment[] },
): Promise<{ uploaded: number; failed: number }> {
  const client = slackClient(botToken);
  let uploaded = 0;
  let failed = 0;
  for (const attachment of input.attachments) {
    try {
      const bytes = Buffer.from(attachment.data, "base64");
      if (bytes.length === 0 || bytes.length > MAX_SLACK_FILE_BYTES) {
        failed += 1;
        continue;
      }
      // Built stepwise rather than with a conditional spread: under
      // exactOptionalPropertyTypes an optional-or-absent property is not
      // assignable to the SDK's `thread_ts?: string`.
      const upload = {
        channel_id: input.channelId,
        file: bytes,
        filename: attachment.fileName,
        ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
      } satisfies Record<string, unknown> as FilesUploadV2Arguments;
      await client.filesUploadV2(upload);
      uploaded += 1;
    } catch (error) {
      // Per-file isolation: one bad attachment must not sink the rest.
      log.warn("[slack-delivery] Slack file upload failed", {
        fileName: attachment.fileName,
        error: errMsg(error),
      });
      failed += 1;
    }
  }
  return { uploaded, failed };
}

export async function deliverSlackResult(input: {
  target: SlackDeliveryTarget;
  status: string;
  result: string;
  attachments?: SlackAttachment[];
}): Promise<void> {
  let botToken: string | null = null;
  if (input.target.connectedSurfaceId) {
    botToken = await connectedSurfaceBotToken(input.target.connectedSurfaceId);
  } else {
    botToken = await agentBotToken(input.target.surfaceAgentId, input.target.teamId);
  }
  if (!botToken) throw new Error("Slack bot install is missing for result delivery");

  const text =
    input.status === "completed"
      ? prepareSlackResultText(input.result || "The run completed without a response.")
      : "⚠️ The agent couldn't complete this request. Please try again.";
  await postSlackMessage(botToken, {
    channel: input.target.channelId,
    threadTs: input.target.threadTs,
    text,
  });
  if (input.status === "completed" && input.attachments?.length) {
    const { uploaded, failed } = await uploadSlackFiles(botToken, {
      channelId: input.target.channelId,
      threadTs: input.target.threadTs,
      attachments: input.attachments,
    });
    if (failed > 0) {
      // Missing files:write on older installs is the expected cause — say so
      // in-thread instead of dropping files silently.
      await postSlackMessage(botToken, {
        channel: input.target.channelId,
        threadTs: input.target.threadTs,
        text: `⚠️ ${failed} attachment(s) could not be uploaded to Slack${uploaded > 0 ? ` (${uploaded} succeeded)` : ""}. The app may need the files:write scope (reinstall after scope update).`,
      }).catch(() => undefined);
    }
  }
}
