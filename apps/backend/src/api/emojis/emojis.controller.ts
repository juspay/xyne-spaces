import { api } from '@xyne/shared';
import { CustomEmojiRepository } from '@/database/repositories/customEmojiRepository';
import { ContractError, controller } from '@/framework/api';
import { getStorageService } from '@/services/storage';
import { logger } from '@/utils/logger';
import { transformEmoji } from '@/controllers/customEmojiController';
import { internal, requireUser } from '../settings.helpers';

// ─── Custom emojis ──────────────────────────────────────────────────────────

const customEmojiRepository = new CustomEmojiRepository();

/** GET /emojis */
export const listEmojis = controller(api.emojis.list, async () => {
  try {
    return { success: true as const, emojis: (await customEmojiRepository.findAll()).map(transformEmoji) };
  } catch (error) {
    throw internal(error, 'Error fetching custom emojis:');
  }
});

/** GET /emojis/:emojiId */
export const getEmoji = controller(api.emojis.get, async (input) => {
  try {
    const emoji = await customEmojiRepository.findById(input.params.emojiId);
    if (!emoji) throw new ContractError(404, { error: 'Emoji not found' });
    return { success: true as const, emoji: transformEmoji(emoji) };
  } catch (error) {
    throw internal(error, 'Error fetching custom emoji:');
  }
});

/** DELETE /emojis/:emojiId: the creator only. */
export const deleteEmoji = controller(api.emojis.delete, async (input) => {
  try {
    const user = requireUser(input.user);
    const { emojiId } = input.params;
    const emoji = await customEmojiRepository.findById(emojiId);
    if (!emoji) throw new ContractError(404, { error: 'Emoji not found' });
    // Check if user is the creator (or add admin check if needed)
    if (emoji.createdBy !== user.id) throw new ContractError(403, { error: 'You do not have permission to delete this emoji' });
    try {
      await getStorageService().deleteFile(emoji.url);
    } catch (error) {
      logger.warn(`Failed to delete emoji file from GCS: ${emoji.url}`, error);
      // Continue with emoji deletion even if file deletion fails
    }
    await customEmojiRepository.delete(emojiId);
    logger.info(`Custom emoji deleted: ${emoji.name} by user ${user.id}`);
    return { success: true as const, message: 'Custom emoji deleted successfully' };
  } catch (error) {
    throw internal(error, 'Error deleting custom emoji:');
  }
});