/**
 * Verify the `X-Xyne-Signature` HMAC-SHA256 Spaces puts on every outbound
 * webhook call.
 *
 * Flow:
 *   1. Look up the agent by `req.params.spacesAppId` on /webhook/app/:spacesAppId,
 *      otherwise by `req.params.agentSlug`.
 *   2. Decrypt `agents.signingSecret` (GCM 3-tuple).
 *   3. Compute HMAC-SHA256 over the RAW request body.
 *   4. Timing-safe compare against `X-Xyne-Signature` header (hex).
 *
 * Verification is always fail-closed: reject with 401 on any mismatch or
 * missing material. The webhook handler treats the event payload's
 * userId/channelId as authoritative and runs agents with that user's
 * credentials, so an unsigned/forged event is full impersonation. There is no
 * general environment-controlled bypass.
 *
 * Temporary rollout bridge: `ALLOW_UNSIGNED_SPACES_FLOW_ACTIONS` defaults to
 * `true` and permits only legacy `X-Xyne-Event: flow_action` requests whose
 * signature header is absent. Set it explicitly to `false` to close the bridge.
 * This exists solely so claw-auth can be deployed before the matching Spaces
 * flow-action signer. It does not permit mismatched signatures and must be
 * removed after the Spaces deployment is verified.
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

import { createLogger } from "../logger.js";
const log = createLogger("verify-spaces-signature");

function parseGcmBundle(blob: string): [string, string, string] | null {
  const parts = blob.split(":");
  if (parts.length !== 3) return null;
  const [ciphertext, iv, authTag] = parts;
  if (!ciphertext || !iv || !authTag) return null;
  return [ciphertext, iv, authTag];
}

function tag(key: string, reason: string): string {
  return `[verify-spaces-sig] ${key} reason=${reason}`;
}

/**
 * TEMPORARY diagnostic for the `reason=mismatch` investigation. When the raw
 * body fails verification but the secret is known-correct, the body was mutated
 * in transit (proxy/ingress re-serialization, whitespace, BOM, line-endings).
 * This tests candidate canonicalizations and reports which (if any) reconciles
 * the body with the signature — WITHOUT logging the secret or any body content.
 * Remove once the canonicalization is identified and fixed at the source.
 */
function diagnoseMismatch(rawBody: Buffer, secret: string, received: string): string {
  const hmac = (s: string | Buffer): string => createHmac("sha256", secret).update(s).digest("hex");
  const text = rawBody.toString("utf8");
  const candidates: Array<[string, string | Buffer]> = [["raw", rawBody]];
  try { candidates.push(["trimEnd", text.replace(/\s+$/, "")]); } catch { /* noop */ }
  try { candidates.push(["trimStart", text.replace(/^\s+/, "")]); } catch { /* noop */ }
  try { if (text.charCodeAt(0) === 0xfeff) candidates.push(["stripBOM", text.slice(1)]); } catch { /* noop */ }
  try { candidates.push(["lf2crlf", text.replace(/\n/g, "\r\n")]); } catch { /* noop */ }
  try { candidates.push(["crlf2lf", text.replace(/\r\n/g, "\n")]); } catch { /* noop */ }
  let parses = false;
  try { candidates.push(["reserialize", JSON.stringify(JSON.parse(text))]); parses = true; } catch { /* not json */ }
  let hit = "none";
  for (const [name, value] of candidates) {
    try { if (hmac(value) === received) { hit = name; break; } } catch { /* noop */ }
  }
  const bodySha = createHmac("sha256", "diag").update(rawBody).digest("hex").slice(0, 12);
  return `match=${hit} parses=${parses} bodyBytes=${rawBody.length} bodySha=${bodySha}`;
}

export async function verifySpacesSignature(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const params = req.params as { agentSlug?: string; spacesAppId?: string };
  const spacesAppId = params.spacesAppId;
  const slug = params.agentSlug;
  const lookupTag = spacesAppId ? `spacesAppId=${spacesAppId}` : `slug=${slug ?? "(none)"}`;

  const reject = (reason: string, error: string, detail?: string): void => {
    // One stable, grep-friendly log for every rejected webhook. Never include
    // the signature, secret, or request body.
    log.warn(
      tag(lookupTag, reason)
      + ` agentId=${agent?.id ?? "(not-found)"}`
      + (detail ? ` ${detail}` : ""),
    );
    res.status(401).json({ success: false, error });
  };

  // 1. Resolve the agent + its stored secret.
  let agent: { id: string; signingSecret: string | null } | null = null;
  if (spacesAppId) {
    agent = await prisma.agent.findFirst({ where: { spacesAppId }, select: { id: true, signingSecret: true } });
  } else if (slug) {
    const matches = await prisma.agent.findMany({
      where: { slug },
      select: { id: true, signingSecret: true, orgId: true },
      take: 2,
    });
    if (matches.length > 1) {
      log.error(tag(lookupTag, "ambiguous_legacy_slug") + ` — matched multiple orgs; rejecting legacy route`);
      res.status(404).json({ success: false, error: "agent not found" });
      return;
    }
    agent = matches[0] ?? null;
  }

  if (!agent?.signingSecret) {
    reject("no_stored_secret", "missing signing secret");
    return;
  }

  // 2. Decrypt with claw-auth's GCM scheme.
  const parts = parseGcmBundle(agent.signingSecret);
  if (!parts) {
    reject("malformed_secret_blob", "malformed signing secret");
    return;
  }
  let plaintextSecret: string;
  try {
    plaintextSecret = decrypt(parts[0], parts[1], parts[2], CONFIG.encryptionKey);
  } catch (err) {
    reject("decrypt_failed", "secret decrypt failed", `error=${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  // 3. Compute HMAC over the raw body.
  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
  const expected = createHmac("sha256", plaintextSecret).update(rawBody).digest("hex");

  // 4. Compare with the header.
  const received = req.headers["x-xyne-signature"];
  if (typeof received !== "string" || received.length === 0) {
    const temporaryUnsignedFlowAction =
      (process.env["ALLOW_UNSIGNED_SPACES_FLOW_ACTIONS"] ?? "true") === "true" &&
      req.headers["x-xyne-event"] === "flow_action";
    if (temporaryUnsignedFlowAction) {
      log.error(
        tag(lookupTag, "temporary_unsigned_flow_action_bypass") +
        ` agentId=${agent.id} — REMOVE after the Spaces flow-action signer is deployed`,
      );
      next();
      return;
    }
    reject("no_signature_header", "missing X-Xyne-Signature");
    return;
  }

  const recBuf = Buffer.from(received, "hex");
  const expBuf = Buffer.from(expected, "hex");
  const matches = recBuf.length === expBuf.length && timingSafeEqual(recBuf, expBuf);

  if (!matches) {
    reject("mismatch", "invalid signature", `bodyBytes=${rawBody.length} headerLen=${received.length} ${diagnoseMismatch(rawBody, plaintextSecret, received)}`);
    return;
  }

  next();
}
