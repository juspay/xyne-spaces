import type { Query } from '@rocicorp/zero';
import { type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
export class PullRequestsACL extends BaseQueryACL<'pull_requests'> {
  constructor(ctx: Context) {
    super(ctx, 'pull_requests');
  }

  canSelect<TReturn>(query: Query<'pull_requests', Schema, TReturn>): Query<'pull_requests', Schema, TReturn> {
    return query;
    // return query.where(({ or, exists, cmp }) => {
    //   return or(
    //     exists('workflowExecution', (workflowExecution) => {
    //       return workflowExecution.whereExists('workflow', (workflow) => {
    //         return workflow.whereExists('ticket', (ticket) => {
    //           return ticket.whereExists('conversation', (conversation) => {
    //             return conversation.whereExists('channel', (channel) => {
    //               return channel.where(({ cmp, or, exists, and }) => {
    //                 return or(
    //                   and(
    //                     cmp('visibility', ChannelVisibility.PRIVATE),
    //                     exists('participants', (participants) => {
    //                       return participants.where('userId', this.ctx.userID);
    //                     })
    //                   ),
    //                   and(
    //                     cmp('visibility', ChannelVisibility.PUBLIC),
    //                     exists('project', (project) => {
    //                       return project.whereExists('channels', (channelQuery) => {
    //                         return channelQuery
    //                           .where('visibility', ChannelVisibility.PUBLIC)
    //                           .whereExists('participants', (participants) => {
    //                             return participants.where('userId', this.ctx.userID);
    //                           });
    //                       });
    //                     })
    //                   )
    //                 );
    //               });
    //             });
    //           });
    //         });
    //       });
    //     }),
    //     cmp('workflowExecutionId', 'IS NOT', null)
    //   );
    // });
  }
}
