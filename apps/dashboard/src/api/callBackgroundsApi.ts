import { API_BASE_URL } from '../config';
import { apiInstance } from '../services/clients/apiClient';
import { type PresetBackground, saveCachedPresetBackgrounds } from '../utils/callBackground';

interface CallBackgroundsResponse {
  success: boolean;
  backgrounds?: unknown[];
}

interface UploadBackgroundResponse {
  success: boolean;
  id: string;
}

export const callBackgroundImageUrl = (id: string, variant: 'full' | 'thumb' = 'full'): string =>
  `${API_BASE_URL}/calls/backgrounds/${encodeURIComponent(id)}/image${
    variant === 'thumb' ? '?variant=thumb' : ''
  }`;

const isEntry = (value: unknown): value is { id: string; label: string } =>
  !!value &&
  typeof value === 'object' &&
  typeof (value as Record<string, unknown>)['id'] === 'string' &&
  typeof (value as Record<string, unknown>)['label'] === 'string';

export const callBackgroundsApi = {
  /**
   * Preset call backgrounds (images in storage, list in Superposition). The result is
   * cached locally so a saved background can be re-applied at join before this resolves.
   */
  listPresets: async (): Promise<PresetBackground[]> => {
    const res = await apiInstance.get<CallBackgroundsResponse>('/calls/backgrounds');
    const presets = (res.data.backgrounds ?? []).filter(isEntry).map(({ id, label }) => ({
      id,
      label,
      url: callBackgroundImageUrl(id),
      thumbUrl: callBackgroundImageUrl(id, 'thumb'),
    }));
    saveCachedPresetBackgrounds(presets);
    return presets;
  },

  /** Calls admin: store a preset image; returns the id to list in Superposition. */
  uploadPreset: async (image: Blob, thumb: Blob): Promise<string> => {
    const formData = new FormData();
    formData.append('image', image, 'background.jpg');
    formData.append('thumb', thumb, 'background-thumb.jpg');
    const res = await apiInstance.post<UploadBackgroundResponse>(
      '/calls/admin/backgrounds',
      formData,
    );
    return res.data.id;
  },
};
