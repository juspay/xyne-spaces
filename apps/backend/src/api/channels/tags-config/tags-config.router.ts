import { api } from '@xyne/shared';
import { router } from '@/framework/api';
import { deskTagsAccess, getChannelTagsConfig, updateChannelTagsConfig } from './tags-config.controller';

/** `/channels/:channelId/tags-config`: a channel's desk tag-generation config (member; changing it: desk owner, channel admin or creator). */
export const tagsConfigRouter = router(api.channels.tagsConfig, {}, (serve) => ({
  get: serve('get', { access: { tags: deskTagsAccess({ manage: false }) }, controller: ({ params }) => getChannelTagsConfig({ params }) }),
  update: serve('update', {
    access: { tags: deskTagsAccess({ manage: true }) },
    controller: ({ params, body, access }) => updateChannelTagsConfig({ params, body, caller: access.tags }),
  }),
}));
