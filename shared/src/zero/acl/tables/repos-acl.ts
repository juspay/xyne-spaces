import type { Query } from '@rocicorp/zero';
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

        // All users can see all repos
        return query;
    }
}
