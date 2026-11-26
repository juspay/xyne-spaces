import { defineRouter } from '../../../enc-contracts/api-route.js';
import { channelTagsConfigGet, channelTagsConfigUpdate } from './tags-config.contracts.js';

/** `/channels/:channelId/tags-config`: a channel's desk tag-generation config. Key order is the mount order. */
export const tagsConfigRouter = defineRouter('/:channelId/tags-config', {
  get: channelTagsConfigGet,
  update: channelTagsConfigUpdate,
});
