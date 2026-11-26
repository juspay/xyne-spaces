import { api } from '@xyne/shared';
import { router } from '@/framework/api';
import { cacConfig } from './cac-config.controller';

/** `/cac-config` (login). */
export const cacConfigRouter = router(api.cacConfig, {}, (serve) => ({
  get: serve('get', { controller: ({ params, user, headers }) => cacConfig({ params, user, headers }) }),
}));
