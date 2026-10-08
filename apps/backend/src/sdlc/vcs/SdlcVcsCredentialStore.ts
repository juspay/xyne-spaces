import { randomUUID } from 'crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { SDLC_GITHUB_HOST, SDLC_VCS_PROVIDERS } from '@xyne/shared';
import { AppError } from '@/middleware/errorHandler';
import { decryptCredentialPayload, encryptCredentialPayload } from './credentialEnvelope';
import type { CredentialEnvelope } from './credentialEnvelope';
import type { VcsProvider } from './types';
import { lockExternalSourceRow, type RawQueryMethod } from '@/bypassAcl/rowLockServices';

export const SDLC_VCS_EXTERNAL_SOURCE_TYPE = 'sdlc_vcs_credential';

export interface StoredSdlcVcsCredential {
  id: string;
  workspaceId: string;
  provider: VcsProvider;
  name: string;
  host: string;
  status: 'CONNECTED' | 'DISCONNECTED';
  token: string | null;
  revision: number;
  identityLogin: string | null;
  accountName: string | null;
  accountEmail: string | null;
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

type CredentialClient = Pick<PrismaClient, 'externalSource' | RawQueryMethod> | Prisma.TransactionClient;
type StoredPayload = Omit<StoredSdlcVcsCredential, 'id'>;

const SOURCE_SELECT = { id: true, workspaceId: true, externalIdentifier: true, credentials: true } as const;

// Rows created before named credentials were keyed `sdlc-vcs:<ws>:github` and stay readable.
function sourceName(workspaceId: string, credentialId: string): string {
  return `sdlc-vcs:${workspaceId}:${credentialId}`;
}

function isProvider(value: string | null): value is VcsProvider {
  return (SDLC_VCS_PROVIDERS as readonly string[]).includes(value ?? '');
}

export function serializeStoredCredential(credential: StoredPayload): string {
  const envelope = encryptCredentialPayload(JSON.stringify(credential), {
    workspaceId: credential.workspaceId,
    provider: credential.provider,
  });
  return JSON.stringify(envelope);
}

export function parseStoredCredential(source: {
  id: string;
  workspaceId: string | null;
  externalIdentifier: string | null;
  credentials: string;
}): StoredSdlcVcsCredential {
  if (!source.workspaceId || !isProvider(source.externalIdentifier)) {
    throw new AppError('Workspace credential source is invalid', 409);
  }
  let envelope: CredentialEnvelope;
  try {
    envelope = JSON.parse(source.credentials) as CredentialEnvelope;
  } catch {
    throw new AppError('Workspace credential envelope is invalid', 409);
  }
  let parsed: Partial<StoredPayload>;
  try {
    parsed = JSON.parse(
      decryptCredentialPayload(envelope, {
        workspaceId: source.workspaceId,
        provider: source.externalIdentifier,
      })
    ) as Partial<StoredPayload>;
  } catch {
    throw new AppError('Workspace credential payload is unavailable', 409);
  }
  if (
    parsed.workspaceId !== source.workspaceId ||
    parsed.provider !== source.externalIdentifier ||
    !Number.isSafeInteger(parsed.revision) ||
    (parsed.revision ?? 0) < 1
  ) {
    throw new AppError('Workspace credential binding is invalid', 409);
  }
  return {
    ...(parsed as StoredPayload),
    id: source.id,
    name: parsed.name ?? 'GitHub',
    host: parsed.host ?? SDLC_GITHUB_HOST,
    accountName: parsed.accountName ?? null,
    accountEmail: parsed.accountEmail ?? null,
  };
}

export class SdlcVcsCredentialStore {
  async list(client: CredentialClient, workspaceId: string): Promise<StoredSdlcVcsCredential[]> {
    const sources = await client.externalSource.findMany({
      where: { workspaceId, sourceType: SDLC_VCS_EXTERNAL_SOURCE_TYPE },
      select: SOURCE_SELECT,
      orderBy: { createdAt: 'asc' },
    });
    return sources.map(parseStoredCredential);
  }

  async find(
    client: CredentialClient,
    workspaceId: string,
    credentialId: string
  ): Promise<StoredSdlcVcsCredential | null> {
    const source = await client.externalSource.findFirst({
      where: { id: credentialId, workspaceId, sourceType: SDLC_VCS_EXTERNAL_SOURCE_TYPE },
      select: SOURCE_SELECT,
    });
    return source ? parseStoredCredential(source) : null;
  }

  async lock(client: CredentialClient, credentialId: string): Promise<void> {
    await lockExternalSourceRow(client, credentialId);
  }

  async save(
    client: CredentialClient,
    credential: StoredPayload & { id?: string }
  ): Promise<StoredSdlcVcsCredential> {
    const { id, ...payload } = credential;
    const credentials = serializeStoredCredential(payload);
    const displayName = `${payload.name} (${payload.host})`;
    if (id) {
      const source = await client.externalSource.update({
        where: { id },
        data: { credentials, isActive: payload.status === 'CONNECTED', displayName },
        select: SOURCE_SELECT,
      });
      return parseStoredCredential(source);
    }
    const newId = randomUUID();
    const source = await client.externalSource.create({
      data: {
        id: newId,
        name: sourceName(payload.workspaceId, newId),
        sourceType: SDLC_VCS_EXTERNAL_SOURCE_TYPE,
        displayName,
        externalIdentifier: payload.provider,
        workspaceId: payload.workspaceId,
        credentials,
        isActive: payload.status === 'CONNECTED',
      },
      select: SOURCE_SELECT,
    });
    return parseStoredCredential(source);
  }

  async remove(client: CredentialClient, credentialId: string): Promise<void> {
    await client.externalSource.delete({ where: { id: credentialId } });
  }
}
