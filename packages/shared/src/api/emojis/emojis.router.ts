import { defineRouter } from '../../enc-contracts/api-route.js';
import { emojisDelete, emojisGet, emojisList } from './emojis.contracts.js';

/** `/emojis`: custom emojis. Key order is the mount order. */
export const emojisRouter = defineRouter('/emojis', {
  list: emojisList,
  get: emojisGet,
  delete: emojisDelete,
});
