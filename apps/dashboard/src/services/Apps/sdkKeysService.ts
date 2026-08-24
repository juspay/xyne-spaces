import { apiInstance } from '../clients/apiClient';

/**
 * API keys for the public Spaces SDK.
 *
 * A key is workspace-scoped, because the user row that mints it is: someone
 * with access to two workspaces mints separately from each.
 */
/** Lifetimes a key can be minted with, in days. Mirrors `API_KEY_TTL_CHOICES` on the backend. */
export const API_KEY_TTL_CHOICES = [30, 60, 90] as const;
export type ApiKeyTtlDays = (typeof API_KEY_TTL_CHOICES)[number];

export interface SdkApiKey {
  id: string;
  name: string;
  createdAt: string;
  expiresAt: string;
  /** Last four characters — enough to tell two keys apart in a list. */
  hint: string;
  expired: boolean;
  revoked: boolean;
  revokedAt: string | null;
}

export interface SdkApiKeyList {
  keys: SdkApiKey[];
  maxLiveKeys: number;
}

/** A newly minted key. `key` is present in this response and nowhere else. */
export interface CreatedSdkApiKey extends SdkApiKey {
  key: string;
}

export const sdkKeysService = {
  async list(): Promise<SdkApiKeyList> {
    const response = await apiInstance.get<SdkApiKeyList>('/sdk-keys');
    return response.data;
  },

  async create(name: string, ttlDays: ApiKeyTtlDays): Promise<CreatedSdkApiKey> {
    const response = await apiInstance.post<CreatedSdkApiKey>('/sdk-keys', { name, ttlDays });
    return response.data;
  },

  async remove(id: string): Promise<void> {
    await apiInstance.delete(`/sdk-keys/${id}`);
  },
};
