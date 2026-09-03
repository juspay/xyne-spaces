import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { CONFIG } from "../config.js";
import { decrypt, encrypt } from "../crypto.js";
import { getOrgId, getRequesterId } from "../middleware/agent-acl.js";
import { gcsService } from "../services/storageService.js";
import { createLogger } from "../logger.js";

const log = createLogger("design-shares");
const MAX_HTML_BYTES = 10 * 1024 * 1024;
const TOKEN_HEADER = "x-design-share-token";
const TOKEN_RE = /^[A-Za-z0-9_-]{40,80}$/;
const ALLOWED_EXPIRY_DAYS = new Set([1, 7, 30, 90]);

export const designSharesRouter = Router();
export const publicDesignSharesRouter = Router();

function tokenHash(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

function makeToken(): {
  raw: string;
  hash: string;
  ciphertext: string;
  iv: string;
  authTag: string;
} {
  const raw = randomBytes(32).toString("base64url");
  const encrypted = encrypt(raw, CONFIG.encryptionKey);
  return { raw, hash: tokenHash(raw), ...encrypted };
}

function decryptToken(share: { tokenCiphertext: string; tokenIv: string; tokenAuthTag: string }): string {
  return decrypt(share.tokenCiphertext, share.tokenIv, share.tokenAuthTag, CONFIG.encryptionKey);
}

function sharePath(rawToken: string): string {
  // The bearer lives in the URL fragment, which browsers never send to the
  // frontend server or access logs. The public viewer forwards it to the API
  // in a header; API request URLs therefore remain secret-free too.
  return `/claw/v3/design/shared#${encodeURIComponent(rawToken)}`;
}

/** Build a browser URL whether FRONTEND_URL is origin-rooted or already `/claw`-rooted. */
export function designShareUrl(path: string): string {
  const frontendBase = CONFIG.frontendUrl.replace(/\/+$/, "");
  const relativePath = frontendBase.endsWith("/claw") && path.startsWith("/claw/")
    ? path.slice("/claw".length)
    : path;
  return `${frontendBase}${relativePath}`;
}

function ownerResponse(
  share: {
    id: string;
    title: string;
    attachmentId: string;
    conversationId: string;
    expiresAt: Date | null;
    revokedAt: Date | null;
    viewCount: number;
    createdAt: Date;
    updatedAt: Date;
  },
  rawToken: string,
) {
  return {
    id: share.id,
    title: share.title,
    attachmentId: share.attachmentId,
    conversationId: share.conversationId,
    sharePath: sharePath(rawToken),
    expiresAt: share.expiresAt?.toISOString() ?? null,
    revokedAt: share.revokedAt?.toISOString() ?? null,
    viewCount: share.viewCount,
    createdAt: share.createdAt.toISOString(),
    updatedAt: share.updatedAt.toISOString(),
  };
}

function parseExpiry(input: unknown): Date | null | "invalid" {
  if (input === undefined || input === null) return null;
  if (typeof input !== "number" || !ALLOWED_EXPIRY_DAYS.has(input)) return "invalid";
  return new Date(Date.now() + input * 24 * 60 * 60 * 1000);
}

/**
 * Service-level share upsert — used by the owner POST route below AND by the
 * webhook result path (auto-publish for /design runs delivered into Spaces
 * threads). Caller is responsible for having verified attachment ownership;
 * this function only manages the share row + token lifecycle.
 */
export async function upsertDesignShare(params: {
  ownerUserId: string;
  orgId: string;
  conversationId: string;
  attachmentId: string;
  title: string;
  expiresAt: Date | null;
}): Promise<{ id: string; sharePath: string; linkChanged: boolean }> {
  const { ownerUserId, orgId, conversationId, attachmentId, expiresAt } = params;
  const title = params.title.slice(0, 160) || "Untitled design";
  const existing = await prisma.designArtifactShare.findUnique({
    where: { ownerUserId_conversationId: { ownerUserId, conversationId } },
  });
  const expired = !!existing?.expiresAt && existing.expiresAt.getTime() <= Date.now();

  if (existing && !existing.revokedAt && !expired) {
    let rawToken: string;
    try {
      rawToken = decryptToken(existing);
      const share = await prisma.designArtifactShare.update({
        where: { id: existing.id },
        data: { attachmentId, title, expiresAt },
      });
      return { id: share.id, sharePath: sharePath(rawToken), linkChanged: false };
    } catch {
      const token = makeToken();
      const share = await prisma.designArtifactShare.update({
        where: { id: existing.id },
        data: {
          tokenHash: token.hash,
          tokenCiphertext: token.ciphertext,
          tokenIv: token.iv,
          tokenAuthTag: token.authTag,
          attachmentId,
          title,
          expiresAt,
          revokedAt: null,
        },
      });
      return { id: share.id, sharePath: sharePath(token.raw), linkChanged: true };
    }
  }

  const token = makeToken();
  const share = existing
    ? await prisma.designArtifactShare.update({
        where: { id: existing.id },
        data: {
          tokenHash: token.hash,
          tokenCiphertext: token.ciphertext,
          tokenIv: token.iv,
          tokenAuthTag: token.authTag,
          attachmentId,
          title,
          expiresAt,
          revokedAt: null,
          viewCount: 0,
          lastViewedAt: null,
        },
      })
    : await prisma.designArtifactShare.create({
        data: {
          tokenHash: token.hash,
          tokenCiphertext: token.ciphertext,
          tokenIv: token.iv,
          tokenAuthTag: token.authTag,
          ownerUserId,
          orgId,
          conversationId,
          attachmentId,
          title,
          expiresAt,
        },
      });
  return { id: share.id, sharePath: sharePath(token.raw), linkChanged: true };
}

/** Publish or update the stable share link for one Design Studio conversation. */
designSharesRouter.post("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerUserId = getRequesterId(req);
    const requestOrgId = getOrgId(req);
    if (!ownerUserId || !requestOrgId) {
      res.status(401).json({ success: false, error: "Authenticated user and organization are required" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const attachmentId = typeof body["attachmentId"] === "string" ? body["attachmentId"].trim() : "";
    const conversationId = typeof body["conversationId"] === "string" ? body["conversationId"].trim() : "";
    const requestedTitle = typeof body["title"] === "string" ? body["title"].trim() : "";
    const expiresAt = parseExpiry(body["expiresInDays"]);
    if (!attachmentId || attachmentId.length > 200 || !conversationId || conversationId.length > 300 || expiresAt === "invalid") {
      res.status(400).json({ success: false, error: "Invalid design share request" });
      return;
    }

    const attachment = await prisma.chatAttachment.findFirst({
      where: { id: attachmentId, uploaderUserId: ownerUserId },
      include: {
        chatMessage: { select: { conversationId: true, userId: true, orgId: true } },
      },
    });
    const isHtml = attachment && (
      attachment.mimeType.toLowerCase().includes("html") ||
      attachment.originalFilename.toLowerCase().endsWith(".html")
    );
    if (
      !attachment || !isHtml || attachment.size > MAX_HTML_BYTES ||
      !attachment.chatMessage || attachment.chatMessage.conversationId !== conversationId ||
      attachment.chatMessage.userId !== ownerUserId || attachment.chatMessage.orgId !== requestOrgId
    ) {
      res.status(404).json({ success: false, error: "Owned Design Studio HTML artifact not found" });
      return;
    }

    const title = (requestedTitle || attachment.originalFilename.replace(/\.html?$/i, "") || "Untitled design").slice(0, 160);
    const existing = await prisma.designArtifactShare.findUnique({
      where: { ownerUserId_conversationId: { ownerUserId, conversationId } },
    });
    const expired = !!existing?.expiresAt && existing.expiresAt.getTime() <= Date.now();
    let rawToken: string;
    let share;

    if (existing && !existing.revokedAt && !expired) {
      try {
        rawToken = decryptToken(existing);
      } catch {
        // Key rotation/malformed legacy ciphertext: rotate rather than leaving
        // the owner with an unrecoverable live link.
        const token = makeToken();
        rawToken = token.raw;
        share = await prisma.designArtifactShare.update({
          where: { id: existing.id },
          data: {
            tokenHash: token.hash,
            tokenCiphertext: token.ciphertext,
            tokenIv: token.iv,
            tokenAuthTag: token.authTag,
            attachmentId,
            title,
            expiresAt,
            revokedAt: null,
          },
        });
      }
      share ??= await prisma.designArtifactShare.update({
        where: { id: existing.id },
        data: { attachmentId, title, expiresAt },
      });
    } else {
      const token = makeToken();
      rawToken = token.raw;
      share = existing
        ? await prisma.designArtifactShare.update({
            where: { id: existing.id },
            data: {
              tokenHash: token.hash,
              tokenCiphertext: token.ciphertext,
              tokenIv: token.iv,
              tokenAuthTag: token.authTag,
              attachmentId,
              title,
              expiresAt,
              revokedAt: null,
              viewCount: 0,
              lastViewedAt: null,
            },
          })
        : await prisma.designArtifactShare.create({
            data: {
              tokenHash: token.hash,
              tokenCiphertext: token.ciphertext,
              tokenIv: token.iv,
              tokenAuthTag: token.authTag,
              ownerUserId,
              orgId: requestOrgId,
              conversationId,
              attachmentId,
              title,
              expiresAt,
            },
          });
    }

    log.info(
      `published shareId=${share.id} ownerUserId=${ownerUserId} conversationId=${conversationId} attachmentId=${attachmentId}`,
    );
    res.json({ success: true, data: ownerResponse(share, rawToken) });
  } catch (err) {
    log.error("publish failed", err);
    res.status(500).json({ success: false, error: "Failed to publish design" });
  }
});

/** Return the active owner-visible link without changing the published version. */
designSharesRouter.get("/conversation/:conversationId", async (req: Request<{ conversationId: string }>, res: Response): Promise<void> => {
  try {
    const ownerUserId = getRequesterId(req);
    const orgId = getOrgId(req);
    if (!ownerUserId || !orgId) {
      res.status(401).json({ success: false, error: "Authentication required" });
      return;
    }
    const share = await prisma.designArtifactShare.findUnique({
      where: { ownerUserId_conversationId: { ownerUserId, conversationId: req.params.conversationId } },
    });
    if (!share || share.orgId !== orgId || share.revokedAt || (share.expiresAt && share.expiresAt.getTime() <= Date.now())) {
      res.json({ success: true, data: null });
      return;
    }
    const rawToken = decryptToken(share);
    res.json({ success: true, data: ownerResponse(share, rawToken) });
  } catch (err) {
    log.error("owner lookup failed", err);
    res.status(500).json({ success: false, error: "Failed to load design share" });
  }
});

designSharesRouter.delete("/:shareId", async (req: Request<{ shareId: string }>, res: Response): Promise<void> => {
  try {
    const ownerUserId = getRequesterId(req);
    const orgId = getOrgId(req);
    if (!ownerUserId || !orgId) {
      res.status(401).json({ success: false, error: "Authentication required" });
      return;
    }
    const result = await prisma.designArtifactShare.updateMany({
      where: { id: req.params.shareId, ownerUserId, orgId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) {
      res.status(404).json({ success: false, error: "Active design share not found" });
      return;
    }
    log.info(`revoked shareId=${req.params.shareId} ownerUserId=${ownerUserId}`);
    res.json({ success: true });
  } catch (err) {
    log.error("revoke failed", err);
    res.status(500).json({ success: false, error: "Failed to revoke design share" });
  }
});

async function resolvePublicShare(req: Request) {
  const raw = req.headers[TOKEN_HEADER];
  if (typeof raw !== "string" || !TOKEN_RE.test(raw)) return null;
  const hash = tokenHash(raw);
  const share = await prisma.designArtifactShare.findUnique({
    where: { tokenHash: hash },
    include: { attachment: true },
  });
  if (!share || share.revokedAt || (share.expiresAt && share.expiresAt.getTime() <= Date.now())) return null;
  // Hash lookup already matched; constant-time comparison avoids accidentally
  // weakening verification if the lookup implementation changes later.
  const actual = Buffer.from(share.tokenHash, "hex");
  const expected = Buffer.from(hash, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return share;
}

publicDesignSharesRouter.get("/metadata", async (req: Request, res: Response): Promise<void> => {
  try {
    const share = await resolvePublicShare(req);
    if (!share) {
      res.status(404).json({ success: false, error: "Shared design not found or no longer available" });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.json({
      success: true,
      data: {
        title: share.title,
        updatedAt: share.updatedAt.toISOString(),
        expiresAt: share.expiresAt?.toISOString() ?? null,
      },
    });
  } catch (err) {
    log.error("public metadata failed", err);
    res.status(500).json({ success: false, error: "Failed to load shared design" });
  }
});

publicDesignSharesRouter.get("/content", async (req: Request, res: Response): Promise<void> => {
  try {
    const share = await resolvePublicShare(req);
    if (!share) {
      res.status(404).json({ success: false, error: "Shared design not found or no longer available" });
      return;
    }
    if (share.attachment.size > MAX_HTML_BYTES) {
      res.status(413).json({ success: false, error: "Shared design is too large" });
      return;
    }

    void prisma.designArtifactShare.update({
      where: { id: share.id },
      data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
    }).catch((err) => log.warn("view count update failed", err));

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(share.attachment.originalFilename)}`);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader(
      "Content-Security-Policy",
      "sandbox allow-scripts allow-forms allow-modals allow-popups; " +
        "default-src 'none'; img-src data: blob: https:; media-src data: blob: https:; " +
        "style-src 'unsafe-inline' https:; font-src data: https:; " +
        "script-src 'unsafe-inline' 'unsafe-eval' https:; connect-src https:; frame-src https:",
    );

    const stream = gcsService.createReadStream(share.attachment.url);
    stream.on("error", (err) => {
      log.error("public content stream failed", err);
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });
    stream.pipe(res);
  } catch (err) {
    log.error("public content failed", err);
    if (!res.headersSent) res.status(500).json({ success: false, error: "Failed to load shared design" });
  }
});
