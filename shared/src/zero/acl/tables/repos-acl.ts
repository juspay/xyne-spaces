import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class ReposACL extends BaseQueryACL<'repos'> {
    constructor(ctx: Context) {
        super(ctx, 'repos');
    }

    canSelect<TReturn>(query: Query<'repos', Schema, TReturn>): Query<'repos', Schema, TReturn> {
        // All users can see all repos
        return query;
    }
}
