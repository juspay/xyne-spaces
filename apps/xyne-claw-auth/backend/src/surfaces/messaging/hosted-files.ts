/**
 * Files a messenger will not carry, served from here instead.
 *
 * WhatsApp Cloud takes a short allowlist of document types — no HTML — and
 * caps sizes, yet some of the most useful outputs are exactly that: a /debug
 * trace, an /eval comparison, a /design artifact, a big report. Those are
 * parked in object storage under an unguessable token and the chat gets a link
 * that opens them in the phone's browser.
 *
 * The token is the only credential, so it is long, random and expires with
 * the Redis key; the object it points at is never listed or guessable. HTML is
 * served sandboxed (an opaque origin with no access to this host's cookies),
 * since a generated page may quote anything a run touched.
 */
import { randomBytes } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { CONFIG } from "../../config.js";
import { errMsg } from "../../lib/errors.js";
import { createLogger } from "../../logger.js";
import { redisService } from "../../redis.js";
import { gcsService } from "../../services/storageService.js";
import { REDIS_PREFIX } from "./const.js";
import { enqueueOutbound } from "./delivery.js";
import { getChannel, type ChannelDeliveryTarget, type MessagingChannelKey } from "./plugin.js";

const log = createLogger("channel-hosted-files");

/** Long enough to open a link from yesterday's chat. */
const HOSTED_TTL_S = 7 * 24 * 60 * 60;
const STORAGE_PREFIX = "claw-channel-files";

interface HostedFile {
  path: string;
  fileName: string;
  mimeType: string;
}

function fileKey(token: string): string {
  return `${REDIS_PREFIX}:file:${token}`;
}

function safeName(fileName: string): string {
  return fileName.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120) || "file";
}

/** Park `data` and return a link to it, valid for a week. */
export async function hostFile(input: {
  channel: MessagingChannelKey;
  fileName: string;
  mimeType: string;
  data: Buffer;
}): Promise<string> {
  const token = randomBytes(18).toString("base64url");
  const path = `${STORAGE_PREFIX}/${token}/${safeName(input.fileName)}`;
  await gcsService.uploadFile(input.data, path, input.mimeType);
  const record: HostedFile = { path, fileName: input.fileName, mimeType: input.mimeType };
  await redisService.getConnection().set(fileKey(token), JSON.stringify(record), "EX", HOSTED_TTL_S);
  return `${CONFIG.selfUrl.replace(/\/+$/, "")}/claw/api/v1/surfaces/${input.channel}/files/${token}`;
}

/**
 * A generated file (an HTML trace, a comparison, a findings bundle) into the
 * chat: as the file itself when the messenger takes its type, otherwise as a
 * link. `summary` is the text that goes with it either way.
 */
export async function sendGeneratedFile(
  target: ChannelDeliveryTarget,
  file: { fileName: string; mimeType: string; content: string | Buffer; summary: string },
): Promise<void> {
  const data = typeof file.content === "string" ? Buffer.from(file.content, "utf8") : file.content;
  const plugin = getChannel(target.channel);
  const accepted = !!plugin?.capabilities.media && (plugin.acceptsFile?.(file.mimeType) ?? true);
  const cap = plugin?.capabilities.maxFileBytes;
  if (accepted && (cap === undefined || data.length <= cap)) {
    await enqueueOutbound(target.connectedSurfaceId, {
      kind: "file",
      chatId: target.chatId,
      caption: file.summary,
      attachment: { fileName: file.fileName, mimeType: file.mimeType, data: data.toString("base64") },
    });
    return;
  }
  const url = await hostFile({ channel: target.channel, fileName: file.fileName, mimeType: file.mimeType, data });
  await enqueueOutbound(target.connectedSurfaceId, {
    kind: "text",
    chatId: target.chatId,
    text: `${file.summary}\n\nOpen it here (link works for 7 days): ${url}`,
  });
}

export const hostedFilesRouter = Router({ mergeParams: true });

hostedFilesRouter.get("/files/:token", async (req: Request, res: Response) => {
  const token = typeof req.params["token"] === "string" ? req.params["token"] : "";
  const raw = /^[A-Za-z0-9_-]{20,64}$/.test(token)
    ? await redisService.getConnection().get(fileKey(token)).catch(() => null)
    : null;
  if (!raw) {
    res.status(410).type("text/plain").send("This link has expired. Ask again in the chat for a fresh one.");
    return;
  }
  const file = JSON.parse(raw) as HostedFile;
  try {
    const data = await gcsService.getFileBuffer(file.path);
    res
      .status(200)
      .type(file.mimeType)
      .set("Content-Disposition", `inline; filename="${safeName(file.fileName)}"`)
      .set("X-Content-Type-Options", "nosniff")
      .set("Cache-Control", "private, no-store")
      .set("Referrer-Policy", "no-referrer")
      // Scripts may run (traces expand and collapse) but in an opaque origin:
      // no cookies, no storage, no requests as this host.
      .set("Content-Security-Policy", "sandbox allow-scripts allow-popups")
      .send(data);
  } catch (err) {
    log.warn(`[hosted-files] read failed path=${file.path}: ${errMsg(err)}`);
    res.status(404).type("text/plain").send("This file is no longer available.");
  }
});
