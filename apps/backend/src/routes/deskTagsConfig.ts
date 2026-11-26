import { Router } from 'express';
import { API } from '@xyne/shared';
import { api } from '@/framework/api';
import { deskTagsAccess, getChannelTagsConfig, updateChannelTagsConfig } from '@/handlers/settings';

// Typed routes (API.channelTagsConfig), served by the API router behind the contract gate.
api.routes(API.channelTagsConfig, (serve) => ({
  get: serve('get', { access: { tags: deskTagsAccess({ manage: false }) }, handle: ({ params }) => getChannelTagsConfig({ params }) }),
  update: serve('update', {
    access: { tags: deskTagsAccess({ manage: true }) },
    handle: ({ params, body, access }) => updateChannelTagsConfig({ params, body, caller: access.tags }),
  }),
}));

// Nothing untyped left under /api/channels/:channelId/tags-config.
const router = Router({ mergeParams: true });
export default router;
