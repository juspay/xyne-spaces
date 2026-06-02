import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

const INCLUDE_TOOLS_SKILLS = {
  tools: { include: { tool: true } },
  // Pull each AgentSkill → Skill → SkillFile[] in one query so the dispatch
  // layer (webhook.ts, agent-chat.ts, etc.) can forward each skill's
  // attached files to claw's /run payload. Without this nested include,
  // only SKILL.md content reaches the worker session and any tool needing
  // a sibling file off the skill dir (e.g. fill-pdf-form looking for
  // cam-templates/template.pdf) gets ENOENT.
  skills: { include: { skill: { include: { files: true } } } },
} as const;

export const agentRepository = {
  findBySlug: (slug: string) =>
    prisma.agent.findUnique({ where: { slug } }),

  findBySlugWithRelations: (slug: string) =>
    prisma.agent.findUnique({ where: { slug }, include: { ...INCLUDE_TOOLS_SKILLS, owner: true } }),

  findById: (id: string) =>
    prisma.agent.findUnique({ where: { id } }),

  findByIds: (ids: string[]) =>
    ids.length === 0 ? Promise.resolve([]) : prisma.agent.findMany({ where: { id: { in: ids } } }),

  findByAppUserId: (appUserId: string) =>
    prisma.agent.findFirst({ where: { spacesAppUserId: appUserId } }),

  findDefault: () =>
    prisma.agent.findFirst({ where: { isDefault: true, enabled: true } }),

  findByNameInsensitive: (name: string) =>
    prisma.agent.findFirst({ where: { name: { equals: name, mode: "insensitive" } } }),

  listVisible: (userId?: string) =>
    prisma.agent.findMany({
      where: userId
        ? { OR: [{ scope: "global" }, { ownerUserId: userId }, { shares: { some: { userId } } }] }
        : { scope: "global" },
      include: { ...INCLUDE_TOOLS_SKILLS, owner: true },
      orderBy: { name: "asc" as const },
    }),

  create: (data: Prisma.AgentCreateInput) =>
    prisma.agent.create({ data, include: INCLUDE_TOOLS_SKILLS }),

  update: (slug: string, data: Prisma.AgentUpdateInput) =>
    prisma.agent.update({ where: { slug }, data, include: INCLUDE_TOOLS_SKILLS }),

  updateById: (id: string, data: Prisma.AgentUpdateInput) =>
    prisma.agent.update({ where: { id }, data, include: INCLUDE_TOOLS_SKILLS }),

  delete: (slug: string) =>
    prisma.agent.delete({ where: { slug } }),

  // Skills (junction table)
  upsertSkill: (agentId: string, skillId: string) =>
    prisma.agentSkill.upsert({
      where: { agentId_skillId: { agentId, skillId } },
      create: { agentId, skillId },
      update: {},
      include: { skill: true },
    }),

  deleteSkill: (agentId: string, skillId: string) =>
    prisma.agentSkill.delete({ where: { agentId_skillId: { agentId, skillId } } }),

  deleteAllSkills: (agentId: string) =>
    prisma.agentSkill.deleteMany({ where: { agentId } }),

  listSkills: (agentId: string) =>
    prisma.agentSkill.findMany({ where: { agentId }, include: { skill: true } }),

  // Tools
  upsertTool: (agentId: string, toolId: string, permission: string) =>
    prisma.agentTool.upsert({
      where: { agentId_toolId: { agentId, toolId } },
      create: { agentId, toolId, permission },
      update: { permission },
      include: { tool: true },
    }),

  deleteTool: (agentId: string, toolId: string) =>
    prisma.agentTool.delete({ where: { agentId_toolId: { agentId, toolId } } }),

  findToolById: (id: string) =>
    prisma.tool.findUnique({ where: { id } }),

  /** Aggregate counts for the admin dashboard overview. */
  dashboardStats: async () => {
    const [total, globalEnabled, globalDisabled, personalEnabled, personalDisabled, pendingRequests,
      registeredTotal, registeredGlobal, registeredPersonal] = await Promise.all([
      prisma.agent.count(),
      prisma.agent.count({ where: { scope: "global", enabled: true } }),
      prisma.agent.count({ where: { scope: "global", enabled: false } }),
      prisma.agent.count({ where: { scope: "personal", enabled: true } }),
      prisma.agent.count({ where: { scope: "personal", enabled: false } }),
      prisma.agentRequest.count({ where: { status: "pending", targetType: "agent" } }),
      // Spaces registration: spacesAppId is set = registered
      prisma.agent.count({ where: { spacesAppId: { not: null } } }),
      prisma.agent.count({ where: { scope: "global", spacesAppId: { not: null } } }),
      prisma.agent.count({ where: { scope: "personal", spacesAppId: { not: null } } }),
    ]);
    const globalTotal = globalEnabled + globalDisabled;
    return {
      totalAgents: total,
      global: { enabled: globalEnabled, disabled: globalDisabled, total: globalTotal },
      personal: { enabled: personalEnabled, disabled: personalDisabled, total: personalEnabled + personalDisabled },
      registration: {
        registered: registeredGlobal,
        notRegistered: globalTotal - registeredGlobal,
        globalRegistered: registeredGlobal,
        personalRegistered: registeredPersonal,
      },
      pendingRequests,
    };
  },

  /** Per-agent metadata for dashboard table (no heavy joins). */
  listForDashboard: () =>
    prisma.agent.findMany({
      select: {
        id: true, slug: true, name: true, description: true,
        scope: true, enabled: true, ownerUserId: true,
        spacesAppId: true,
        createdAt: true, promotedAt: true,
        owner: { select: { id: true, name: true, email: true } },
        _count: { select: { tools: true, skills: true, shares: true } },
      },
      orderBy: { createdAt: "desc" },
    }),

  /**
   * Per-user personal agent counts for admin dashboard.
   * Returns each user who owns at least one personal agent.
   */
  userPersonalAgentBreakdown: async () => {
    const rows = await prisma.agent.findMany({
      where: { scope: "personal", ownerUserId: { not: null } },
      select: {
        ownerUserId: true,
        owner: { select: { id: true, name: true, email: true } },
        enabled: true,
        spacesAppId: true,
        slug: true,
        name: true,
      },
      orderBy: { createdAt: "desc" },
    });
    // Group by owner
    const map = new Map<string, {
      userId: string; userName: string | null; userEmail: string | null;
      total: number; enabled: number; registered: number;
      agents: { slug: string; name: string; enabled: boolean; registered: boolean }[];
    }>();
    for (const r of rows) {
      if (!r.ownerUserId) continue;
      const entry = map.get(r.ownerUserId) ?? {
        userId: r.ownerUserId,
        userName: r.owner?.name ?? null,
        userEmail: r.owner?.email ?? null,
        total: 0, enabled: 0, registered: 0,
        agents: [],
      };
      entry.total++;
      if (r.enabled) entry.enabled++;
      if (r.spacesAppId) entry.registered++;
      entry.agents.push({ slug: r.slug, name: r.name, enabled: r.enabled, registered: Boolean(r.spacesAppId) });
      map.set(r.ownerUserId, entry);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  },

  /** Fetch personal agents owned by a set of users (for admin unified user table). */
  listPersonalAgentsByOwners: (ownerUserIds: string[]) =>
    ownerUserIds.length === 0
      ? Promise.resolve([])
      : prisma.agent.findMany({
          where: { scope: "personal", ownerUserId: { in: ownerUserIds } },
          select: {
            slug: true,
            name: true,
            scope: true,
            enabled: true,
            ownerUserId: true,
            spacesAppId: true,
            _count: { select: { tools: true, skills: true, shares: true } },
          },
        }),



  /**
   * Skill adoption across global agents.
   * "Which skills are attached to the most global agents?"
   *
   * Uses `$queryRaw` because Prisma's `groupBy` only supports the numeric
   * aggregates (`_count` / `_sum` / `_min` / `_max` / `_avg`) and cannot
   * express Postgres' `STRING_AGG(DISTINCT a.name, ', ' ORDER BY a.name)`.
   * The alternative — fetching every agent_skills row and aggregating in
   * Node — would be the very anti-pattern Rule 18/90 flags, so the raw
   * SQL is the correct trade-off here. Read-only, parameter-free, no
   * injection surface.
   */
  skillUsageByGlobalAgents: async () => {
    type Row = {
      skill_id: string;
      skill_slug: string;
      skill_name: string;
      skill_source: string;
      agent_count: bigint;
      agent_names: string;
    };
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT
        s.id                                               AS skill_id,
        s.slug                                             AS skill_slug,
        s.name                                             AS skill_name,
        s.source                                           AS skill_source,
        COUNT(DISTINCT a.id)::bigint                       AS agent_count,
        STRING_AGG(DISTINCT a.name, ', ' ORDER BY a.name)  AS agent_names
      FROM agent_skills aks
      JOIN skills s ON s.id = aks."skillId"
      JOIN agents a ON a.id = aks."agentId"
      WHERE a.scope = 'global'
      GROUP BY s.id, s.slug, s.name, s.source
      ORDER BY agent_count DESC, s.name ASC
    `;
    return rows.map((r) => ({
      skillId: r.skill_id,
      skillSlug: r.skill_slug,
      skillName: r.skill_name,
      skillSource: r.skill_source,
      agentCount: Number(r.agent_count),
      agentNames: r.agent_names ? r.agent_names.split(", ") : [],
    }));
  },

  subagentUsageByGlobalAgents: async () => {
    type Row = {
      subagent_name: string;
      agent_count: bigint;
      agent_names: string;
    };
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT
        subagent_name,
        COUNT(DISTINCT a.id)::bigint                       AS agent_count,
        STRING_AGG(DISTINCT a.name, ', ' ORDER BY a.name)  AS agent_names
      FROM agents a,
        jsonb_array_elements_text(
          COALESCE(a.config->'tools'->'subagents', '[]'::jsonb)
        ) AS subagent_name
      WHERE a.scope = 'global'
        AND a.config->'tools'->'subagents' IS NOT NULL
        AND jsonb_array_length(a.config->'tools'->'subagents') > 0
      GROUP BY subagent_name
      ORDER BY agent_count DESC, subagent_name ASC
    `;
    return rows.map((r) => ({
      subagentName: r.subagent_name,
      agentCount: Number(r.agent_count),
      agentNames: r.agent_names ? r.agent_names.split(", ") : [],
    }));
  },
};

