import { config } from '@/config/env';

type RequestOptions = {
  method?: 'GET' | 'POST';
  body?: unknown;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(`${config.internal.encryptionServiceUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      'x-s2s-key': config.internal.encryptionS2sKey,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Encryption service ${options.method ?? 'GET'} ${path} failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<T>;
}

export function isOrgEncryptionProvisioningEnabled(): boolean {
  return (
    config.enc.enableDbEncryption ||
    config.enc.clientEncryptionEnabled ||
    config.enc.apiClientEncryptionEnabled
  );
}

export type EncryptBatchItem = {
  value: string;
  entityId: string;
  entityType: string;
};

export type ProvisionEncryptionEntityResult = {
  entityId: string;
  entityType: string;
  ok: boolean;
  keyId?: string;
  message?: string;
};

export type EncryptionEntityProvisioningTarget = {
  entityId: string;
  orgId: string;
  entityType: string;
};

export async function getEncryptionPublicKey(): Promise<{
  publicKey: string;
  encryptedFields: Record<string, { fields: string[]; enforceClientEncryption: boolean }>;
  clientEncryptionEnabled: boolean;
  apiClientEncryptionEnabled: boolean;
}> {
  return await request('/internal/encryption/public-key');
}

export async function registerClientKey(params: {
  wrappedKey: string;
  sessionId: string;
  userId: string;
  orgId: string;
}): Promise<{ ok: true; sessionFingerprint: string }> {
  return await request('/internal/encryption/session/register-client-key', {
    method: 'POST',
    body: params,
  });
}

export async function batchDecryptServerValues(values: string[]): Promise<string[]> {
  if (values.length === 0) {
    return values;
  }

  const response = await request<{ values: string[] }>('/internal/encryption/server/batch-decrypt', {
    method: 'POST',
    body: { values },
  });
  return response.values;
}

export async function batchEncryptServerValues(items: EncryptBatchItem[]): Promise<string[]> {
  if (items.length === 0) {
    return [];
  }

  const response = await request<{ items: Array<{ value: string }> }>('/internal/encryption/server/batch-encrypt', {
    method: 'POST',
    body: { items },
  });
  return response.items.map((item) => item.value);
}

export async function decryptRequestBody<T>(body: T, sessionId: string): Promise<T> {
  const response = await request<{ body: T }>('/internal/encryption/session/decrypt-body', {
    method: 'POST',
    body: { body, sessionId },
  });
  return response.body;
}

export async function encryptResponseBody<T>(body: T, sessionId: string): Promise<T> {
  const response = await request<{ body: T }>('/internal/encryption/session/encrypt-body', {
    method: 'POST',
    body: { body, sessionId },
  });
  return response.body;
}

export async function deleteClientKey(sessionId: string): Promise<void> {
  await request('/internal/encryption/session/delete-client-key', {
    method: 'POST',
    body: { sessionId },
  });
}

export async function initializeOrgEncryption(orgId: string): Promise<void> {
  if (!isOrgEncryptionProvisioningEnabled()) {
    return;
  }

  await request('/internal/encryption/org/initialize', {
    method: 'POST',
    body: { orgId },
  });
}

export async function provisionEncryptionEntityForOrg(
  entityId: string,
  orgId: string,
  entityType: string,
): Promise<void> {
  if (!isOrgEncryptionProvisioningEnabled()) {
    return;
  }

  await request('/internal/encryption/entity/provision', {
    method: 'POST',
    body: { entityId, orgId, entityType },
  });
}

export async function backfillEncryptionEntityBatch(
  entities: EncryptionEntityProvisioningTarget[],
): Promise<ProvisionEncryptionEntityResult[]> {
  if (entities.length === 0) {
    return [];
  }

  const response = await request<{ results: ProvisionEncryptionEntityResult[] }>(
    '/internal/encryption/entity/backfill-provision-batch',
    {
      method: 'POST',
      body: { entities },
    },
  );
  return response.results;
}
