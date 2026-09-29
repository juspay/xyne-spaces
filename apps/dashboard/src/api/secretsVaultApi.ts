import { apiInstance } from '../services/clients/apiClient';

export type SecretVersionSummary = {
  version: number;
  status: string;
  encryptionImpl: string;
  createdAt: string;
  verifiedAt: string | null;
};

export type SecretSummary = {
  id: string;
  name: string;
  rotationState: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  activeVersion: SecretVersionSummary | null;
};

export type SecretVersionDetail = SecretVersionSummary & {
  retiredAt: string | null;
};

export type MutateSecretResult = {
  success: boolean;
  version: number;
  status: string;
};

// apiClient's response interceptor already turns every non-2xx response into a
// plain Error whose `.message` is the backend's real `message` field (see
// createErrorWithStatus in services/clients/apiClient.ts) — no need to reach
// into `.response.data` here ourselves, that data no longer exists on the
// error by the time it reaches this file.

export const secretsVaultApi = {
  listSecrets: async (): Promise<SecretSummary[]> => {
    const response = await apiInstance.get<{ secrets: SecretSummary[] }>('/secrets-vault');
    return response.data.secrets;
  },

  createSecret: async (name: string, value: string): Promise<void> => {
    await apiInstance.post('/secrets-vault', { name, value });
  },

  listVersions: async (name: string): Promise<SecretVersionDetail[]> => {
    const response = await apiInstance.get<{ versions: SecretVersionDetail[] }>(
      `/secrets-vault/${encodeURIComponent(name)}/versions`,
    );
    return response.data.versions;
  },

  rotateSecret: async (name: string, value: string): Promise<MutateSecretResult> => {
    const response = await apiInstance.post<MutateSecretResult>(
      `/secrets-vault/${encodeURIComponent(name)}/rotate`,
      { value },
    );
    return response.data;
  },

  rollbackSecret: async (name: string, version: number): Promise<MutateSecretResult> => {
    const response = await apiInstance.post<MutateSecretResult>(
      `/secrets-vault/${encodeURIComponent(name)}/rollback`,
      { version },
    );
    return response.data;
  },

  revokeSecret: async (name: string, expectedVersion: number): Promise<MutateSecretResult> => {
    const response = await apiInstance.post<MutateSecretResult>(
      `/secrets-vault/${encodeURIComponent(name)}/revoke`,
      { expectedVersion },
    );
    return response.data;
  },
};
