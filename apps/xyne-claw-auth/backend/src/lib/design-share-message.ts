import { redisService } from "../redis.js";
import { createLogger } from "../logger.js";
import { spacesAppFetch } from "../surfaces/spaces/client.js";
import { errMsg } from "./errors.js";

const log = createLogger("design-share-message");

const REF_TTL_SEC = Number(process.env["CLAW_DESIGN_SHARE_MSG_TTL_SEC"] ?? String(30 * 24 * 60 * 60));

export interface DesignShareMessageTarget {
  channelId: string;
  conversationId: string;
  spacesAppUserId: string;
  appToken: string;
}

interface DesignShareMessageRef {
  messageId: string;
  channelId: string;
  revision: number;
}

const refKey = (conversationId: string, shareId: string): string =>
  `claw:design-share-msg:${conversationId}:${shareId}`;

const UPDATED_AT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

export function designShareMessageText(command: string, link: string, revision: number, updatedAt: Date): string {
  if (revision <= 1) {
    return `**Live ${command}:** ${link}\nOpens the rendered snapshot in the browser — the same link updates with future revisions in this thread.`;
  }
  return `**Live ${command} · revision ${revision}:** ${link}\nUpdated ${UPDATED_AT.format(updatedAt)} UTC. Opens the rendered snapshot in the browser — the same link always shows the latest revision.`;
}

async function readRef(conversationId: string, shareId: string): Promise<DesignShareMessageRef | null> {
  try {
    const raw = await redisService.getConnection().get(refKey(conversationId, shareId));
    return raw ? (JSON.parse(raw) as DesignShareMessageRef) : null;
  } catch (err) {
    log.warn(`readRef failed conv=${conversationId}: ${errMsg(err)}`);
    return null;
  }
}

async function writeRef(conversationId: string, shareId: string, ref: DesignShareMessageRef): Promise<void> {
  await redisService
    .getConnection()
    .set(refKey(conversationId, shareId), JSON.stringify(ref), "EX", REF_TTL_SEC)
    .catch((err: unknown) => log.warn(`writeRef failed conv=${conversationId}: ${errMsg(err)}`));
}

async function postShareMessage(target: DesignShareMessageTarget, markdownText: string): Promise<string | undefined> {
  const resp = (await spacesAppFetch(
    "/chat/postMessage",
    {
      channelId: target.channelId,
      conversationId: target.conversationId,
      markdownText,
      userId: target.spacesAppUserId,
      metadata: { contentFormat: "markdown" },
    },
    target.appToken,
  )) as { messageId?: string; data?: { messageId?: string } } | null;
  return resp?.messageId ?? resp?.data?.messageId;
}

export async function publishDesignShareMessage(
  target: DesignShareMessageTarget,
  share: { id: string; link: string; command: string },
  now: Date = new Date(),
): Promise<"posted" | "edited"> {
  const ref = await readRef(target.conversationId, share.id);
  const revision = (ref?.revision ?? 0) + 1;
  const text = designShareMessageText(share.command, share.link, revision, now);
  if (ref) {
    try {
      await spacesAppFetch(
        "/chat/updateMessage",
        {
          messageId: ref.messageId,
          channelId: ref.channelId,
          markdownText: text,
          userId: target.spacesAppUserId,
          metadata: { contentFormat: "markdown" },
        },
        target.appToken,
      );
      await writeRef(target.conversationId, share.id, { ...ref, revision });
      return "edited";
    } catch (err) {
      log.warn(`edit failed, posting a fresh share message conv=${target.conversationId}: ${errMsg(err)}`);
    }
  }
  const messageId = await postShareMessage(target, text);
  if (messageId) await writeRef(target.conversationId, share.id, { messageId, channelId: target.channelId, revision });
  return "posted";
}
