/**
 * Named data access for the Slack surface. Prisma calls whose WHERE clauses
 * encode domain knowledge live here under names that state it; simple
 * self-explanatory queries may stay inline at their call sites.
 *
 * The load-bearing convention this file exists to explain ONCE:
 * `surfaceTenantId: ""` marks an ORG-LEVEL row — the ConnectedSurface row
 * holding the org's app-config token (no workspace), and the SurfaceAgent row
 * holding an agent's app registration (org-scoped, installs nested per team).
 * Non-empty surfaceTenantId = a concrete Slack workspace (team id).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";

/** Sentinel for org-level rows; see module doc. */
export const ORG_LEVEL_TENANT_ID = "";

/** The Slack row of the surface catalog (seeded by migration; null = seed missing). */
export function getSlackSurface() {
  return prisma.surface.findUnique({ where: { key: "slack" } });
}

/** Composite-unique WHERE for an org's org-level Slack connection row. */
export function orgConnectionWhere(orgId: string, surfaceId: string) {
  return {
    orgId_surfaceId_surfaceTenantId: { orgId, surfaceId, surfaceTenantId: ORG_LEVEL_TENANT_ID },
  } as const;
}

/** The org-level connection row — holder of the app-config token pair. */
export function getOrgSlackConnection(orgId: string, surfaceId: string) {
  return prisma.connectedSurface.findUnique({ where: orgConnectionWhere(orgId, surfaceId) });
}

/** Composite-unique WHERE for an agent's (org-level) Slack app registration. */
export function agentRegistrationWhere(agentId: string, surfaceId: string) {
  return {
    agentId_surfaceId_surfaceTenantId: { agentId, surfaceId, surfaceTenantId: ORG_LEVEL_TENANT_ID },
  } as const;
}

/** All ACTIVE workspace-team rows for an org (excludes the org-level row). */
export function listOrgTeamConnections(orgId: string, surfaceId: string) {
  return prisma.connectedSurface.findMany({
    where: { orgId, surfaceId, status: "ACTIVE", NOT: { surfaceTenantId: ORG_LEVEL_TENANT_ID } },
    orderBy: { createdAt: "asc" },
  });
}

const AGENT_FOR_DISPATCH = {
  agent: { select: { id: true, slug: true, name: true, orgId: true, config: true } },
} as const;

/**
 * Every ACTIVE connection claiming a given workspace, ACROSS orgs. Feeds the
 * one-workspace-one-org guard: if any returned row belongs to a different
 * org than the installer's, the install is rejected (a workspace with two
 * owning orgs would make inbound team_id -> org resolution ambiguous).
 */
export function listConnectionsForTeam(surfaceId: string, surfaceTenantId: string) {
  return prisma.connectedSurface.findMany({
    where: { surfaceId, surfaceTenantId, status: "ACTIVE" },
    select: { orgId: true, config: true },
  });
}

/** An agent by slug within one org. Slugs are unique per org, not globally, so
 *  the orgId is part of the identity — never look up by slug alone. */
export function findOrgAgentBySlug(slug: string, orgId: string) {
  return prisma.agent.findFirst({
    where: { slug, orgId },
    select: { id: true, slug: true, name: true, orgId: true },
  });
}

/** Columns the org status view reads: registration state, its installs, and
 *  the owning agent (name/slug feed the manifest-staleness comparison). */
const AGENT_FOR_STATUS = {
  id: true,
  externalAppId: true,
  clientId: true,
  commandName: true,
  status: true,
  manifestHash: true,
  installs: { select: { surfaceTenantId: true, tenantName: true, installedAt: true } },
  agent: { select: { id: true, slug: true, name: true } },
} as const;

/** Every per-agent Slack registration an org owns. Scoped to the org-level
 *  tenant row: per-workspace installs hang off `installs`, not sibling rows. */
export function listOrgAgentRegistrations(surfaceId: string, orgId: string) {
  return prisma.surfaceAgent.findMany({
    where: { surfaceId, surfaceTenantId: ORG_LEVEL_TENANT_ID, agent: { orgId } },
    select: AGENT_FOR_STATUS,
  });
}

/** The per-agent app registration owning a given Slack app id, with its agent.
 *  externalAppId is unique per surface, so this is a guaranteed single owner. */
export function findSurfaceAgentByAppId(surfaceId: string, appId: string) {
  return prisma.surfaceAgent.findUnique({
    where: { surfaceId_externalAppId: { surfaceId, externalAppId: appId } },
    include: AGENT_FOR_DISPATCH,
  });
}

/** The agent registration bound to a slash command within an org. */
export function findSurfaceAgentByCommand(surfaceId: string, orgId: string, commandName: string) {
  return prisma.surfaceAgent.findFirst({
    where: { surfaceId, commandName, agent: { orgId } },
    include: AGENT_FOR_DISPATCH,
  });
}

/** The org's registration (other than this agent's) already bound to a
 *  command name — one command maps to exactly one agent per org. */
export function findCommandConflict(input: {
  surfaceId: string;
  orgId: string;
  commandName: string;
  excludeAgentId: string;
}) {
  return prisma.surfaceAgent.findFirst({
    where: {
      surfaceId: input.surfaceId,
      agentId: { not: input.excludeAgentId },
      agent: { orgId: input.orgId },
      commandName: input.commandName,
    },
    select: { agent: { select: { slug: true } } },
  });
}

/**
 * Registration config holds provenance owned by different flows
 * (createdByUserId by create-app, command* by register-command). A writer
 * must never clobber keys it does not own, so residue is ALWAYS merged
 * into the existing blob — this helper is the only way registration
 * config gets written.
 */
async function mergedRegistrationResidue(
  agentId: string,
  surfaceId: string,
  residue: Record<string, unknown>,
): Promise<Prisma.InputJsonObject> {
  const existing = await prisma.surfaceAgent.findUnique({
    where: agentRegistrationWhere(agentId, surfaceId),
    select: { config: true },
  });
  const current = existing?.config;
  const base =
    typeof current === "object" && current !== null && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {};
  return { ...base, ...residue } as Prisma.InputJsonObject;
}

/** Create/refresh an agent's app registration (fresh credentials replace
 *  columns; config residue merges — see mergedRegistrationResidue). */
export async function saveAppRegistration(input: {
  agentId: string;
  surfaceId: string;
  registration: {
    externalAppId: string;
    clientId: string;
    encryptedClientSecret: string;
    signingSecret: string;
    status: string;
    manifestSyncedAt: Date;
    manifestHash: string;
  };
  createdByUserId: string;
}) {
  const config = await mergedRegistrationResidue(input.agentId, input.surfaceId, {
    createdByUserId: input.createdByUserId,
  });
  return prisma.surfaceAgent.upsert({
    where: agentRegistrationWhere(input.agentId, input.surfaceId),
    create: {
      agentId: input.agentId,
      surfaceId: input.surfaceId,
      surfaceTenantId: ORG_LEVEL_TENANT_ID,
      ...input.registration,
      config,
    },
    update: { ...input.registration, config },
  });
}

/** Bind a slash command to an agent's registration. The connection whose bot
 *  token answers the command is a column (read at dispatch); app id and
 *  registrar are provenance residue. */
export async function bindAgentCommand(input: {
  agentId: string;
  surfaceId: string;
  commandName: string;
  commandConnectedSurfaceId: string;
  commandAppId: string;
  registeredByUserId: string;
}) {
  const config = await mergedRegistrationResidue(input.agentId, input.surfaceId, {
    commandAppId: input.commandAppId,
    commandRegisteredByUserId: input.registeredByUserId,
  });
  const command = {
    commandName: input.commandName,
    commandConnectedSurfaceId: input.commandConnectedSurfaceId,
  };
  return prisma.surfaceAgent.upsert({
    where: agentRegistrationWhere(input.agentId, input.surfaceId),
    create: {
      agentId: input.agentId,
      surfaceId: input.surfaceId,
      surfaceTenantId: ORG_LEVEL_TENANT_ID,
      ...command,
      config,
    },
    update: { ...command, config },
  });
}

/** Record (or refresh) a tenant install — the credential minted by consent. */
export function upsertInstall(input: {
  surfaceAgentId: string;
  surfaceTenantId: string;
  encryptedBotToken: string;
  tenantName?: string;
  botUserId?: string;
  installedByUserId?: string;
}) {
  const { surfaceAgentId, surfaceTenantId, ...fields } = input;
  return prisma.surfaceAgentInstall.upsert({
    where: { surfaceAgentId_surfaceTenantId: { surfaceAgentId, surfaceTenantId } },
    create: { surfaceAgentId, surfaceTenantId, ...fields },
    update: { ...fields, installedAt: new Date() },
  });
}

/**
 * Record a completed install — the single domain write of the OAuth callback,
 * atomic across its three effects:
 *   1. the org's team connection row exists and is ACTIVE (inbound
 *      team_id -> org resolution),
 *   2. the install row holds the (encrypted) bot token for this workspace,
 *   3. the registration is marked installed and pinned to its app id.
 */
export function recordInstall(input: {
  orgId: string;
  surfaceId: string;
  surfaceTenantId: string;
  tenantName: string;
  /** Existing team-row config to preserve (merged, not replaced). */
  workspaceConfig: Record<string, unknown>;
  surfaceAgentId: string;
  externalAppId: string;
  encryptedBotToken: string;
  botUserId: string;
  installedByUserId: string;
}) {
  const { orgId, surfaceId, surfaceTenantId, tenantName } = input;
  const installFields = {
    encryptedBotToken: input.encryptedBotToken,
    tenantName,
    botUserId: input.botUserId,
    installedByUserId: input.installedByUserId,
  };
  return prisma.$transaction([
    prisma.connectedSurface.upsert({
      where: { orgId_surfaceId_surfaceTenantId: { orgId, surfaceId, surfaceTenantId } },
      create: {
        orgId,
        surfaceId,
        surfaceTenantId,
        config: { ...input.workspaceConfig, teamName: tenantName },
        status: "ACTIVE",
      },
      update: { config: { ...input.workspaceConfig, teamName: tenantName }, status: "ACTIVE" },
    }),
    prisma.surfaceAgentInstall.upsert({
      where: {
        surfaceAgentId_surfaceTenantId: { surfaceAgentId: input.surfaceAgentId, surfaceTenantId },
      },
      create: { surfaceAgentId: input.surfaceAgentId, surfaceTenantId, ...installFields },
      update: { ...installFields, installedAt: new Date() },
    }),
    prisma.surfaceAgent.update({
      where: { id: input.surfaceAgentId },
      data: { externalAppId: input.externalAppId, status: "installed" },
    }),
  ]);
}

/** The install row for a registration in a specific workspace/tenant. */
export function getInstall(surfaceAgentId: string, surfaceTenantId: string) {
  return prisma.surfaceAgentInstall.findUnique({
    where: { surfaceAgentId_surfaceTenantId: { surfaceAgentId, surfaceTenantId } },
  });
}
