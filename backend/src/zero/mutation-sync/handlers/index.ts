import type { TableName } from '../../acl/core/types';
import type { QueryContext } from '../../acl/core/types';
import { ReactionsMutationSyncHandler } from './reactions';
import { MessagesMutationSyncHandler } from './messages';
import { TicketsMutationSyncHandler } from './tickets';
import { BaseMutationSyncHandler } from '../base-handler';

export const mutationSyncHandlers: Partial<
  Record<TableName, (ctx: QueryContext) => BaseMutationSyncHandler>
> = {
  reactions: ctx => new ReactionsMutationSyncHandler(ctx),
  messages: ctx => new MessagesMutationSyncHandler(ctx),
  tickets: ctx => new TicketsMutationSyncHandler(ctx),
};
