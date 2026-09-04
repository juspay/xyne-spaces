import { agentRepository, agentProviderCredentialsRepository, userProviderCredentialsRepository } from "../repositories/index.js";
import { CONFIG } from "../config.js";
import { decrypt } from "../crypto.js";

export interface ClaudeModelsCredential {
  apiKey: string;
  baseUrl?: string;
  authType?: string;
}

export async function resolveClaudeModelsCredential(input: {
  userId: string;
  agentSlug: string;
  orgId: string | undefined;
  apiKey?: string;
  baseUrl?: string;
  authType?: string;
}): Promise<ClaudeModelsCredential | null> {
  const typedKey = input.apiKey?.trim();
  if (typedKey) {
    return {
      apiKey: typedKey,
      ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
      ...(input.authType ? { authType: input.authType } : {}),
    };
  }

  const userCred = await userProviderCredentialsRepository.findByUserAndProvider(input.userId, "claude");
  if (userCred?.encryptedKey && userCred.iv && userCred.authTag) {
    const baseUrl = input.baseUrl ?? userCred.baseUrl ?? undefined;
    const authType = input.authType ?? userCred.authType ?? undefined;
    return {
      apiKey: decrypt(userCred.encryptedKey, userCred.iv, userCred.authTag, CONFIG.encryptionKey).trim(),
      ...(baseUrl ? { baseUrl } : {}),
      ...(authType ? { authType } : {}),
    };
  }

  const agentRow = await agentRepository.findBySlug(input.agentSlug, input.orgId);
  const agentCred = agentRow ? await agentProviderCredentialsRepository.findByAgentAndProvider(agentRow.id, "claude") : null;
  if (agentCred?.encryptedKey && agentCred.iv && agentCred.authTag) {
    return {
      apiKey: decrypt(agentCred.encryptedKey, agentCred.iv, agentCred.authTag, CONFIG.encryptionKey).trim(),
      ...(agentCred.baseUrl ? { baseUrl: agentCred.baseUrl } : {}),
      ...(agentCred.authType ? { authType: agentCred.authType } : {}),
    };
  }
  return null;
}
