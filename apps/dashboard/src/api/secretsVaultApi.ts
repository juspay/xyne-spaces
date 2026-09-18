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
  createdAt: string;
  liveVersion: SecretVersionSummary | null;
};

export const secretsVaultApi = {
  listSecrets: async (): Promise<SecretSummary[]> => {
    const response = await apiInstance.get<{ secrets: SecretSummary[] }>('/secrets-vault');
    return response.data.secrets;
  },

  createSecret: async (name: string, value: string): Promise<void> => {
    await apiInstance.post('/secrets-vault', { name, value });
  },
};
