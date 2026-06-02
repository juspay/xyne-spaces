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

export const agentProviderCredentialsRepository = {
  findByAgentAndProvider: (agentId: string, provider: string) =>
    prisma.agentProviderCredentials.findUnique({
      where: { agentId_provider: { agentId, provider } },
    }),

  listByAgent: (agentId: string) =>
    prisma.agentProviderCredentials.findMany({ where: { agentId } }),

  upsert: (agentId: string, provider: string, data: Record<string, unknown>) =>
    prisma.agentProviderCredentials.upsert({
      where: { agentId_provider: { agentId, provider } },
      create: { agentId, provider, ...data } as never,
      update: data,
    }),

  delete: (agentId: string, provider: string) =>
    prisma.agentProviderCredentials.delete({
      where: { agentId_provider: { agentId, provider } },
    }),
};
