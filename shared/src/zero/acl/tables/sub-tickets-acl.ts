import type { Query } from '@rocicorp/zero';
import {type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class SubTicketsACL extends BaseQueryACL<'sub_tickets'> {
  constructor(ctx: Context) {
    super(ctx, 'sub_tickets');
  }

  canSelect<TReturn>(query: Query<'sub_tickets', Schema, TReturn>): Query<'sub_tickets', Schema, TReturn> {
    return query;
    // return query.whereExists('ticketMappings', (mapping) => {
    //   return mapping.whereExists('ticket', (ticket) => {
    //     return ticket.whereExists('conversation', (conversation) => {
    //       return conversation.whereExists('channel', (channel) => {
    //         return channel.where(({ cmp, or, exists, and }) => {
    //           return or(
    //             and(
    //               cmp('visibility', ChannelVisibility.PRIVATE),
    //               exists('participants', (participants) => {
    //                 return participants.where('userId', this.ctx.userID);
    //               })
    //             ),
    //             and(
    //               cmp('visibility', ChannelVisibility.PUBLIC),
    //               exists('project', (project) => {
    //                 return project.whereExists('channels', (channelQuery) => {
    //                   return channelQuery
    //                     .where('visibility', ChannelVisibility.PUBLIC)
    //                     .whereExists('participants', (participants) => {
    //                       return participants.where('userId', this.ctx.userID);
    //                     });
    //                 });
    //               })
    //             )
    //           );
    //         });
    //       });
    //     });
    //   });
    // });
  }
}
