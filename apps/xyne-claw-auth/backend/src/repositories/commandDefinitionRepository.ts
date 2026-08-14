/**
 * Repository for the CommandDefinition table — org-scoped custom slash commands.
 *
 * A custom command is a saved, parameterized `/goal` (template + optional
 * provider/model + budget ceilings). Uniqueness is (orgId, slug), so a slug is
 * unique within an org but two orgs may each define their own `/triage`.
 *
 * Reads are on the message hot path: every unrecognized `/<slug>` triggers ONE
 * indexed lookup by (orgId, slug). Writes happen only via `/command define`.
 */
import { prisma } from "../db.js";

export const commandDefinitionRepository = {
  /** Hot-path lookup: resolve a typed `/<slug>` for an org. */
  findByOrgAndSlug(orgId: string, slug: string) {
    return prisma.commandDefinition.findUnique({
      where: { orgId_slug: { orgId, slug } },
    });
  },

  /** List an org's custom commands (for `/command list`). */
  listByOrg(orgId: string) {
    return prisma.commandDefinition.findMany({
      where: { orgId },
      orderBy: { slug: "asc" },
    });
  },

  /** Create or replace a definition (for `/command define`). */
  upsert(args: {
    orgId: string;
    slug: string;
    template: string;
    description?: string | null;
    provider?: string | null;
    model?: string | null;
    maxTurns?: number | null;
    maxWallClockMs?: number | null;
    createdBy: string;
  }) {
    const data = {
      description: args.description ?? null,
      template: args.template,
      provider: args.provider ?? null,
      model: args.model ?? null,
      maxTurns: args.maxTurns ?? null,
      maxWallClockMs: args.maxWallClockMs ?? null,
      enabled: true,
    };
    return prisma.commandDefinition.upsert({
      where: { orgId_slug: { orgId: args.orgId, slug: args.slug } },
      update: data,
      create: { orgId: args.orgId, slug: args.slug, createdBy: args.createdBy, ...data },
    });
  },

  /** Delete a definition (for `/command delete`). Idempotent. */
  remove(orgId: string, slug: string) {
    return prisma.commandDefinition.deleteMany({ where: { orgId, slug } });
  },
};
