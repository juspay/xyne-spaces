/**
 * Named data access for the messaging-channel core. One account = one
 * `ConnectedSurface` row (surfaceTenantId = "acct_…", the ACCOUNT KEY) plus
 * one `SurfaceAgent` row bound to the same tenant id (the DEFAULT agent).
 * Whatever a plugin needs to authenticate goes to `ChannelAuthState`, and a
 * sender's link to a Claw user is a `UserSurfaceIdentity` row shared with the
 * other surfaces. Every WHERE that encodes those conventions lives here.
 */
import { randomBytes } from "node:crypto";
import type { ConnectedSurface, Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { decryptSurfaceSecret, encryptSurfaceSecret } from "../../lib/surface-resolver.js";
import { ACCOUNT_KEY_PREFIX } from "./const.js";
import type { ChannelAccount, MessagingChannelKey, AuthStateStore } from "./plugin.js";
import { isMessagingChannelKey } from "./plugin.js";
import { parseAccountConfig, type AccountConfig } from "./schema.js";

function isAccountKey(tenantId: string): boolean {
  return tenantId.startsWith(ACCOUNT_KEY_PREFIX);
}

function newAccountKey(): string {
  return `${ACCOUNT_KEY_PREFIX}${randomBytes(12).toString("hex")}`;
}

/** The channel's row in the surface catalog (seeded by migration). */
export function getSurface(channel: string) {
  return prisma.surface.findUnique({ where: { key: channel } });
}

export type AccountRow = ConnectedSurface & { surface: { key: string } };

const WITH_SURFACE_KEY = { surface: { select: { key: true } } } as const;

export function toChannelAccount(row: AccountRow): ChannelAccount {
  if (!isMessagingChannelKey(row.surface.key)) {
    throw new Error(`connected surface ${row.id} is not a messaging channel (${row.surface.key})`);
  }
  const config = parseAccountConfig(row.config);
  return {
    id: row.id,
    orgId: row.orgId,
    channel: row.surface.key,
    surfaceId: row.surfaceId,
    accountKey: row.surfaceTenantId,
    config,
    channelConfig: config.channel ?? null,
  };
}

export async function getAccount(accountId: string): Promise<AccountRow | null> {
  const row = await prisma.connectedSurface.findUnique({
    where: { id: accountId },
    include: WITH_SURFACE_KEY,
  });
  return row && isAccountKey(row.surfaceTenantId) ? row : null;
}

export function listOrgAccounts(channel: MessagingChannelKey, orgId: string): Promise<AccountRow[]> {
  return prisma.connectedSurface.findMany({
    where: {
      orgId,
      surface: { key: channel },
      surfaceTenantId: { startsWith: ACCOUNT_KEY_PREFIX },
      status: "ACTIVE",
    },
    include: WITH_SURFACE_KEY,
    orderBy: { createdAt: "asc" },
  });
}

/** The caller's own accounts on a user-scoped channel. Filtered in memory
 *  because ownership lives in the config JSON, and an org's list of personal
 *  numbers is small. */
export async function listOwnedAccounts(
  channel: MessagingChannelKey,
  orgId: string,
  userId: string,
): Promise<AccountRow[]> {
  const rows = await listOrgAccounts(channel, orgId);
  return rows.filter((row) => parseAccountConfig(row.config).ownerUserId === userId);
}

/** Every ACTIVE account of the given channels whose admin wants it running
 *  and that is not logged out. What the account manager sweeps. */
export async function listRunnableAccounts(channels: MessagingChannelKey[]): Promise<ChannelAccount[]> {
  if (channels.length === 0) return [];
  const rows = await prisma.connectedSurface.findMany({
    where: {
      status: "ACTIVE",
      surface: { key: { in: channels } },
      surfaceTenantId: { startsWith: ACCOUNT_KEY_PREFIX },
    },
    include: WITH_SURFACE_KEY,
  });
  return rows
    .map(toChannelAccount)
    .filter((account) => account.config.desiredState === "running" && account.config.connState !== "logged_out");
}

const AGENT_FOR_DISPATCH = {
  select: { id: true, slug: true, name: true, orgId: true, config: true, enabled: true },
} as const;

export interface BoundAgent {
  id: string;
  slug: string;
  name: string;
  orgId: string;
  config: unknown;
  enabled: boolean;
}

/** An agent by slug within one org (slugs are unique per org, not globally). */
export function findOrgAgentBySlug(slug: string, orgId: string): Promise<BoundAgent | null> {
  return prisma.agent.findFirst({ where: { slug, orgId }, ...AGENT_FOR_DISPATCH });
}

/** Enabled agents of an org, for the `/agents` listing (ACL applied by caller). */
export function listOrgAgents(orgId: string): Promise<BoundAgent[]> {
  return prisma.agent.findMany({ where: { orgId, enabled: true }, ...AGENT_FOR_DISPATCH, orderBy: { slug: "asc" } });
}

/** The account's default agent, or null if the binding was removed. */
export async function findDefaultAgent(
  account: Pick<ChannelAccount, "accountKey">,
  surfaceId: string,
): Promise<{ surfaceAgentId: string; agent: BoundAgent } | null> {
  const row = await prisma.surfaceAgent.findFirst({
    where: { surfaceId, surfaceTenantId: account.accountKey },
    select: { id: true, agent: AGENT_FOR_DISPATCH },
  });
  return row ? { surfaceAgentId: row.id, agent: row.agent } : null;
}

export async function createAccount(input: {
  orgId: string;
  surfaceId: string;
  agentId: string;
  config: AccountConfig;
}): Promise<AccountRow> {
  const accountKey = newAccountKey();
  const [row] = await prisma.$transaction([
    prisma.connectedSurface.create({
      data: {
        orgId: input.orgId,
        surfaceId: input.surfaceId,
        surfaceTenantId: accountKey,
        config: input.config as Prisma.InputJsonObject,
        status: "ACTIVE",
      },
      include: WITH_SURFACE_KEY,
    }),
    prisma.surfaceAgent.create({
      data: {
        agentId: input.agentId,
        surfaceId: input.surfaceId,
        surfaceTenantId: accountKey,
        status: "bound",
      },
    }),
  ]);
  return row;
}

/** Replace the account's default agent. The partial unique index guarantees a
 *  single binding, so this is delete-then-create inside one transaction. */
export function bindDefaultAgent(input: { surfaceId: string; accountKey: string; agentId: string }) {
  return prisma.$transaction([
    prisma.surfaceAgent.deleteMany({ where: { surfaceId: input.surfaceId, surfaceTenantId: input.accountKey } }),
    prisma.surfaceAgent.create({
      data: {
        agentId: input.agentId,
        surfaceId: input.surfaceId,
        surfaceTenantId: input.accountKey,
        status: "bound",
      },
    }),
  ]);
}

/**
 * Merge a patch into the stored config. Read-merge-write: the admin PATCH and
 * the owning pod's setState both go through here, and neither may clobber
 * the other's keys, so residue is always merged, never replaced.
 */
export async function updateAccountConfig(
  accountId: string,
  patch: Partial<AccountConfig> & Record<string, unknown>,
): Promise<AccountConfig> {
  const existing = await prisma.connectedSurface.findUnique({ where: { id: accountId }, select: { config: true } });
  const base =
    existing?.config && typeof existing.config === "object" && !Array.isArray(existing.config)
      ? (existing.config as Record<string, unknown>)
      : {};
  const merged = { ...base, ...stripUndefined(patch) };
  await prisma.connectedSurface.update({
    where: { id: accountId },
    data: { config: merged as Prisma.InputJsonObject },
  });
  return parseAccountConfig(merged);
}

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));
}

export function setAccountStatus(accountId: string, status: "ACTIVE" | "INACTIVE") {
  return prisma.connectedSurface.update({ where: { id: accountId }, data: { status } });
}

// ── auth state ──

/**
 * Everything a plugin needs to authenticate as one account, one encrypted row
 * per key in `channel_auth_state`.
 *
 * Rows rather than a JSON column because Baileys keeps a Signal key store here
 * — a creds document plus its pre-key/session/sender-key entries, which churn
 * continuously while the socket is open. In a JSON column every one of those
 * writes rewrites the whole account config, and `updateAccountConfig` merges
 * that same column without a lock, so a connection-state patch would drop keys
 * written while it was in flight. None of this travels through
 * `AccountConfig`, so the admin API cannot serialise ciphertext by accident.
 */
export function authStateFor(connectedSurfaceId: string): AuthStateStore {
  const label = "channel account secret";

  return {
    async get(category, keyId = "") {
      const row = await prisma.channelAuthState.findUnique({
        where: { connectedSurfaceId_category_keyId: { connectedSurfaceId, category, keyId } },
        select: { encryptedValue: true },
      });
      return row ? decryptSurfaceSecret(row.encryptedValue, label) : null;
    },
    async getMany(category, keyIds) {
      const out = new Map<string, string>();
      if (keyIds.length === 0) return out;
      const rows = await prisma.channelAuthState.findMany({
        where: { connectedSurfaceId, category, keyId: { in: keyIds } },
        select: { keyId: true, encryptedValue: true },
      });
      for (const row of rows) out.set(row.keyId, decryptSurfaceSecret(row.encryptedValue, label));
      return out;
    },
    async set(category, keyId, value) {
      const encryptedValue = encryptSurfaceSecret(value);
      await prisma.channelAuthState.upsert({
        where: { connectedSurfaceId_category_keyId: { connectedSurfaceId, category, keyId } },
        create: { connectedSurfaceId, category, keyId, encryptedValue },
        update: { encryptedValue },
      });
    },
    async setMany(entries) {
      if (entries.length === 0) return;
      // One transaction so a Signal key batch either lands whole or not at all;
      // per-row upserts mean concurrent categories never overwrite each other.
      await prisma.$transaction(
        entries.map((entry) =>
          entry.value === null
            ? prisma.channelAuthState.deleteMany({
                where: { connectedSurfaceId, category: entry.category, keyId: entry.keyId },
              })
            : prisma.channelAuthState.upsert({
                where: {
                  connectedSurfaceId_category_keyId: {
                    connectedSurfaceId,
                    category: entry.category,
                    keyId: entry.keyId,
                  },
                },
                create: {
                  connectedSurfaceId,
                  category: entry.category,
                  keyId: entry.keyId,
                  encryptedValue: encryptSurfaceSecret(entry.value),
                },
                update: { encryptedValue: encryptSurfaceSecret(entry.value) },
              }),
        ),
      );
    },
    async delete(category, keyId) {
      await prisma.channelAuthState.deleteMany({
        where: { connectedSurfaceId, category, ...(keyId === undefined ? {} : { keyId }) },
      });
    },
    async clear() {
      await prisma.channelAuthState.deleteMany({ where: { connectedSurfaceId } });
    },
  };
}

// ── identities ──

/**
 * Link a sender id to a user for the whole org. The self-service path: the
 * signed-in session is the only proof, and there is nothing to approve.
 * Keyed by org rather than by account, so one link is recognised by every
 * account on the channel. Upsert so re-adding your own number is idempotent.
 */
export async function linkSenderToUser(input: {
  surfaceId: string;
  senderId: string;
  orgId: string;
  userId: string;
}): Promise<Date> {
  const now = new Date();
  const row = await prisma.userSurfaceIdentity.upsert({
    where: {
      surfaceId_surfaceWorkspaceId_surfaceUserId: {
        surfaceId: input.surfaceId,
        surfaceWorkspaceId: input.orgId,
        surfaceUserId: input.senderId,
      },
    },
    create: {
      surfaceId: input.surfaceId,
      surfaceWorkspaceId: input.orgId,
      surfaceUserId: input.senderId,
      orgId: input.orgId,
      userId: input.userId,
      status: "ACTIVE",
      linkedAt: now,
      lastSeenAt: now,
    },
    update: { orgId: input.orgId, userId: input.userId, status: "ACTIVE", linkedAt: now },
    select: { linkedAt: true },
  });
  return row.linkedAt ?? now;
}

/** Every number this user has linked on one channel, newest first. */
export function listIdentitiesForUser(input: { surfaceId: string; userId: string; orgId: string }) {
  return prisma.userSurfaceIdentity.findMany({
    where: { surfaceId: input.surfaceId, userId: input.userId, orgId: input.orgId, status: "ACTIVE" },
    select: { surfaceWorkspaceId: true, surfaceUserId: true, linkedAt: true, lastSeenAt: true },
    orderBy: { linkedAt: "desc" },
  });
}

/** Self-service removal. Scoped by userId as well as sender id, so a caller
 *  can only ever delete their own link — the admin path (unlinkIdentity) is
 *  the one that may remove anyone's. */
export function unlinkOwnIdentity(input: { surfaceId: string; senderId: string; userId: string; orgId: string }) {
  return prisma.userSurfaceIdentity.deleteMany({
    where: {
      surfaceId: input.surfaceId,
      surfaceUserId: input.senderId,
      userId: input.userId,
      orgId: input.orgId,
    },
  });
}

export function unlinkIdentity(input: { surfaceId: string; accountKey: string; senderId: string }) {
  return prisma.userSurfaceIdentity.deleteMany({
    where: { surfaceId: input.surfaceId, surfaceWorkspaceId: input.accountKey, surfaceUserId: input.senderId },
  });
}
