import { CONFIG } from "../config.js";
import { encrypt } from "../crypto.js";
import { prisma, type AppPrismaClient, type AppTransactionClient } from "../db.js";
import { HttpError } from "../lib/http.js";
import { resolveClawOrgIdForSpacesOrg } from "../routes/spaces-sync.js";

const LITELLM_PROVIDER = "litellm";

type DbClient = AppPrismaClient | AppTransactionClient;

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

/** Spaces org id → Claw org id; NOT_FOUND when unmapped, CONFLICT when ambiguous. */
async function clawOrgIdForSpacesOrg(endpoint: string, spacesOrgId: string, client: DbClient): Promise<string> {
  let orgId: string | null;
  try {
    orgId = await resolveClawOrgIdForSpacesOrg(spacesOrgId, client);
  } catch (err) {
    if (err instanceof HttpError && err.status === 409) {
      throw new LiteLLMProvisioningError(endpoint, err.message, undefined, "CONFLICT");
    }
    throw err;
  }
  if (!orgId) {
    throw new LiteLLMProvisioningError(
      endpoint,
      `No Claw org mapped to Spaces org ${spacesOrgId}`,
      undefined,
      "NOT_FOUND",
    );
  }
  return orgId;
}

export async function storeTeamMappingForOrg(
  spacesOrgId: string,
  teamId: string,
  teamAlias?: string,
  status?: string,
  client: DbClient = prisma,
): Promise<{ teamId: string; created: boolean }> {
  const orgId = await clawOrgIdForSpacesOrg("/team", spacesOrgId, client);
  const existing = await client.orgProviderIntegration.findUnique({
    where: { orgId_provider: { orgId, provider: LITELLM_PROVIDER } },
    select: { externalId: true },
  });

  if (existing?.externalId && existing.externalId !== teamId) {
    throw new LiteLLMProvisioningError(
      "/team",
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

export async function storeUserCredentialsForUser(
  input: {
    userId: string;
    orgId: string;
    spacesOrgId?: string | undefined;
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
      "/user-key",
      `Claw user ${input.userId} not found`,
      undefined,
      "NOT_FOUND",
    );
  }

  const member = await client.orgMember.findUnique({
    where: { userId_orgId: { userId: input.userId, orgId: input.orgId } },
    select: { userId: true },
  });
  if (!member) {
    throw new LiteLLMProvisioningError(
      "/user-key",
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

export async function storeOrgCredentialsForOrg(
  input: {
    spacesOrgId: string;
    teamId?: string | undefined;
    key: string;
    tokenId?: string | undefined;
    keyName?: string | undefined;
    keyAlias?: string | undefined;
    expires?: string | undefined;
  },
  client: DbClient = prisma,
): Promise<{ credentialCreated: boolean; teamId?: string }> {
  const orgId = await clawOrgIdForSpacesOrg("/org-key", input.spacesOrgId, client);

  const encrypted = encrypt(input.key, CONFIG.encryptionKey);
  const keyAlias = input.keyAlias ?? alias(`xyne-spaces org ${orgId}`, `xyne-spaces org ${orgId}`);
  const credentialMetadata = {
    source: "xyne-spaces",
    clawOrgId: orgId,
    spacesOrgId: input.spacesOrgId,
    changedBy: CONFIG.litellmChangedBy,
    litellmTeamId: input.teamId ?? null,
    keyAlias,
    litellmTokenId: input.tokenId ?? null,
    litellmKeyName: input.keyName ?? null,
    expires: input.expires ?? null,
    provisionedAt: new Date().toISOString(),
  };

  const before = await client.orgProviderCredential.findUnique({
    where: { orgId_provider: { orgId, provider: LITELLM_PROVIDER } },
    select: { orgId: true },
  });

  await client.orgProviderCredential.upsert({
    where: { orgId_provider: { orgId, provider: LITELLM_PROVIDER } },
    create: {
      orgId,
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
