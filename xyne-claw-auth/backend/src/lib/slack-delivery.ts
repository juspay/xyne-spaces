import { prisma } from "../db.js";
import { decryptSurfaceSecret } from "./surface-resolver.js";
import { prepareSlackResultText } from "./slack-mrkdwn.js";

interface SlackApiResponse {
  ok?: boolean;
  error?: string;
  ts?: string;
}

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

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function slackBotTokenFromConfig(config: unknown, teamId: string): string | null {
  const installs = objectValue(objectValue(config)?.["installs"]);
  const install = objectValue(installs?.[teamId]);
  const encrypted = install?.["encryptedBotToken"];
  if (typeof encrypted !== "string" || !encrypted) return null;
  return decryptSurfaceSecret(encrypted, "Slack bot token");
}

export async function postSlackMessage(
  botToken: string,
  input: { channel: string; threadTs?: string; text: string },
): Promise<{ ts: string }> {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: input.channel,
      ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
      text: input.text,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => null) as SlackApiResponse | null;
  if (!response.ok || !body?.ok) {
    throw new Error(`Slack chat.postMessage failed: ${body?.error ?? `HTTP ${response.status}`}`);
  }
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

// Slack's external upload flow: get a one-time upload URL, POST the raw bytes,
// then "complete" the upload into the target channel/thread. Requires the
// files:write bot scope.
const MAX_SLACK_FILE_BYTES = 50 * 1024 * 1024;

interface SlackUploadUrlResponse extends SlackApiResponse {
  upload_url?: string;
  file_id?: string;
}

export async function uploadSlackFiles(
  botToken: string,
  input: { channelId: string; threadTs?: string; attachments: SlackAttachment[] },
): Promise<{ uploaded: number; failed: number }> {
  let uploaded = 0;
  let failed = 0;
  for (const attachment of input.attachments) {
    try {
      const bytes = Buffer.from(attachment.data, "base64");
      if (bytes.length === 0 || bytes.length > MAX_SLACK_FILE_BYTES) {
        failed += 1;
        continue;
      }
      const urlResponse = await fetch("https://slack.com/api/files.getUploadURLExternal", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${botToken}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          filename: attachment.fileName,
          length: String(bytes.length),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const urlBody = await urlResponse.json().catch(() => null) as SlackUploadUrlResponse | null;
      if (!urlResponse.ok || !urlBody?.ok || !urlBody.upload_url || !urlBody.file_id) {
        throw new Error(`files.getUploadURLExternal failed: ${urlBody?.error ?? `HTTP ${urlResponse.status}`}`);
      }
      const putResponse = await fetch(urlBody.upload_url, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: bytes,
        signal: AbortSignal.timeout(60_000),
      });
      if (!putResponse.ok) {
        throw new Error(`upload_url POST failed: HTTP ${putResponse.status}`);
      }
      const completeResponse = await fetch("https://slack.com/api/files.completeUploadExternal", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${botToken}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          files: [{ id: urlBody.file_id, title: attachment.fileName }],
          channel_id: input.channelId,
          ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const completeBody = await completeResponse.json().catch(() => null) as SlackApiResponse | null;
      if (!completeResponse.ok || !completeBody?.ok) {
        throw new Error(`files.completeUploadExternal failed: ${completeBody?.error ?? `HTTP ${completeResponse.status}`}`);
      }
      uploaded += 1;
    } catch {
      // Per-file isolation: one bad attachment must not sink the rest.
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
    const surfaceAgent = await prisma.surfaceAgent.findUnique({
      where: { id: input.target.surfaceAgentId },
      select: { config: true },
    });
    botToken = slackBotTokenFromConfig(surfaceAgent?.config, input.target.teamId);
  }
  if (!botToken) throw new Error("Slack bot install is missing for result delivery");

  const text = input.status === "completed"
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

