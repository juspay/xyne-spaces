import { apiInstance } from '../clients/apiClient';
import { toast } from 'sonner';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * Upload / replace a workspace's logo. Admin/owner only (enforced server-side).
 * The image bytes go to object storage; the workspace row's `logo` path is
 * updated server-side and synced back to all clients via Zero.
 *
 * @returns the stored logo path (also arrives via Zero shortly after)
 */
export const uploadWorkspaceLogo = async (
  workspaceId: string,
  file: File,
): Promise<string> => {
  if (!ALLOWED_TYPES.includes(file.type)) {
    toast.error('Invalid file type. Only JPG, PNG, and WebP are allowed.');
    throw new Error('Invalid file type');
  }
  if (file.size > MAX_FILE_SIZE) {
    toast.error('File too large. Maximum size is 5MB.');
    throw new Error('File too large');
  }

  try {
    const formData = new FormData();
    formData.append('logo', file);

    const response = await apiInstance.post<{ logo: string }>(
      `/workspaces/${workspaceId}/logo`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );

    toast.success('Workspace logo updated successfully');
    return response.data.logo;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to upload workspace logo';
    toast.error(message);
    throw error;
  }
};

/**
 * Remove a workspace's logo. Admin/owner only (enforced server-side).
 */
export const deleteWorkspaceLogo = async (workspaceId: string): Promise<void> => {
  try {
    await apiInstance.delete(`/workspaces/${workspaceId}/logo`);
    toast.success('Workspace logo removed');
  } catch (error) {
    toast.error('Failed to remove workspace logo');
    throw error;
  }
};
