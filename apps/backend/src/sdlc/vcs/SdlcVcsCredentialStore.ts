import type { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '@/middleware/errorHandler';
import { decryptCredentialPayload, encryptCredentialPayload } from './credentialEnvelope';
import type { CredentialEnvelope } from './credentialEnvelope';
import type { VcsProvider } from './types';

export const SDLC_VCS_EXTERNAL_SOURCE_TYPE = 'sdlc_vcs_credential';

export interface StoredSdlcVcsCredential {
  id: string;
  workspaceId: string;
  provider: VcsProvider;
  status: 'CONNECTED' | 'DISCONNECTED';
  token: string | null;
  revision: number;
  identityLogin: string | null;
  resourceOwner: string | null;
  fingerprint: string | null;
  validationStatus: string;
  validatedAt: string | null;
  validationErrorCode: string | null;
  validationErrorMessage: string | null;
  createdBy: string;
  updatedBy: string;
  disconnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type CredentialClient = Pick<PrismaClient, 'externalSource' | '$queryRaw'> | Prisma.TransactionClient;

export function sdlcVcsSourceName(workspaceId: string, provider: VcsProvider): string {
  return `sdlc-vcs:${workspaceId}:${provider.toLowerCase()}`;
}

export function serializeStoredCredential(
  credential: Omit<StoredSdlcVcsCredential, 'id'>,
): string {
  const envelope = encryptCredentialPayload(JSON.stringify(credential), {
    workspaceId: credential.workspaceId,
    provider: credential.provider,
  });
  return JSON.stringify(envelope);
}

export function parseStoredCredential(
  source: { id: string; workspaceId: string | null; externalIdentifier: string | null; credentials: string },
): StoredSdlcVcsCredential {
  if (!source.workspaceId || source.externalIdentifier !== 'GITHUB') {
    throw new AppError('Workspace credential source is invalid', 409);
  }
  let envelope: CredentialEnvelope;
  try {
    envelope = JSON.parse(source.credentials) as CredentialEnvelope;
  } catch {
    throw new AppError('Workspace credential envelope is invalid', 409);
  }
  let parsed: Omit<StoredSdlcVcsCredential, 'id'>;
  try {
    parsed = JSON.parse(
      decryptCredentialPayload(envelope, {
        workspaceId: source.workspaceId,
        provider: source.externalIdentifier,
      }),
    ) as Omit<StoredSdlcVcsCredential, 'id'>;
  } catch {
    throw new AppError('Workspace credential payload is unavailable', 409);
  }
  if (
    parsed.workspaceId !== source.workspaceId ||
    parsed.provider !== source.externalIdentifier ||
    !Number.isSafeInteger(parsed.revision) ||
    parsed.revision < 1
  ) {
    throw new AppError('Workspace credential binding is invalid', 409);
  }
  return { id: source.id, ...parsed };
}

export class SdlcVcsCredentialStore {
  async list(client: CredentialClient, workspaceId: string): Promise<StoredSdlcVcsCredential[]> {
    const sources = await client.externalSource.findMany({
      where: { workspaceId, sourceType: SDLC_VCS_EXTERNAL_SOURCE_TYPE },
      select: { id: true, workspaceId: true, externalIdentifier: true, credentials: true },
      orderBy: { externalIdentifier: 'asc' },
    });
    return sources.map(parseStoredCredential);
  }

  async find(
    client: CredentialClient,
    workspaceId: string,
    provider: VcsProvider,
  ): Promise<StoredSdlcVcsCredential | null> {
    const source = await client.externalSource.findUnique({
      where: { name: sdlcVcsSourceName(workspaceId, provider) },
      select: { id: true, workspaceId: true, externalIdentifier: true, credentials: true },
    });
    return source ? parseStoredCredential(source) : null;
  }

  async lock(
    client: CredentialClient,
    workspaceId: string,
    provider: VcsProvider,
  ): Promise<void> {
    const name = sdlcVcsSourceName(workspaceId, provider);
    await client.$queryRaw`SELECT "id" FROM "workflow"."external_sources" WHERE "name" = ${name} FOR UPDATE`;
  }

  async save(
    client: CredentialClient,
    credential: Omit<StoredSdlcVcsCredential, 'id'> & { id?: string },
  ): Promise<StoredSdlcVcsCredential> {
    const name = sdlcVcsSourceName(credential.workspaceId, credential.provider);
    const credentials = serializeStoredCredential(credential);
    const source = await client.externalSource.upsert({
      where: { name },
      create: {
        ...(credential.id ? { id: credential.id } : {}),
        name,
        sourceType: SDLC_VCS_EXTERNAL_SOURCE_TYPE,
        displayName: `${credential.provider === 'GITHUB' ? 'GitHub' : credential.provider} repository credential`,
        externalIdentifier: credential.provider,
        workspaceId: credential.workspaceId,
        credentials,
        isActive: credential.status === 'CONNECTED',
      },
      update: {
        credentials,
        isActive: credential.status === 'CONNECTED',
        displayName: `${credential.provider === 'GITHUB' ? 'GitHub' : credential.provider} repository credential`,
        externalIdentifier: credential.provider,
        workspaceId: credential.workspaceId,
      },
      select: { id: true, workspaceId: true, externalIdentifier: true, credentials: true },
    });
    return parseStoredCredential(source);
  }
}
