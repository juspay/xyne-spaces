import { apiInstance } from '../clients/apiClient';

// ============================================================================
// TYPES
// ============================================================================

export interface CustomEmoji {
  id: string;
  name: string;
  url: string;
  createdAt: string;
  createdBy: string;
  creator?: {
    id: string;
    name: string;
    email: string;
    picture?: string;
  };
}

export interface CreateEmojiResponse {
  success: boolean;
  message: string;
  emoji: CustomEmoji;
}

// ============================================================================
// SERVICE CLASS
// ============================================================================

export class EmojiService {
  /**
   * Get all custom emojis
   */
  async getAllCustomEmojis(): Promise<{ success: boolean; emojis: CustomEmoji[] }> {
    const response = await apiInstance.get<{ success: boolean; emojis: CustomEmoji[] }>('/emojis');
    return response.data;
  }

  /**
   * Get a single custom emoji by ID
   */
  async getCustomEmojiById(emojiId: string): Promise<{
    success: boolean;
    emoji: CustomEmoji;
  }> {
    const response = await apiInstance.get<{ success: boolean; emoji: CustomEmoji }>(
      `/emojis/${emojiId}`,
    );
    return response.data;
  }

  /**
   * Create a new custom emoji with file upload
   * @param file - The emoji image file
   * @param name - The emoji name (shortcode)
   */
  async createCustomEmoji(file: File, name: string): Promise<CreateEmojiResponse> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', name);

    const response = await apiInstance.post<CreateEmojiResponse>('/emojis', formData, {
      headers: {
        CONTENT_TYPE: 'multipart/form-data',
      },
    });

    return response.data;
  }

  /**
   * Delete a custom emoji
   */
  async deleteCustomEmoji(emojiId: string): Promise<{
    success: boolean;
    message: string;
  }> {
    const response = await apiInstance.delete<{ success: boolean; message: string }>(
      `/emojis/${emojiId}`,
    );
    return response.data;
  }

  /**
   * Upload and create a custom emoji in one operation
   * @deprecated Use createCustomEmoji directly
   */
  async uploadAndCreateEmoji(file: File, name: string): Promise<CreateEmojiResponse> {
    return await this.createCustomEmoji(file, name);
  }
}

export const emojiService = new EmojiService();
