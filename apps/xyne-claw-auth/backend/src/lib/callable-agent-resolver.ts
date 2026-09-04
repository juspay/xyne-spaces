/**
 * Agent-to-Agent (A2A) delegation — RBAC resolution for the /run path.
 *
 * Standard-tier callers declare which agents they WANT to be able to delegate
 * to in their tools config (`tools.callableAgents: string[]` of callee slugs).
 * That is intent, NOT authorization. This resolver is the security boundary:
 * it returns a callable-agent spec ONLY when an enabled, approved
 * `agent_delegation_grants` row exists for (caller → callee).
 *
 * Orchestrator-tier callers are admin-designated routers. They can resolve any
 * enabled GLOBAL-scope agent in their org that the running user could already
 * invoke directly; personal/shared callees still require the same approved
 * grant rows as standard delegation. The runtime receives only lightweight
 * specs for this set and hydrates a full spec through claw-auth at tool-call
 * time so authorization stays server-side.
 *
 * The resolved specs are forwarded to xyne-claw as `callableAgents` in the /run
 * body, where buildCallableAgentTools() turns each into a governed tool.
 */
import type { Prisma } from "@prisma/client";
import type { AppPrismaClient } from "../db.js";
import { isAgentInvocableBy, parseToolsConfig, stripPlatformConfigKeys } from "xyne-claw-shared";
import { resolveAgentProviderConfigs, type ProviderConfig } from "./agent-provider-config.js";
import { resolveCustomSubagentsForRun, type CustomSubagentSpec } from "./subagent-resolver.js";
import { createLogger } from "../logger.js";

const log = createLogger("callable-agent-resolver");

export type DelegationIdentityMode = "user" | "callee_app";
export type DelegationTier = "standard" | "orchestrator";

export function visibleAgentWhereForRunningUser(
  runningUserId?: string,
  isAdmin?: boolean,
): Prisma.AgentWhereInput {
  return isAdmin
    ? {}
    : runningUserId
      ? { OR: [{ scope: "global" }, { ownerUserId: runningUserId }, { shares: { some: { userId: runningUserId } } }] }
      : { scope: "global" };
}

/** Wire shape forwarded to xyne-claw (matches CallableAgentSpec there). */
export interface CallableAgentSpec {
  slug: string;
  name: string;
  description: string;
  systemPrompt: string;
  agentConfig: Record<string, unknown>;
  paramName: string;
  paramDescription: string;
  model?: string;
  provider?: string;
  providerOrder?: string[];
  providerConfigs?: Record<string, ProviderConfig>;
  subagentProviders?: Record<string, string>;
  customSubagents?: CustomSubagentSpec[];
  skills?: Array<{
    slug: string;
    name: string;
    description: string;
    content: string;
    files?: Array<{ relativePath: string; content: string; contentType?: string | null }>;
  }>;
  spacesAppId?: string | null;
  identityMode: DelegationIdentityMode;
  progressLabels: string[];
}

export interface CallableAgentLightSpec {
  slug: string;
  name: string;
  description: string;
  paramName: string;
  paramDescription: string;
  identityMode: DelegationIdentityMode;
  progressLabels: string[];
}

type AgentRowWithSkills = Prisma.AgentGetPayload<{
  include: { skills: { include: { skill: { include: { files: true } } } } };
}>;

export function toLightweightCallableAgentSpec(
  callee: { slug: string; name: string; description: string },
  identityMode: DelegationIdentityMode = "user",
): CallableAgentLightSpec {
  return {
    slug: callee.slug,
    name: callee.name,
    description: callee.description,
    paramName: "task",
    paramDescription: `The complete, self-contained task for ${callee.name}. Include all context it needs — it does not see this conversation.`,
    identityMode,
    progressLabels: [`Delegating to ${callee.name}…`],
  };
}

export async function hydrateCallableAgentSpec(
  prisma: AppPrismaClient,
  callee: AgentRowWithSkills,
  identityMode: DelegationIdentityMode,
): Promise<CallableAgentSpec> {
  const agentConfig = stripPlatformConfigKeys(callee.config as Record<string, unknown>);
  const providerResolution = await resolveAgentProviderConfigs({ id: callee.id, config: callee.config });
  const requestedSubagents = parseToolsConfig(agentConfig)?.subagents ?? [];
  const customSubagents = requestedSubagents.length > 0
    ? await resolveCustomSubagentsForRun(prisma, requestedSubagents, callee.orgId)
    : [];
  const skills = callee.skills.map((as) => ({
    slug: as.skill.slug,
    name: as.skill.name,
    description: as.skill.description ?? "",
    content: as.skill.content,
    ...(as.skill.files.length > 0
      ? {
          files: as.skill.files.map((f) => ({
            relativePath: f.relativePath,
            content: f.content,
            contentType: f.contentType,
          })),
        }
      : {}),
  }));
  const rawSubagentProviders = (callee.config as Record<string, unknown> | null | undefined)?.["subagentProviders"];
  const subagentProviders = rawSubagentProviders && typeof rawSubagentProviders === "object" && !Array.isArray(rawSubagentProviders)
    ? Object.fromEntries(Object.entries(rawSubagentProviders).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : undefined;

  return {
    slug: callee.slug,
    name: callee.name,
    description: callee.description,
    systemPrompt: callee.systemPrompt,
    agentConfig,
    paramName: "task",
    paramDescription: `The complete, self-contained task for ${callee.name}. Include all context it needs — it does not see this conversation.`,
    ...(callee.modelId ? { model: callee.modelId } : {}),
    ...(providerResolution.parent ? { provider: providerResolution.parent } : {}),
    ...(providerResolution.providerOrder.length > 0 ? { providerOrder: providerResolution.providerOrder } : {}),
    ...(Object.keys(providerResolution.providerConfigs).length > 0 ? { providerConfigs: providerResolution.providerConfigs } : {}),
    ...(subagentProviders ? { subagentProviders } : {}),
    ...(customSubagents.length > 0 ? { customSubagents } : {}),
    ...(skills.length > 0 ? { skills } : {}),
    ...(callee.spacesAppId ? { spacesAppId: callee.spacesAppId } : {}),
    identityMode,
    progressLabels: [`Delegating to ${callee.name}…`],
  };
}

/**
 * Resolve the agents `callerAgentId` is allowed to delegate to, intersected
 * with the callee slugs the caller's config requested. Only enabled grants for
 * enabled callee agents are returned.
 */
export async function resolveCallableAgentsForRun(
  prisma: AppPrismaClient,
  callerAgentId: string,
  requestedCalleeSlugs: string[],
  callerOrgId?: string,
  opts: { runningUserId?: string; isAdmin?: boolean } = {},
): Promise<CallableAgentSpec[]> {
  const wanted = [...new Set(requestedCalleeSlugs.map((s) => s.trim()).filter(Boolean))];
  if (wanted.length === 0) return [];
  const orgId = callerOrgId ?? (await prisma.agent.findUnique({
    where: { id: callerAgentId },
    select: { orgId: true },
  }))?.orgId;
  if (!orgId) return [];

  // 1) Which of the wanted slugs map to real, enabled agents?
  const callees = await prisma.agent.findMany({
    where: { orgId, slug: { in: wanted }, enabled: true },
    include: {
      skills: { include: { skill: { include: { files: true } } } },
    },
  });
  if (callees.length === 0) return [];
  const byId = new Map(callees.map((c) => [c.id, c]));

  // 2) Which of those are actually GRANTED to this caller? (fail-closed)
  const grants = await prisma.agentDelegationGrant.findMany({
    where: { callerAgentId, enabled: true, status: "approved", calleeAgentId: { in: callees.map((c) => c.id) } },
    select: { calleeAgentId: true, identityMode: true },
  });

  // 3) Runtime user visibility: a delegated callee cannot be invoked unless
  // the top-level running user could invoke it directly (global | owned |
  // shared-with-me, with the same admin bypass as agentRepository.listVisible).
  const visibilityBase = visibleAgentWhereForRunningUser(opts.runningUserId, opts.isAdmin);
  const visibleRows = grants.length > 0
    ? await prisma.agent.findMany({
        where: {
          id: { in: grants.map((g) => g.calleeAgentId) },
          ...(orgId ? { orgId } : {}),
          ...visibilityBase,
        },
        select: { id: true },
      })
    : [];
  const visibleIds = new Set(visibleRows.map((row) => row.id));

  const specs: CallableAgentSpec[] = [];
  for (const g of grants) {
    const callee = byId.get(g.calleeAgentId);
    if (!callee) continue;
    if (callee.id === callerAgentId) continue; // no self-delegation grant
    if (!visibleIds.has(callee.id)) {
      log.info(`[a2a] callee ${callee.slug} not visible to user ${opts.runningUserId ?? "anonymous"} — dropped`);
      continue;
    }
    if (!isAgentInvocableBy(callee.config as Record<string, unknown> | null, opts.runningUserId)) {
      log.info(`[a2a] callee ${callee.slug} restricted for user ${opts.runningUserId ?? "anonymous"} — dropped`);
      continue;
    }
    specs.push(await hydrateCallableAgentSpec(prisma, callee, g.identityMode === "callee_app" ? "callee_app" : "user"));
  }

  const dropped = wanted.length - specs.length;
  if (dropped > 0) {
    log.info(
      `A2A: caller=${callerAgentId} requested ${wanted.length} callee(s), ${specs.length} granted, ${dropped} dropped (fail-closed).`,
    );
  }
  return specs;
}

/**
 * Resolve the lightweight callee list for an orchestrator-tier caller:
 * all enabled global agents in-org visible to the running user, plus approved
 * grant targets for personal/shared agents. No full prompts/config/secrets are
 * forwarded; xyne-claw hydrates a selected callee at execute time.
 */
export async function resolveOrchestratorCallableAgentsForRun(
  prisma: AppPrismaClient,
  callerAgentId: string,
  callerOrgId: string,
  opts: { runningUserId?: string; isAdmin?: boolean } = {},
): Promise<CallableAgentLightSpec[]> {
  if (!callerOrgId) return [];
  const visibilityBase = visibleAgentWhereForRunningUser(opts.runningUserId, opts.isAdmin);

  const globalCallees = await prisma.agent.findMany({
    where: {
      orgId: callerOrgId,
      enabled: true,
      scope: "global",
      NOT: { id: callerAgentId },
      ...visibilityBase,
    },
    select: { id: true, slug: true, name: true, description: true, config: true },
    orderBy: { name: "asc" },
  });

  const grants = await prisma.agentDelegationGrant.findMany({
    where: { callerAgentId, enabled: true, status: "approved" },
    select: { calleeAgentId: true, identityMode: true },
  });
  const grantByCalleeId = new Map(grants.map((g) => [g.calleeAgentId, g.identityMode]));

  const grantedCallees = grants.length > 0
    ? await prisma.agent.findMany({
        where: {
          id: { in: grants.map((g) => g.calleeAgentId) },
          orgId: callerOrgId,
          enabled: true,
          scope: { not: "global" },
          NOT: { id: callerAgentId },
          ...visibilityBase,
        },
        select: { id: true, slug: true, name: true, description: true, config: true },
        orderBy: { name: "asc" },
      })
    : [];

  const bySlug = new Map<string, CallableAgentLightSpec>();
  for (const callee of globalCallees) {
    if (!isAgentInvocableBy(callee.config as Record<string, unknown> | null, opts.runningUserId)) {
      log.info(`[a2a] orchestrator callee ${callee.slug} restricted for user ${opts.runningUserId ?? "anonymous"} — dropped`);
      continue;
    }
    bySlug.set(callee.slug, toLightweightCallableAgentSpec(callee, "user"));
  }
  for (const callee of grantedCallees) {
    if (!isAgentInvocableBy(callee.config as Record<string, unknown> | null, opts.runningUserId)) {
      log.info(`[a2a] orchestrator callee ${callee.slug} restricted for user ${opts.runningUserId ?? "anonymous"} — dropped`);
      continue;
    }
    const mode = grantByCalleeId.get(callee.id) === "callee_app" ? "callee_app" : "user";
    bySlug.set(callee.slug, toLightweightCallableAgentSpec(callee, mode));
  }

  return [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function resolveCallableAgentSpecForOrchestratorCall(
  prisma: AppPrismaClient,
  args: {
    callerSlug: string;
    calleeSlug: string;
    userId: string;
  },
): Promise<{ spec: CallableAgentSpec; callerOrgId: string } | { error: string; status: number }> {
  const user = await prisma.user.findUnique({ where: { id: args.userId }, select: { orgId: true } });
  if (!user?.orgId) return { error: "Running user is not associated with an organization", status: 403 };
  const admin = await prisma.userRole.findUnique({ where: { userId_role: { userId: args.userId, role: "CLAW_ADMIN" } } }).then(Boolean);
  const caller = await prisma.agent.findUnique({
    where: { orgId_slug: { orgId: user.orgId, slug: args.callerSlug } },
    select: { id: true, orgId: true, delegationTier: true, enabled: true },
  });
  if (!caller || !caller.enabled) return { error: "Caller agent not found or disabled", status: 404 };
  if (caller.delegationTier !== "orchestrator") return { error: "Caller is not orchestrator-tier", status: 403 };

  const callee = await prisma.agent.findUnique({
    where: { orgId_slug: { orgId: caller.orgId, slug: args.calleeSlug } },
    include: { skills: { include: { skill: { include: { files: true } } } } },
  });
  if (!callee || !callee.enabled) return { error: "Callee agent not found or disabled", status: 404 };
  if (callee.id === caller.id) return { error: "An agent cannot delegate to itself", status: 403 };

  const visible = await prisma.agent.findFirst({
    where: {
      id: callee.id,
      orgId: caller.orgId,
      ...visibleAgentWhereForRunningUser(args.userId, admin),
    },
    select: { id: true },
  });
  if (!visible) return { error: "Callee is not visible to the running user", status: 403 };
  if (!isAgentInvocableBy(callee.config as Record<string, unknown> | null, args.userId)) {
    return { error: "Callee is restricted for the running user", status: 403 };
  }

  if (callee.scope === "global") {
    return { spec: await hydrateCallableAgentSpec(prisma, callee, "user"), callerOrgId: caller.orgId };
  }

  const grant = await prisma.agentDelegationGrant.findUnique({
    where: { callerAgentId_calleeAgentId: { callerAgentId: caller.id, calleeAgentId: callee.id } },
    select: { enabled: true, status: true, identityMode: true },
  });
  if (!grant?.enabled || grant.status !== "approved") {
    return { error: "Personal/shared callee requires an approved delegation grant", status: 403 };
  }

  return {
    spec: await hydrateCallableAgentSpec(prisma, callee, grant.identityMode === "callee_app" ? "callee_app" : "user"),
    callerOrgId: caller.orgId,
  };
}
