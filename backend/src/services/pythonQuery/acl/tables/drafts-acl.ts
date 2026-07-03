import { Prisma } from '@prisma/client'
import { BaseQueryACL } from '../base-acl'

/**
 * ACL for chat-message drafts. A draft is private to the person writing it, so a
 * user only ever sees THEIR OWN drafts (DraftMessage.userId).
 */
export class DraftMessagesACL extends BaseQueryACL<Prisma.DraftMessageWhereInput> {
  async getWhereClause(): Promise<Prisma.DraftMessageWhereInput> {
    // Fail closed: a missing userId must never collapse to an unscoped (match-all)
    // filter — that would expose every user's private drafts.
    if (!this.ctx.userId) throw new Error('DraftMessagesACL: userId is required')
    return { userId: this.ctx.userId }
  }
}

/**
 * ACL for scheduled messages. Scoped to the creator (ScheduledMessage.createdBy)
 * — the "Scheduled messages" view is the user's own upcoming/recurring sends.
 */
export class ScheduledMessagesACL extends BaseQueryACL<Prisma.ScheduledMessageWhereInput> {
  async getWhereClause(): Promise<Prisma.ScheduledMessageWhereInput> {
    if (!this.ctx.userId) throw new Error('ScheduledMessagesACL: userId is required')
    return { createdBy: this.ctx.userId }
  }
}

/**
 * ACL for Desk email-reply drafts. Scoped to the owner (EmailDraft.userId).
 * EmailDraft.userId is nullable — auto-generated drafts with no owner are
 * excluded, which is the correct behaviour for a personal "my drafts" view.
 */
export class EmailDraftsACL extends BaseQueryACL<Prisma.EmailDraftWhereInput> {
  async getWhereClause(): Promise<Prisma.EmailDraftWhereInput> {
    // EmailDraft.userId is nullable; guarding here also stops a null/empty ctx
    // userId from producing an unscoped filter.
    if (!this.ctx.userId) throw new Error('EmailDraftsACL: userId is required')
    return { userId: this.ctx.userId }
  }
}
