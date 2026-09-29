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

/** Backend error responses are always {error, message} — surface `message` as a plain Error. */
function extractErrorMessage(error: unknown, fallback: string): string {
  const data = (error as { response?: { data?: { message?: unknown } } })?.response?.data;
  return typeof data?.message === 'string' ? data.message : fallback;
}

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
    try {
      const response = await apiInstance.post<MutateSecretResult>(
        `/secrets-vault/${encodeURIComponent(name)}/rotate`,
        { value },
      );
      return response.data;
    } catch (error) {
      throw new Error(extractErrorMessage(error, 'Failed to rotate secret'));
    }
  },

  rollbackSecret: async (name: string, version: number): Promise<MutateSecretResult> => {
    try {
      const response = await apiInstance.post<MutateSecretResult>(
        `/secrets-vault/${encodeURIComponent(name)}/rollback`,
        { version },
      );
      return response.data;
    } catch (error) {
      throw new Error(extractErrorMessage(error, 'Failed to roll back secret'));
    }
  },

  revokeSecret: async (name: string, expectedVersion: number): Promise<MutateSecretResult> => {
    try {
      const response = await apiInstance.post<MutateSecretResult>(
        `/secrets-vault/${encodeURIComponent(name)}/revoke`,
        { expectedVersion },
      );
      return response.data;
    } catch (error) {
      throw new Error(extractErrorMessage(error, 'Failed to revoke secret'));
    }
  },
};
