import { API } from '@xyne/shared';
import { api } from '@/framework/api';
import { cacConfig } from './cac-config.controller';

/** `/cac-config` (login). */
export const cacConfigRouter = api.router(API.cacConfig, {}, (serve) => ({
  get: serve('get', { controller: ({ params, user, headers }) => cacConfig({ params, user, headers }) }),
}));
