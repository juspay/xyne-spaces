import { Prisma } from "@prisma/client";
import { CONFIG } from "../config.js";
import { encrypt } from "../crypto.js";
import { prisma } from "../db.js";

const LITELLM_PROVIDER = "litellm";

type DbClient = typeof prisma | Prisma.TransactionClient;

export class LiteLLMProvisioningError extends Error {
  constructor(
    public readonly endpoint: string,
    message: string,
    public readonly status?: number,
    public readonly code?: "CONFLICT" | "NOT_FOUND" | "BAD_REQUEST",
  ) {
    super(message);
    this.name = "LiteLLMProvisioningError";
  }
}

function alias(value: string, fallback: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return (normalized || fallback).slice(0, 180);
}

/**
 * Stores a LiteLLM team mapping for a Claw org without making any LiteLLM API
 * calls. Used by the litellm-sync receive-and-store endpoints when an external
 * orchestrator has already created the team in LiteLLM and posts the response
 * back.
 *
 * Conflict semantics: if the org already has a LiteLLM team mapping with a
 * *different* teamId, throws LiteLLMProvisioningError(code="CONFLICT") so the
 * route can return 409. Same teamId is idempotent (alias/status update).
 */
export async function storeTeamMappingForOrg(
  orgId: string,
  teamId: string,
  teamAlias?: string,
  status?: string,
  client: DbClient = prisma,
): Promise<{ teamId: string; created: boolean }> {
  const existing = await client.orgProviderIntegration.findUnique({
    where: { orgId_provider: { orgId, provider: LITELLM_PROVIDER } },
    select: { externalId: true },
  });

  if (existing?.externalId && existing.externalId !== teamId) {
    throw new LiteLLMProvisioningError(
      "/team/store",
      `Org ${orgId} already mapped to LiteLLM team ${existing.externalId}; refusing to remap to ${teamId}`,
      undefined,
      "CONFLICT",
    );
  }

  const aliasValue = teamAlias ? alias(teamAlias, `Claw org ${orgId}`) : undefined;

  if (existing?.externalId === teamId) {
    await client.orgProviderIntegration.update({
      where: { orgId_provider: { orgId, provider: LITELLM_PROVIDER } },
      data: {
        ...(aliasValue ? { externalAlias: aliasValue } : {}),
        ...(status ? { status } : {}),
      },
    });
    return { teamId, created: false };
  }

  await client.orgProviderIntegration.create({
    data: {
      orgId,
      provider: LITELLM_PROVIDER,
      externalId: teamId,
      externalAlias: aliasValue ?? null,
      status: status ?? "ACTIVE",
    },
  });

  return { teamId, created: true };
}

/**
 * Stores a LiteLLM user + API key credential for a Claw user without making any
 * LiteLLM API calls. The key is encrypted with AES-256-GCM and stored as a
 * hidden system-managed credential.
 *
 * Upsert/overwrite semantics: if a credential already exists it is replaced —
 * key rotation is a valid, supported case for this endpoint.
 */
export async function storeUserCredentialsForUser(
  input: {
    userId: string;
    orgId: string;
    spacesOrgId?: string | undefined;
    spacesOrgMemberId?: string | undefined;
    litellmUserId?: string | undefined;
    teamId?: string | undefined;
    key: string;
    tokenId?: string | undefined;
    keyName?: string | undefined;
    keyAlias?: string | undefined;
    expires?: string | undefined;
  },
  client: DbClient = prisma,
): Promise<{ credentialCreated: boolean; litellmUserId?: string; teamId?: string }> {
  const user = await client.user.findUnique({
    where: { id: input.userId },
    select: { id: true },
  });
  if (!user) {
    throw new LiteLLMProvisioningError(
      "/user-key/store",
      `Claw user ${input.userId} not found`,
      undefined,
      "NOT_FOUND",
    );
  }

  // Verify the user is a member of the target org before writing a
  // SYSTEM-managed credential — prevents an orchestrator from provisioning
  // a key that bills an org the user doesn't belong to.
  const member = await client.orgMember.findUnique({
    where: { userId_orgId: { userId: input.userId, orgId: input.orgId } },
    select: { userId: true },
  });
  if (!member) {
    throw new LiteLLMProvisioningError(
      "/user-key/store",
      `Claw user ${input.userId} is not a member of org ${input.orgId}`,
      undefined,
      "NOT_FOUND",
    );
  }

  const encrypted = encrypt(input.key, CONFIG.encryptionKey);
  const keyAlias = input.keyAlias ?? alias(`xyne-spaces ${input.userId}`, `xyne-spaces ${input.userId}`);
  const credentialMetadata = {
    source: "xyne-spaces",
    clawOrgId: input.orgId,
    clawUserId: input.userId,
    spacesOrgId: input.spacesOrgId ?? null,
    spacesOrgMemberId: input.spacesOrgMemberId ?? null,
    changedBy: CONFIG.litellmChangedBy,
    litellmUserId: input.litellmUserId ?? null,
    litellmTeamId: input.teamId ?? null,
    keyAlias,
    litellmTokenId: input.tokenId ?? null,
    litellmKeyName: input.keyName ?? null,
    expires: input.expires ?? null,
    provisionedAt: new Date().toISOString(),
  };

  const before = await client.userProviderCredentials.findUnique({
    where: { userId_provider_managedBy: { userId: input.userId, provider: LITELLM_PROVIDER, managedBy: "SYSTEM" } },
    select: { userId: true },
  });

  await client.userProviderCredentials.upsert({
    where: { userId_provider_managedBy: { userId: input.userId, provider: LITELLM_PROVIDER, managedBy: "SYSTEM" } },
    create: {
      userId: input.userId,
      provider: LITELLM_PROVIDER,
      managedBy: "SYSTEM",
      encryptedKey: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      model: CONFIG.litellmModel,
      baseUrl: CONFIG.litellmBaseUrl,
      authType: "api_key",
      metadata: credentialMetadata,
    },
    update: {
      encryptedKey: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      model: CONFIG.litellmModel,
      baseUrl: CONFIG.litellmBaseUrl,
      authType: "api_key",
      metadata: credentialMetadata,
    },
  });

  return {
    credentialCreated: !before,
    ...(input.litellmUserId ? { litellmUserId: input.litellmUserId } : {}),
    ...(input.teamId ? { teamId: input.teamId } : {}),
  };
}

/**
 * Stores a LiteLLM API key credential for a Claw ORG without making any LiteLLM
 * API calls. The key is encrypted with AES-256-GCM and stored in
 * `OrgProviderCredential` — the org-level LiteLLM key used at call sites that
 * run under the ORG's identity (no meaningful user context): the failure
 * curator, shared-agent memory curation, admin authoring tooling, and A2A
 * `callee_app` runs. Resolved at read time by `resolveOrgLitellmApiKey`.
 *
 * Mirrors `storeUserCredentialsForUser` but keyed on `(orgId, provider)`
 * instead of `(userId, provider, managedBy)` — an org key is a single dedicated
 * row (no `managedBy` tier, no shared-credential binding) and has no per-key
 * `model`/`baseUrl`/`authType` columns (those are LiteLLM constants resolved at
 * read time by `buildProviderConfig`, per the schema plan).
 *
 * Upsert/overwrite semantics: if a credential already exists it is replaced —
 * key rotation is a valid, supported case (same as the per-user store).
 */
export async function storeOrgCredentialsForOrg(
  input: {
    orgId: string;
    spacesOrgId?: string | undefined;
    teamId?: string | undefined;
    key: string;
    tokenId?: string | undefined;
    keyName?: string | undefined;
    keyAlias?: string | undefined;
    expires?: string | undefined;
  },
  client: DbClient = prisma,
): Promise<{ credentialCreated: boolean; teamId?: string }> {
  const org = await client.organization.findUnique({
    where: { id: input.orgId },
    select: { id: true },
  });
  if (!org) {
    throw new LiteLLMProvisioningError(
      "/org-key/store",
      `Claw org ${input.orgId} not found`,
      undefined,
      "NOT_FOUND",
    );
  }

  const encrypted = encrypt(input.key, CONFIG.encryptionKey);
  const keyAlias = input.keyAlias ?? alias(`xyne-spaces org ${input.orgId}`, `xyne-spaces org ${input.orgId}`);
  const credentialMetadata = {
    source: "xyne-spaces",
    clawOrgId: input.orgId,
    spacesOrgId: input.spacesOrgId ?? null,
    changedBy: CONFIG.litellmChangedBy,
    litellmTeamId: input.teamId ?? null,
    keyAlias,
    litellmTokenId: input.tokenId ?? null,
    litellmKeyName: input.keyName ?? null,
    expires: input.expires ?? null,
    provisionedAt: new Date().toISOString(),
  };

  const before = await client.orgProviderCredential.findUnique({
    where: { orgId_provider: { orgId: input.orgId, provider: LITELLM_PROVIDER } },
    select: { orgId: true },
  });

  await client.orgProviderCredential.upsert({
    where: { orgId_provider: { orgId: input.orgId, provider: LITELLM_PROVIDER } },
    create: {
      orgId: input.orgId,
      provider: LITELLM_PROVIDER,
      encryptedKey: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      metadata: credentialMetadata,
    },
    update: {
      encryptedKey: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      metadata: credentialMetadata,
    },
  });

  return {
    credentialCreated: !before,
    ...(input.teamId ? { teamId: input.teamId } : {}),
  };
}
