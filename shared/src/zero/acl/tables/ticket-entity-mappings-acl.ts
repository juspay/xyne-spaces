import type { Query } from '@rocicorp/zero';
import { type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class TicketEntityMappingsACL extends BaseQueryACL<'ticket_entity_mappings'> {
  constructor(ctx: Context) {
    super(ctx, 'ticket_entity_mappings');
  }

  canSelect<TReturn>(query: Query<'ticket_entity_mappings', Schema, TReturn>): Query<'ticket_entity_mappings', Schema, TReturn> {
    return query;
    // return query.whereExists('ticket', (ticket) => {
    //   return ticket.whereExists('conversation', (conversation) => {
    //     return conversation.whereExists('channel', (channel) => {
    //       return channel.where(({ cmp, or, exists, and }) => {
    //         return or(
    //           and(
    //             cmp('visibility', ChannelVisibility.PRIVATE),
    //             exists('participants', (participants) => {
    //               return participants.where('userId', this.ctx.userID);
    //             })
    //           ),
    //           and(
    //             cmp('visibility', ChannelVisibility.PUBLIC),
    //             exists('project', (project) => {
    //               return project.whereExists('channels', (channelQuery) => {
    //                 return channelQuery
    //                   .where('visibility', ChannelVisibility.PUBLIC)
    //                   .whereExists('participants', (participants) => {
    //                     return participants.where('userId', this.ctx.userID);
    //                   });
    //               });
    //             })
    //           )
    //         );
    //       });
    //     });
    //   });
    // });
  }
}
