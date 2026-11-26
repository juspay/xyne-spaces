import { defineRouter } from '../../enc-contracts/api-route.js';
import { channelsCanLinkBoards, channelsCheckDuplicate, channelsConnectedEmail, channelsEmailAlias, channelsMemberCounts, channelsMembers, channelsPublishTargets, channelsSearch, channelsShareAgentStatus, channelsVespaParticipants } from './channels.contracts.js';
import { tagsConfigRouter } from './tags-config/tags-config.router.js';

/** `/channels`: channel lookups and checks, and a channel's tags config. Key order is the mount order. */
export const channelsRouter = defineRouter('/channels', {
  checkDuplicate: channelsCheckDuplicate,
  search: channelsSearch,
  memberCounts: channelsMemberCounts,
  publishTargets: channelsPublishTargets,
  connectedEmail: channelsConnectedEmail,
  emailAlias: channelsEmailAlias,
  vespaParticipants: channelsVespaParticipants,
  members: channelsMembers,
  canLinkBoards: channelsCanLinkBoards,
  shareAgentStatus: channelsShareAgentStatus,
  tagsConfig: tagsConfigRouter,
});
