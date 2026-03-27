import { apiInstance } from '../clients/apiClient';
import { toast } from 'sonner';

/**
 * Upload a profile picture for the current user
 * @param file - Image file to upload (JPG, PNG, or WebP, max 5MB)
 * @returns The public URL of the uploaded picture
 */
export const uploadProfilePicture = async (file: File): Promise<string> => {
  // Validate file type
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  if (!ALLOWED_TYPES.includes(file.type)) {
    toast.error('Invalid file type. Only JPG, PNG, and WebP are allowed.');
    throw new Error('Invalid file type');
  }

  // Validate file size (5MB)
  const MAX_FILE_SIZE = 5 * 1024 * 1024;
  if (file.size > MAX_FILE_SIZE) {
    toast.error('File too large. Maximum size is 5MB.');
    throw new Error('File too large');
  }

  try {
    const formData = new FormData();
    formData.append('picture', file);

    const response = await apiInstance.post<{ picture: string }>('/users/me/picture', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    toast.success('Profile picture updated successfully');
    return response.data.picture;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to upload profile picture';
    toast.error(errorMessage);
    throw error;
  }
};
