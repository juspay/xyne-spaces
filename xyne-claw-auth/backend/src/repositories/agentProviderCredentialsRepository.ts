/**
 * Agent-scoped provider credentials — the "shared key" fallback used when a
 * user runs an agent without their own personal provider configured.
 *
 * Resolution precedence at dispatch (in webhook.ts / agent-chat.ts / run-stream.ts):
 *   1. userAgentConfig.provider + userProviderCredentials   (personal)
 *   2. agent.config.provider + THIS TABLE                   (shared)
 *   3. "spaces" / LiteLLM platform default                  (fallback)
 *
 * Writes gated by AGENT_OWNER or admin via the route handlers in
 * routes/agents.ts. The decrypted key is NEVER returned by any read endpoint
 * — only ever decrypted in-process at dispatch time.
 */

import { prisma } from "../db.js";
import type { AgentProviderCredentials, SharedProviderCredential } from "@prisma/client";

/** An agent cred row with shared-credential material already substituted in.
 *  Consumers keep treating it like a plain row; `sharedCredentialId` (when
 *  set) tells OAuth-refresh code to persist rotated bundles to the SHARED
 *  row (`shared:<id>:<provider>` single-flight key), not the binding. */
export type EffectiveAgentCredRow = AgentProviderCredentials;

/** Binding rows carry no key material of their own — substitute the shared
 *  credential's secret + defaults, keeping this row's model/baseUrl/
 *  reasoningEffort as per-agent overrides. Non-binding rows pass through. */
function materialize(
  row: AgentProviderCredentials & { sharedCredential: SharedProviderCredential | null },
): EffectiveAgentCredRow {
  const { sharedCredential: shared, ...rest } = row;
  if (!row.sharedCredentialId || !shared) return rest;
  return {
    ...rest,
    encryptedKey: shared.encryptedKey,
    iv: shared.iv,
    authTag: shared.authTag,
    authType: shared.authType,
    model: rest.model ?? shared.model,
    baseUrl: rest.baseUrl ?? shared.baseUrl,
    reasoningEffort: rest.reasoningEffort ?? shared.reasoningEffort,
  };
}

export const agentProviderCredentialsRepository = {
  findByAgentAndProvider: async (agentId: string, provider: string): Promise<EffectiveAgentCredRow | null> => {
    const row = await prisma.agentProviderCredentials.findUnique({
      where: { agentId_provider: { agentId, provider } },
      include: { sharedCredential: true },
    });
    return row ? materialize(row) : null;
  },

  listByAgent: async (agentId: string): Promise<EffectiveAgentCredRow[]> => {
    const rows = await prisma.agentProviderCredentials.findMany({
      where: { agentId },
      include: { sharedCredential: true },
    });
    return rows.map(materialize);
  },

  upsert: (agentId: string, provider: string, data: Record<string, unknown>) =>
    prisma.agentProviderCredentials.upsert({
      where: { agentId_provider: { agentId, provider } },
      create: { agentId, provider, ...data } as never,
      // Writing own key material converts a binding back into a dedicated
      // credential — otherwise the stale sharedCredentialId would keep
      // shadowing the newly connected key at materialize time.
      update: "encryptedKey" in data ? { ...data, sharedCredentialId: null } : data,
    }),

  /** Bind an agent to a shared credential (key fields stay null; model/
   *  reasoningEffort act as per-agent overrides). */
  bindShared: (agentId: string, provider: string, sharedCredentialId: string, overrides?: { model?: string | null; reasoningEffort?: string | null }) =>
    prisma.agentProviderCredentials.upsert({
      where: { agentId_provider: { agentId, provider } },
      create: {
        agentId,
        provider,
        sharedCredentialId,
        encryptedKey: null,
        iv: null,
        authTag: null,
        model: overrides?.model ?? null,
        reasoningEffort: overrides?.reasoningEffort ?? null,
      },
      update: {
        sharedCredentialId,
        encryptedKey: null,
        iv: null,
        authTag: null,
        ...(overrides ? { model: overrides.model ?? null, reasoningEffort: overrides.reasoningEffort ?? null } : {}),
      },
    }),

  delete: (agentId: string, provider: string) =>
    prisma.agentProviderCredentials.delete({
      where: { agentId_provider: { agentId, provider } },
    }),
};
