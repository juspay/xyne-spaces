/**
 * Verify the `X-Xyne-Signature` HMAC-SHA256 Spaces puts on every outbound
 * webhook call.
 *
 * Flow:
 *   1. Look up the agent by `req.params.agentSlug`.
 *   2. Decrypt `agents.signingSecret` (GCM 3-tuple).
 *   3. Compute HMAC-SHA256 over the RAW request body.
 *   4. Timing-safe compare against `X-Xyne-Signature` header (hex).
 *
 * Rollout modes (env `SPACES_WEBHOOK_VERIFY_MODE`):
 *   - `warn` (default): log mismatches but call next(). Safe for staged
 *     rollout while backfill catches up.
 *   - `enforce`: reject with 401 on any mismatch (or missing material).
 *
 * Notes / gotchas:
 *   - Requires `req.rawBody` set by the json `verify` callback in main.ts.
 *     If the body wasn't JSON or was empty we treat raw as `Buffer.alloc(0)`.
 *   - Reused for /webhook/:agentSlug only. The generic /webhook (no slug)
 *     route has no agent-attribution and is left alone — that path is
 *     legacy and not used in current Spaces flows.
 *   - Does NOT change req body shape. Downstream handlers continue to read
 *     req.body (JSON-parsed) as before.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { CONFIG } from "../config.js";
import { decrypt } from "../crypto.js";
import { prisma } from "../db.js";

const MODE = (process.env["SPACES_WEBHOOK_VERIFY_MODE"] ?? "warn").toLowerCase();
const ENFORCE = MODE === "enforce";

function parseGcmBundle(blob: string): [string, string, string] | null {
  const parts = blob.split(":");
  if (parts.length !== 3) return null;
  const [ciphertext, iv, authTag] = parts;
  if (!ciphertext || !iv || !authTag) return null;
  return [ciphertext, iv, authTag];
}

function tag(slug: string, reason: string): string {
  return `[verify-spaces-sig] slug=${slug} reason=${reason}`;
}

export async function verifySpacesSignature(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const slug = (req.params as { agentSlug?: string }).agentSlug ?? "(none)";

  // 1. Resolve the agent + its stored secret.
  const agent = slug !== "(none)"
    ? await prisma.agent.findFirst({ where: { slug }, select: { id: true, signingSecret: true } })
    : null;

  if (!agent?.signingSecret) {
    if (!ENFORCE) {
      console.warn(tag(slug, "no_stored_secret") + " — warn-only, passing through");
      return next();
    }
    res.status(401).json({ success: false, error: "missing signing secret" });
    return;
  }

  // 2. Decrypt with claw-auth's GCM scheme.
  const parts = parseGcmBundle(agent.signingSecret);
  if (!parts) {
    console.warn(tag(slug, "malformed_secret_blob") + " — treating as no secret");
    if (!ENFORCE) return next();
    res.status(401).json({ success: false, error: "malformed signing secret" });
    return;
  }
  let plaintextSecret: string;
  try {
    plaintextSecret = decrypt(parts[0], parts[1], parts[2], CONFIG.encryptionKey);
  } catch (err) {
    console.warn(tag(slug, "decrypt_failed") + ` — ${err instanceof Error ? err.message : String(err)}`);
    if (!ENFORCE) return next();
    res.status(401).json({ success: false, error: "secret decrypt failed" });
    return;
  }

  // 3. Compute HMAC over the raw body.
  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
  const expected = createHmac("sha256", plaintextSecret).update(rawBody).digest("hex");

  // 4. Compare with the header.
  const received = req.headers["x-xyne-signature"];
  if (typeof received !== "string" || received.length === 0) {
    console.warn(tag(slug, "no_signature_header") + " — caller did not sign request");
    if (!ENFORCE) return next();
    res.status(401).json({ success: false, error: "missing X-Xyne-Signature" });
    return;
  }

  const recBuf = Buffer.from(received, "hex");
  const expBuf = Buffer.from(expected, "hex");
  const matches = recBuf.length === expBuf.length && timingSafeEqual(recBuf, expBuf);

  if (!matches) {
    console.warn(tag(slug, "mismatch") + ` — bodyBytes=${rawBody.length} headerLen=${received.length}`);
    if (!ENFORCE) return next();
    res.status(401).json({ success: false, error: "invalid signature" });
    return;
  }

  next();
}
