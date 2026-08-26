import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { randomBytes } from "node:crypto";
import { ORG_SCOPED_SLUGS } from "../lib/org-scoped-slugs.js";
import { createLogger } from "../logger.js";

const log = createLogger("agent-repository");

/**
 * Build a unique, schema-valid slug for a clone. Strips any prior "-copy…"
 * suffix off the source slug, trims to leave room, and appends a short random
 * token. Pre-checks the DB and retries a few times; the DB unique index is the
 * real guard (caller catches P2002 and retries if we still race).
 */
async function buildCloneSlug(sourceSlug: string, orgId?: string | null): Promise<string> {
  const root = sourceSlug
    .replace(/-copy(-[a-z0-9]+)?$/, "")
    .slice(0, 40)
    .replace(/-+$/, "") || "agent";
  for (let i = 0; i < 6; i++) {
    const token = randomBytes(3).toString("hex"); // 6 lowercase hex chars
    const candidate = `${root}-copy-${token}`;
    const clash = ORG_SCOPED_SLUGS
      ? orgId
        ? await prisma.agent.findUnique({
          where: { orgId_slug: { orgId, slug: candidate } },
        })
        : null
      : null;
    if (!clash) return candidate;
  }
  return `${root}-copy-${Date.now().toString(36)}`;
}

const INCLUDE_TOOLS_SKILLS = {
  tools: { include: { tool: true } },
  // Pull each AgentSkill → Skill → SkillFile[] in one query so the dispatch
  // layer (webhook.ts, agent-chat.ts, etc.) can forward each skill's
  // attached files to claw's /run payload. Without this nested include,
  // only SKILL.md content reaches the worker session and any tool needing
  // a sibling file off the skill dir (e.g. fill-pdf-form looking for
  // cam-templates/template.pdf) gets ENOENT.
  skills: { include: { skill: { include: { files: true } } } },
  // Knowledge Base grants — opaque foreign ids into the spaces backend. We
  // pull them everywhere we pull skills so /mcp/tools and the agent-config
  // editor can both render them without a second query.
  collections: true,
} as const;

/**
 * The one definition of "this user may use this agent": org-global, owned, or
 * explicitly shared. Kept beside `listVisible`, which applies the same rule to
 * the agent list, so a change to what "visible" means cannot drift between the
 * list a user is shown and the agents they can actually address.
 *
 * Org scoping is applied separately by the caller — it is a different question
 * (which tenant) from this one (which agent within it).
 */
export function agentVisibleToUser(userId: string): Prisma.AgentWhereInput {
  return {
    OR: [{ scope: "global" }, { ownerUserId: userId }, { shares: { some: { userId } } }],
  };
}

export const agentRepository = {
  /**
   * Resolve a slug to an agent the caller is actually allowed to use.
   *
   * `findBySlug` scopes by org only, which makes every agent in an org
   * addressable by slug regardless of whether it is private to another user.
   * Execution paths — chatting, regenerating, forking — must use this instead:
   * the slug is caller-supplied, so org scoping alone is tenant isolation, not
   * authorization.
   *
   * Returns null both when the agent does not exist and when it exists but is
   * not visible, so callers 404 either way. That is deliberate: a distinct 403
   * would confirm the slug to someone probing for other users' private agents.
   */
  findBySlugVisibleTo: (slug: string, orgId: string | null | undefined, userId: string | null | undefined) => {
    if (!orgId) {
      log.error("[agentRepository.findBySlugVisibleTo] missing orgId; refusing global slug lookup", { slug });
      return Promise.resolve(null);
    }
    if (!userId) {
      log.error("[agentRepository.findBySlugVisibleTo] missing userId; refusing unscoped slug lookup", { slug });
      return Promise.resolve(null);
    }
    return prisma.agent.findFirst({
      where: { AND: [{ orgId, slug }, agentVisibleToUser(userId)] },
    });
  },

  findBySlug: (slug: string, orgId?: string | null) => {
    if (!orgId) {
      log.error("[agentRepository.findBySlug] missing orgId; refusing global slug lookup", { slug });
      return Promise.resolve(null);
    }
    return prisma.agent.findUnique({
      where: { orgId_slug: { orgId, slug } },
    });
  },

  findBySlugWithRelations: (slug: string, orgId?: string | null) => {
    if (!orgId) {
      log.error("[agentRepository.findBySlugWithRelations] missing orgId; refusing global slug lookup", { slug });
      return Promise.resolve(null);
    }
    return prisma.agent.findUnique({
      where: { orgId_slug: { orgId, slug } },
      include: { ...INCLUDE_TOOLS_SKILLS, owner: true },
    });
  },

  /**
   * S2S fallback for callers with NO derivable org — e.g. Spaces' claw-client
   * (automation RUN_AGENT step) fetches agent metadata via GET /agents/:slug
   * with an S2S key but no pinned user, so no org context exists. Same
   * single-match-or-fail rule as the legacy webhook route: serve when the slug
   * matches EXACTLY one agent (always true until a second org reuses a slug),
   * fail loudly on cross-org ambiguity. Never silently picks across orgs.
   */
  findBySlugSingleMatchWithRelations: async (slug: string) => {
    const matches = await prisma.agent.findMany({
      where: { slug },
      include: { ...INCLUDE_TOOLS_SKILLS, owner: true },
      take: 2,
    });
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      log.error("[agentRepository.findBySlugSingleMatchWithRelations] ambiguous slug across orgs; refusing", { slug });
    }
    return null;
  },

  findById: (id: string) =>
    prisma.agent.findUnique({ where: { id } }),

  findByIds: (ids: string[]) =>
    ids.length === 0 ? Promise.resolve([]) : prisma.agent.findMany({ where: { id: { in: ids } } }),

  findByAppUserId: (appUserId: string) =>
    prisma.agent.findFirst({ where: { spacesAppUserId: appUserId } }),

  // Phase-2 §5a: resolve an agent by its globally-unique Spaces app id — the
  // org-agnostic routing key for the external webhook path (once webhook URLs
  // carry the appId instead of the org-ambiguous slug). Returns null for the
  // never-published (null spacesAppId) case.
  findBySpacesAppId: (spacesAppId: string) =>
    prisma.agent.findFirst({ where: { spacesAppId } }),

  // Phase-2: optional org scoping. `isDefault` becomes per-org — a fresh org has
  // no default agent until provisioned, so callers must tolerate null. Omitting
  // orgId keeps today's global behavior (one org → the Juspay default).
  findDefault: (orgId?: string) =>
    prisma.agent.findFirst({ where: { isDefault: true, enabled: true, ...(orgId ? { orgId } : {}) } }),

  findByNameInsensitive: (name: string, orgId?: string) =>
    prisma.agent.findFirst({ where: { name: { equals: name, mode: "insensitive" }, ...(orgId ? { orgId } : {}) } }),

  /**
   * Visibility rules:
   *   - admin            → ALL agents, no filter
   *   - authenticated    → global ∪ owned ∪ shared-with-me
   *   - anonymous (no id) → only global
   *
   * Admin bypass: when `isAdmin` is set, NO filter — every agent is returned.
   * NOTE: this bypass is OPT-IN at the route layer (GET /agents only sets
   * isAdmin=true when `?scope=all` is passed — see routes/agents.ts). The
   * default agent list (the main "My Agents" view) stays filtered to
   * global ∪ owned ∪ shared even for admins; only the admin panel's
   * "All Agents" view requests the full roster. (A blanket bypass on every
   * listing — added 2026-06-06 — leaked every user's private agents into
   * admins' normal list; that is the regression this gating reverts.)
   */
  listVisible: (opts: { userId?: string; isAdmin?: boolean; orgId?: string } = {}) => {
    // Base visibility (scope='global' now means ORG-global once orgId is applied).
    const base: Prisma.AgentWhereInput = opts.isAdmin
      ? {}
      : opts.userId
        ? { OR: [{ scope: "global" }, { ownerUserId: opts.userId }, { shares: { some: { userId: opts.userId } } }] }
        : { scope: "global" };
    // Phase-2: AND the caller's org when provided. Admin-within-org (`?scope=all`
    // + orgId) sees every agent in THAT org; a platform admin with no orgId still
    // sees all orgs (the CLAW_ADMIN cross-org decision stays at the route layer).
    const where: Prisma.AgentWhereInput = opts.orgId ? { AND: [{ orgId: opts.orgId }, base] } : base;
    return prisma.agent.findMany({
      where,
      include: { ...INCLUDE_TOOLS_SKILLS, owner: true },
      orderBy: { name: "asc" as const },
    });
  },

  create: (data: Prisma.AgentCreateInput) =>
    prisma.agent.create({ data, include: INCLUDE_TOOLS_SKILLS }),

  /**
   * Clone an agent into a NEW personal agent owned by `newOwnerId`.
   *
   * The clone is meant to be a WORKING replica, so everything that defines
   * what the agent is and does comes across —
   *   1. systemPrompt   (also seeded as prompt version v1)
   *   2. description / color / modelId / enabled — a paused agent yields a
   *                        paused copy, so cloning never silently puts a
   *                        withdrawn agent back in service
   *   3. config          — the ENTIRE json blob. This is the one that matters:
   *                        `config.tools` is the real tool palette every read
   *                        path uses (mcp.ts parseToolsConfig, the agent-config
   *                        editor), so a clone without it runs tool-less.
   *                        Carries subagents, skillTriggers, planMode,
   *                        promptInjection, sandbox repos, outputFormat, …
   *   4. tools           — AgentTool rows, including each tool's `permission`
   *   5. skills          — AgentSkill junction links
   *   6. knowledge base  — kbScope + every AgentCollection grant
   *   7. MCP connections — ONLY when the cloner already owns the source, since
   *                        the rows carry credential blobs (see below)
   *
   * Everything past that point stays OUT, each for its own reason:
   *   • MCP connections when cloning SOMEONE ELSE's agent — the row's encrypted
   *     credentials are decrypted per-agent at tool-execution time, so a copy
   *     is a standing grant on the source owner's third-party account that
   *     survives share revocation and deletion of the source connection.
   *   • `delegationTier` — admin-only on the update route ("Only claw admins
   *     can change delegationTier") and not settable on create, so copying it
   *     would make cloning the one non-admin path to an elevated tier.
   *   • Spaces app identity (`spacesAppId` is @unique, plus `spacesAppToken` /
   *     `signingSecret`) and SurfaceAgent registrations — these are WHO the
   *     agent is on an external surface. A copy would receive the source's
   *     webhooks and sign as it.
   *   • `scope` / `isDefault` / `ownerUserId` / `orgId` — the clone is a
   *     PERSONAL agent belonging to the caller; inheriting `scope: "global"`
   *     would publish it org-wide on creation.
   *   • AgentShare rows — the source's ACL. Copying would hand third parties
   *     access to someone else's brand-new private agent.
   *   • Provider credentials, A2A delegation grants, prompt-version history and
   *     per-user agent config — left to the clone's owner to (re)establish.
   *
   * Still an explicit allow-list — we never spread the source row, so a future
   * secret-bearing column can't silently leak into clones.
   *
   * Returns the fully-hydrated clone (tools + skills + collections), or null
   * if the source agent no longer exists.
   */
  cloneAgentForUser: async (
    sourceId: string,
    newOwnerId: string,
    opts: { name?: string } = {},
  ) => {
    const source = await prisma.agent.findUnique({
      where: { id: sourceId },
      include: {
        tools: true,
        skills: true,
        collections: true,
        mcpConnections: true,
      },
    });
    if (!source) return null;

    const name = (opts.name?.trim() || `${source.name} (Copy)`).slice(0, 200);
    const systemPrompt = source.systemPrompt;

    // Phase-2: the clone is a PERSONAL agent for `newOwnerId`, so it belongs to
    // the new owner's org (not necessarily the source's). Without this the clone
    // is born orgId=null → excluded from the org-scoped `listVisible` and 404s in
    // the org-scoped ACL middleware. `User.orgId` is NOT NULL, so this resolves
    // for any real user.
    const owner = await prisma.user.findUnique({ where: { id: newOwnerId }, select: { orgId: true } });
    const slug = await buildCloneSlug(source.slug, owner?.orgId);

    return prisma.$transaction(async (tx) => {
      const clone = await tx.agent.create({
        data: {
          slug,
          name,
          systemPrompt,
          description: source.description,
          color: source.color,
          modelId: source.modelId,
          enabled: source.enabled,
          kbScope: source.kbScope,
          config: source.config as Prisma.InputJsonValue,
          scope: "personal",
          owner: { connect: { id: newOwnerId } },
          ...(owner?.orgId ? { org: { connect: { id: owner.orgId } } } : {}),
        },
      });

      if (source.tools.length > 0) {
        await tx.agentTool.createMany({
          data: source.tools.map((t) => ({
            agentId: clone.id,
            toolId: t.toolId,
            permission: t.permission,
          })),
        });
      }

      if (source.skills.length > 0) {
        await tx.agentSkill.createMany({
          data: source.skills.map((sk) => ({ agentId: clone.id, skillId: sk.skillId })),
        });
      }

      // KB grants. Safe to copy verbatim: stored grants are only ever an
      // ALLOW-LIST, intersected at runtime with the tree spaces returns for the
      // CALLING user (kb-handlers.ts fileAllowed/collectionAllowed), so a grant
      // can never widen what the clone's owner may read — only narrow it.
      if (source.collections.length > 0) {
        await tx.agentCollection.createMany({
          data: source.collections.map((c) => ({
            agentId: clone.id,
            collectionId: c.collectionId,
            fileId: c.fileId,
          })),
        });
      }

      // MCP instances — SELF-CLONES ONLY. The row carries the credential blob
      // (encryptedCreds/iv/authTag is NOT NULL, so there is no credential-less
      // copy to make), and the runtime decrypts it per-agent, meaning the
      // clone's tool calls authenticate as whoever pasted the secret. Copying
      // that to an agent owned by SOMEONE ELSE hands them a standing grant on
      // the source owner's third-party account which outlives both revoking
      // their share and deleting the connection on the source — nothing ever
      // rotates or back-references a copied blob. When the cloner is already
      // the owner no trust boundary is crossed, so their own credentials
      // travel and cloning your own agent still produces a working replica.
      const selfClone = source.ownerUserId !== null && source.ownerUserId === newOwnerId;
      if (selfClone && source.mcpConnections.length > 0) {
        await tx.agentMcpConnection.createMany({
          data: source.mcpConnections.map((c) => ({
            agentId: clone.id,
            mcpServerId: c.mcpServerId,
            slug: c.slug,
            displayName: c.displayName,
            encryptedCreds: c.encryptedCreds,
            iv: c.iv,
            authTag: c.authTag,
            createdByUserId: c.createdByUserId,
          })),
        });
      }

      // Seed prompt history so the clone's version list isn't empty and the
      // denormalized active-pointer fields are consistent with a real row. The
      // source's own history stays with the source — the clone's lineage starts
      // here, and the note records where it came from.
      const pv = await tx.agentPromptVersion.create({
        data: {
          agentId: clone.id,
          version: 1,
          systemPrompt,
          note: `Cloned from ${source.slug}`,
          createdByUserId: newOwnerId,
        },
      });

      return tx.agent.update({
        where: { id: clone.id },
        data: { activePromptVersionId: pv.id, activePromptVersion: pv.version },
        include: INCLUDE_TOOLS_SKILLS,
      });
    });
  },

  update: (slug: string, orgId: string, data: Prisma.AgentUpdateInput) =>
    prisma.agent.update({ where: { orgId_slug: { orgId, slug } }, data, include: INCLUDE_TOOLS_SKILLS }),

  updateById: (id: string, data: Prisma.AgentUpdateInput) =>
    prisma.agent.update({ where: { id }, data, include: INCLUDE_TOOLS_SKILLS }),

  delete: (slug: string, orgId: string) =>
    prisma.agent.delete({ where: { orgId_slug: { orgId, slug } } }),

  // ── Prompt versioning ──────────────────────────────────────────────
  listPromptVersions: (agentId: string) =>
    prisma.agentPromptVersion.findMany({
      where: { agentId },
      orderBy: { version: "desc" },
    }),

  /**
   * Create a new prompt version for an agent and make it active, atomically.
   * Computes the next monotonic version number under a transaction so two
   * concurrent edits can't collide on the (agentId, version) unique index.
   * Also denormalizes the new prompt + active pointers back onto the agent so
   * every runtime read path (which reads agent.systemPrompt) sees it instantly.
   */
  createAndActivatePromptVersion: (input: {
    agentId: string;
    systemPrompt: string;
    note?: string | null;
    createdByUserId?: string | null;
  }) =>
    prisma.$transaction(async (tx) => {
      const latest = await tx.agentPromptVersion.findFirst({
        where: { agentId: input.agentId },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      const nextVersion = (latest?.version ?? 0) + 1;
      const created = await tx.agentPromptVersion.create({
        data: {
          agentId: input.agentId,
          version: nextVersion,
          systemPrompt: input.systemPrompt,
          note: input.note ?? null,
          createdByUserId: input.createdByUserId ?? null,
        },
      });
      await tx.agent.update({
        where: { id: input.agentId },
        data: {
          systemPrompt: input.systemPrompt,
          activePromptVersionId: created.id,
          activePromptVersion: created.version,
        },
      });
      return created;
    }),

  /**
   * Roll back: make an existing version active again. Copies that version's
   * prompt into the denormalized agent.systemPrompt + repoints the active
   * pointers. The historical row is reused as-is (no new version created), so
   * the active pointer can move backwards — history stays append-only.
   */
  activatePromptVersion: (agentId: string, version: number) =>
    prisma.$transaction(async (tx) => {
      const target = await tx.agentPromptVersion.findUnique({
        where: { agentId_version: { agentId, version } },
      });
      if (!target) return null;
      await tx.agent.update({
        where: { id: agentId },
        data: {
          systemPrompt: target.systemPrompt,
          activePromptVersionId: target.id,
          activePromptVersion: target.version,
        },
      });
      return target;
    }),

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

  // ── Knowledge Base collections (junction) ──────────────────────────
  listCollections: (agentId: string) =>
    prisma.agentCollection.findMany({
      where: { agentId },
      orderBy: { createdAt: "asc" },
    }),

  /**
   * Replace ALL KB grants on an agent with the provided set, atomically.
   * Mirrors the "replace skills on PATCH" semantics at routes/agents.ts so
   * the UI's submit payload is the source of truth for the agent's KB scope.
   */
  replaceCollections: (
    agentId: string,
    items: Array<{ collectionId: string; fileId?: string | null }>,
  ) =>
    prisma.$transaction(async (tx) => {
      await tx.agentCollection.deleteMany({ where: { agentId } });
      if (items.length === 0) return [];
      // dedupe on (collectionId, fileId) so a sloppy client payload doesn't
      // hit the unique index. createMany is one round-trip — preferred over
      // a per-item upsert for what is fundamentally a bulk swap.
      const seen = new Set<string>();
      const data: Array<{ agentId: string; collectionId: string; fileId: string | null }> = [];
      for (const it of items) {
        const key = `${it.collectionId}::${it.fileId ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        data.push({ agentId, collectionId: it.collectionId, fileId: it.fileId ?? null });
      }
      await tx.agentCollection.createMany({ data });
      return tx.agentCollection.findMany({ where: { agentId } });
    }),

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
