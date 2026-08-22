import { apiInstance } from '../clients/apiClient';

/**
 * API keys for the public Spaces SDK.
 *
 * A key is workspace-scoped, because the user row that mints it is: someone
 * with access to two workspaces mints separately from each.
 */
export interface SdkApiKey {
  id: string;
  name: string;
  createdAt: string;
  expiresAt: string;
  /** Last four characters — enough to tell two keys apart in a list. */
  hint: string;
  expired: boolean;
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

  async create(name: string): Promise<CreatedSdkApiKey> {
    const response = await apiInstance.post<CreatedSdkApiKey>('/sdk-keys', { name });
    return response.data;
  },

  async remove(id: string): Promise<void> {
    await apiInstance.delete(`/sdk-keys/${id}`);
  },
};
