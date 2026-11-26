import { api } from '@xyne/shared';
import { router } from '@/framework/api';
import { canLinkBoards, channelMembers, checkDuplicate, connectedEmail, emailAlias, memberCounts, publishTargets, searchForMentions, shareAgentStatus, vespaParticipants } from './channels.controller';
import { tagsConfigRouter } from './tags-config/tags-config.router';

/** `/channels`: channel lookups and checks (login; membership checked where the controllers did). Creating a channel, conversations and sharing an agent conversation are untyped (routes/channels.ts). */
export const channelsRouter = router(api.channels, {}, (serve) => ({
  checkDuplicate: serve('checkDuplicate', { controller: ({ body, user }) => checkDuplicate({ body, user }) }),
  search: serve('search', { controller: ({ query, user }) => searchForMentions({ query, user }) }),
  memberCounts: serve('memberCounts', { controller: ({ body, user }) => memberCounts({ body, user }) }),
  publishTargets: serve('publishTargets', { controller: ({ user }) => publishTargets({ user }) }),
  connectedEmail: serve('connectedEmail', {
    responseHeaders: { 'Cache-Control': 'private, no-cache' },
    controller: ({ params, user }) => connectedEmail({ params, user }),
  }),
  emailAlias: serve('emailAlias', { controller: ({ params, user }) => emailAlias({ params, user }) }),
  vespaParticipants: serve('vespaParticipants', { controller: ({ params, user }) => vespaParticipants({ params, user }) }),
  members: serve('members', { controller: ({ params, user }) => channelMembers({ params, user }) }),
  canLinkBoards: serve('canLinkBoards', { controller: ({ params, user }) => canLinkBoards({ params, user }) }),
  shareAgentStatus: serve('shareAgentStatus', { controller: ({ params, query, user }) => shareAgentStatus({ params, query, user }) }),
  tagsConfig: tagsConfigRouter,
}));
