import crypto from "node:crypto";
import { CONFIG } from "../config.js";
import { redisService } from "../redis.js";

export interface WriteActionSignaturePayload {
  serverType: string;
  tool: string;
  params: Record<string, unknown>;
  userId: string;
  agentSlug?: string | undefined;
  spacesAppId?: string | undefined;
  issuedAt: number;
  nonce: string;
}

export interface SignWriteActionInput {
  serverType: string;
  tool: string;
  params: Record<string, unknown>;
  userId: string;
  agentSlug?: string | undefined;
  spacesAppId?: string | undefined;
  issuedAt?: number;
  nonce?: string;
}

export const WRITE_ACTION_MAX_AGE_MS = 10 * 60 * 1000;

function canonicalize(payload: WriteActionSignaturePayload): string {
  return JSON.stringify({
    serverType: payload.serverType,
    tool: payload.tool,
    params: payload.params,
    userId: payload.userId,
    agentSlug: payload.agentSlug,
    spacesAppId: payload.spacesAppId,
    issuedAt: payload.issuedAt,
    nonce: payload.nonce,
  });
}

function hmac(payload: string): string {
  return crypto.createHmac("sha256", CONFIG.encryptionKey).update(payload).digest("hex");
}

export async function signWriteAction(
  input: SignWriteActionInput,
): Promise<WriteActionSignaturePayload & { signature: string }> {
  const issuedAt = input.issuedAt ?? Date.now();
  const nonce = input.nonce ?? crypto.randomUUID();
  const payload: WriteActionSignaturePayload = {
    serverType: input.serverType,
    tool: input.tool,
    params: input.params,
    userId: input.userId,
    agentSlug: input.agentSlug,
    spacesAppId: input.spacesAppId,
    issuedAt,
    nonce,
  };
  const signature = hmac(canonicalize(payload));
  return { ...payload, signature };
}

export async function verifyWriteActionSignature(
  payload: WriteActionSignaturePayload,
  signature: string,
): Promise<boolean> {
  const now = Date.now();
  if (
    typeof payload.issuedAt !== "number" ||
    Number.isNaN(payload.issuedAt) ||
    now - payload.issuedAt > WRITE_ACTION_MAX_AGE_MS ||
    payload.issuedAt > now + 60_000
  ) {
    return false;
  }

  const expected = hmac(canonicalize(payload));
  try {
    if (!crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"))) {
      return false;
    }
  } catch {
    return false;
  }

  const consumed = await redisService.isNonceConsumed(payload.nonce);
  if (consumed) {
    return false;
  }

  const ttl = Math.max(1, Math.ceil((WRITE_ACTION_MAX_AGE_MS - (now - payload.issuedAt)) / 1000));
  const marked = await redisService.markNonceConsumed(payload.nonce, ttl);
  if (!marked) {
    return false;
  }

  return true;
}
