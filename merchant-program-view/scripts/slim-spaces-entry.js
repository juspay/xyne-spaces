/**
 * Slim Spaces SDK entry.
 *
 * The published Sandbox caps each file at 64 KB and the full SDK bundles to
 * ~70 KB, so we compile ONLY the resources this app uses. \`npm run bundle:sdk\`
 * turns this into lib/vendor/spaces-sdk.js.
 *
 * To add a resource: import its class below, add it to the returned object, add
 * the same key to the Pick<> in lib/vendor/spaces-sdk.d.ts, then run
 * \`npm run bundle:sdk\`. All resource classes live in @xyne/spaces-sdk's client.
 */
import { HttpClient } from '../node_modules/@xyne/spaces-sdk/dist/core/http.js';
import { Transport } from '../node_modules/@xyne/spaces-sdk/dist/core/transport.js';
import { UsersResource } from '../node_modules/@xyne/spaces-sdk/dist/resources/users.js';
import { ChannelsResource } from '../node_modules/@xyne/spaces-sdk/dist/resources/channels.js';
import { ConversationsResource } from '../node_modules/@xyne/spaces-sdk/dist/resources/conversations.js';
import { MessagesResource } from '../node_modules/@xyne/spaces-sdk/dist/resources/messages.js';
import { SearchResource } from '../node_modules/@xyne/spaces-sdk/dist/resources/search.js';
import { TicketsResource } from '../node_modules/@xyne/spaces-sdk/dist/resources/tickets.js';
import { ProjectsResource } from '../node_modules/@xyne/spaces-sdk/dist/resources/projects.js';
import { BoardsResource } from '../node_modules/@xyne/spaces-sdk/dist/resources/boards.js';
import { ActivitiesResource } from '../node_modules/@xyne/spaces-sdk/dist/resources/activities.js';
import { ClawResource } from '../node_modules/@xyne/spaces-sdk/dist/resources/claw.js';
import { SupportTicketsResource } from '../node_modules/@xyne/spaces-sdk/dist/resources/support-tickets.js';
import { WorkspaceResource } from '../node_modules/@xyne/spaces-sdk/dist/resources/workspace.js';
import { FormsResource } from '../node_modules/@xyne/spaces-sdk/dist/resources/forms.js';
import { UserGroupsResource } from '../node_modules/@xyne/spaces-sdk/dist/resources/user-groups.js';

export function createClient(options = {}) {
  const transport = new Transport(
    new HttpClient({
      baseUrl: options.baseUrl ?? '',
      token: options.apiKey,
      timeout: options.timeout,
      useBeta: options.useBeta,
    }),
  );
  return {
    users: new UsersResource(transport),
    channels: new ChannelsResource(transport),
    conversations: new ConversationsResource(transport),
    messages: new MessagesResource(transport),
    search: new SearchResource(transport),
    tickets: new TicketsResource(transport),
    projects: new ProjectsResource(transport),
    boards: new BoardsResource(transport),
    activities: new ActivitiesResource(transport),
    claw: new ClawResource(transport),
    supportTickets: new SupportTicketsResource(transport),
    workspace: new WorkspaceResource(transport),
    forms: new FormsResource(transport),
    userGroups: new UserGroupsResource(transport),
  };
}
