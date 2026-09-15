import type { Query } from '@rocicorp/zero';
import { SDLC_MEMBERSHIP_RELATION } from '../../../sdlc';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { denyGuestSelect, isGuestContext } from '../core/guest-acl-utils';

export class ReposACL extends BaseQueryACL<'repos'> {
  constructor(ctx: Context) {
    super(ctx, 'repos');
  }

  canSelect<TReturn>(query: Query<'repos', Schema, TReturn>): Query<'repos', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return denyGuestSelect(query, 'id');
    }

    return query
      .where('workspaceId', '=', this.ctx.workspaceId)
      .where(({ or, and, not, exists }) =>
        or(
          // In no hub: the pool the hub picker offers, readable by the project's
          // own people. Legacy IDE repositories carry no project and stay hidden.
          and(
            not(
              exists('sdlcEntityLinks', (link) =>
                link.where('relationType', '=', SDLC_MEMBERSHIP_RELATION),
              ),
            ),
            exists('project', (project) =>
              project.whereExists('channels', (channel) =>
                channel.whereExists('participants', (participant) =>
                  participant.where('userId', '=', this.ctx.userID),
                ),
              ),
            ),
          ),
          exists('sdlcEntityLinks', (link) =>
            link
              .where('relationType', '=', SDLC_MEMBERSHIP_RELATION)
              .whereExists('channel', (channel) =>
                channel.whereExists('participants', (participant) =>
                  participant.where('userId', '=', this.ctx.userID),
                ),
              ),
          ),
        ),
      );
  }
}
