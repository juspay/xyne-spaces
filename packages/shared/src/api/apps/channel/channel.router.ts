import { defineRouter } from '../../../enc-contracts/api-route.js';
import { appsChannelDeskConfig, appsChannelInfo, appsChannelList, appsChannelOpenDm, appsChannelUpdate } from './channel.contracts.js';
import { appsChannelCommands } from './commands.contracts.js';

/** `/apps/channel`: channels for bots, and the commands of a channel (dashboard). Key order is the mount order. */
export const channelRouter = defineRouter('/channel', {
  openDm: appsChannelOpenDm,
  info: appsChannelInfo,
  deskChannelConfig: appsChannelDeskConfig,
  list: appsChannelList,
  update: appsChannelUpdate,
  commands: appsChannelCommands,
});
