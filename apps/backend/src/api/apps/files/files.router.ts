import { API } from '@xyne/shared';
import { api } from '@/framework/api';
import { fileInfo } from './files.controller';
import { appPermission } from '@/apps/access';

/** `/apps/files`: a file's metadata (bot token). */
export const filesRouter = api.router(API.apps.files, { auth: 'app' }, (serve) => ({
  info: serve('info', { access: { permission: appPermission('files:read') }, controller: ({ params, user }) => fileInfo({ params, user }) }),
}));
