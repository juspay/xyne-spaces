/**
 * Org-level shared provider credentials ("Team Codex" etc.) — stored ONCE and
 * bound to selected agents via AgentProviderCredentials.sharedCredentialId.
 *
 * Why: per-agent copies of one ChatGPT-account OAuth bundle invalidate each
 * other (every re-auth/refresh of one copy revokes the others' sessions —
 * the 2026-07-14 "codex not working" incident). A shared row means exactly
 * one live provider session per credential; OAuth refresh persists back HERE.
 *
 * Admin-managed (routes/admin.ts). Decrypted key material never leaves
 * dispatch-time code paths.
 */

import { prisma } from "../db.js";

export const sharedProviderCredentialRepository = {
  findById: (id: string) =>
    prisma.sharedProviderCredential.findUnique({ where: { id } }),

  /** Org rows + platform-wide rows (orgId NULL) — both are usable by the org. */
  listByOrg: (orgId: string) =>
    prisma.sharedProviderCredential.findMany({
      where: { OR: [{ orgId }, { orgId: null }] },
      include: {
        agentBindings: {
          select: { agentId: true, provider: true, model: true, agent: { select: { slug: true, name: true } } },
        },
      },
      orderBy: [{ provider: "asc" }, { name: "asc" }],
    }),

  create: (data: {
    /** null = platform-wide (CLAW_ADMIN only — enforced at the routes). */
    orgId: string | null;
    provider: string;
    name: string;
    encryptedKey: string | null;
    iv: string | null;
    authTag: string | null;
    model: string | null;
    baseUrl: string | null;
    authType: string | null;
    reasoningEffort: string | null;
    ownerUserId: string | null;
  }) => prisma.sharedProviderCredential.create({ data }),

  /** OAuth-refresh write-back: rotate the stored bundle in place. */
  persistBundle: (id: string, enc: { encryptedKey: string; iv: string; authTag: string }) =>
    prisma.sharedProviderCredential.update({ where: { id }, data: enc }),

  /** Replace key material + auth metadata (adopt/re-auth path). */
  updateCredential: (
    id: string,
    data: { encryptedKey: string | null; iv: string | null; authTag: string | null; authType: string | null; model?: string | null; baseUrl?: string | null; reasoningEffort?: string | null },
  ) => prisma.sharedProviderCredential.update({ where: { id }, data }),

  delete: (id: string) => prisma.sharedProviderCredential.delete({ where: { id } }),

  countBindings: (id: string) =>
    prisma.agentProviderCredentials.count({ where: { sharedCredentialId: id } }),
};
