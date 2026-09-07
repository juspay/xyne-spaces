import type { Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class CommitsACL extends BaseQueryACL<'commits'> {
  constructor(ctx: Context) {
    super(ctx, 'commits');
  }

  // No canSelect override needed - commits are always accessed via pull_requests
  // which already have workspace filtering. The backend ACL enforces mutations.
}
