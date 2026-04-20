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

export interface VoiceSignatureStatus {
  hasVoiceSignature: boolean;
}

/**
 * Upload an audio recording to extract and store the user's voice signature (speaker embedding).
 * The audio file is processed server-side; only the 1024-byte embedding is retained.
 *
 * @param file - Audio file (WAV, OGG, MP3, WebM). 5–30 seconds of clear speech works best.
 * @returns ISO timestamp of when the signature was stored
 */
export const uploadVoiceSignature = async (
  file: File,
  onProgress?: (pct: number) => void,
): Promise<void> => {
  const ALLOWED_TYPES = [
    'audio/wav',
    'audio/wave',
    'audio/x-wav',
    'audio/ogg',
    'audio/mpeg',
    'audio/mp3',
    'audio/webm',
    'video/webm',
    'audio/mp4',
  ];
  if (!ALLOWED_TYPES.includes(file.type)) {
    toast.error('Unsupported audio format. Please use WAV, OGG, MP3, or WebM.');
    throw new Error('Unsupported audio format');
  }

  const MAX_SIZE = 50 * 1024 * 1024; // 50 MB
  if (file.size > MAX_SIZE) {
    toast.error('Audio file too large (max 50 MB).');
    throw new Error('File too large');
  }

  const formData = new FormData();
  formData.append('audio', file);

  try {
    const response = await apiInstance.post<VoiceSignatureStatus>(
      '/users/me/voice-signature',
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 90_000, // 90s — model loading can be slow on first invocation
        onUploadProgress: event => {
          if (onProgress && event.total) {
            onProgress(Math.round((event.loaded * 100) / event.total));
          }
        },
      },
    );
    void response; // Zero will sync hasVoiceSignature after backend updates
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save voice signature';
    toast.error(message);
    throw error;
  }
};

/**
 * Delete the current user's voice signature.
 */
export const deleteVoiceSignature = async (): Promise<void> => {
  try {
    await apiInstance.delete('/users/me/voice-signature');
  } catch (error) {
    toast.error('Failed to remove voice signature');
    throw error;
  }
};
