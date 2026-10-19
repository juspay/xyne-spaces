import type { SharedProviderCredential } from "@prisma/client";
import { prisma } from "../db.js";
import { createLogger } from "../logger.js";
import { errMsg } from "./errors.js";

const log = createLogger("shared-credential-override");

export interface SharedCredentialOverrideContext {
  provider: string;
  sharedCredentialId: string;
  agentId?: string;
  userId?: string;
}

export type SharedCredentialOverrideResolver = (
  context: SharedCredentialOverrideContext,
) => Promise<string | null> | string | null;

let resolver: SharedCredentialOverrideResolver | null = null;

export function setSharedCredentialOverride(next: SharedCredentialOverrideResolver | null): void {
  resolver = next;
}

export async function resolveSharedCredentialOverride(context: SharedCredentialOverrideContext): Promise<string | null> {
  if (!resolver) return null;
  try {
    const replacementId = await resolver(context);
    return replacementId && replacementId !== context.sharedCredentialId ? replacementId : null;
  } catch (err) {
    log.warn(`[shared-credential-override] resolver failed for ${context.provider}/${context.sharedCredentialId}: ${errMsg(err)}`);
    return null;
  }
}

export async function applySharedCredentialOverride<
  T extends { provider: string; sharedCredentialId: string | null; sharedCredential: SharedProviderCredential | null },
>(row: T, owner: { agentId?: string; userId?: string }): Promise<T> {
  if (!resolver || !row.sharedCredentialId) return row;
  const replacementId = await resolveSharedCredentialOverride({
    provider: row.provider,
    sharedCredentialId: row.sharedCredentialId,
    ...owner,
  });
  if (!replacementId) return row;
  const replacement = await prisma.sharedProviderCredential.findUnique({ where: { id: replacementId } });
  if (!replacement || replacement.provider !== row.provider) return row;
  return { ...row, sharedCredentialId: replacement.id, sharedCredential: replacement };
}
