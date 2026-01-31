import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class MessageAttachmentsACL extends BaseQueryACL<'message_attachments'> {
  constructor(ctx: Context) {
    super(ctx, 'message_attachments');
  }

  canSelect<TReturn>(query: Query<'message_attachments', Schema, TReturn>): Query<'message_attachments', Schema, TReturn> {
    return query;
  }
}
