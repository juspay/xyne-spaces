import { api } from '@xyne/shared';
import { router } from '@/framework/api';
import { fileInfo } from './files.controller';
import { appPermission } from '@/apps/access';

/** `/apps/files`: a file's metadata (bot token). */
export const filesRouter = router(api.apps.files, { auth: 'app' }, (serve) => ({
  info: serve('info', { access: { permission: appPermission('files:read') }, controller: ({ params, user }) => fileInfo({ params, user }) }),
}));
