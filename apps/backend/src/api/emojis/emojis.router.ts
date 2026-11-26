import { API } from '@xyne/shared';
import { api } from '@/framework/api';
import { deleteEmoji, getEmoji, listEmojis } from './emojis.controller';

/** `/emojis`: custom emojis (login). The upload and the image stream are untyped (routes/emojis.ts). */
export const emojisRouter = api.router(API.emojis, {}, (serve) => ({
  list: serve('list', { controller: () => listEmojis() }),
  get: serve('get', { controller: ({ params }) => getEmoji({ params }) }),
  delete: serve('delete', { controller: ({ params, user }) => deleteEmoji({ params, user }) }),
}));
