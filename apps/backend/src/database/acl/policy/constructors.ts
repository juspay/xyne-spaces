import { PrismaClient } from '@prisma/client'
import type { ACLContext, BaseQueryACL } from '../base-acl'
import {
  AdminWriteACL,
  CustomACL,
  EntityACL,
  MemberACL,
  OrgACL,
  PlatformACL,
  SecretACL,
  SelfACL,
  SystemWriteACL,
  type AdminWriteOptions,
  type EntityOptions,
  type MemberOptions,
  type OrgOptions,
  type SecretOptions,
  type SelfOptions,
  type SystemWriteOptions,
} from './classes'
import type { ParentRule } from './parents'
import type { PolicyOptions } from './policy-acl'

/** Builds a table's ACL for one operation. One per entry in the policy map. */
export type PolicyFactory = (ctx: ACLContext, prisma: PrismaClient) => BaseQueryACL

/**
 * Short constructors so each policy-map line reads as the rule itself:
 *   DraftMessage: self('userId', { guest: 'write' })
 *   Role:         admin({ resource: 'ROLES' })
 *   Message:      entity(conversationParent, { creator: 'senderId', creatorOnlyWrites: true, guest: 'write' })
 */
export const self = (owner: string, o: Omit<SelfOptions, 'owner'> = {}): PolicyFactory =>
  (c, p) => new SelfACL(c, p, { owner, ...o })

export const secret = (o: SecretOptions = {}): PolicyFactory => (c, p) => new SecretACL(c, p, o)

export const admin = (o: AdminWriteOptions = {}): PolicyFactory => (c, p) => new AdminWriteACL(c, p, o)

export const org = (o: OrgOptions = {}): PolicyFactory => (c, p) => new OrgACL(c, p, o)

export const member = (o: MemberOptions = {}): PolicyFactory => (c, p) => new MemberACL(c, p, o)

export const entity = (parent: ParentRule, o: Omit<EntityOptions, 'parent'> = {}): PolicyFactory =>
  (c, p) => new EntityACL(c, p, { parent, ...o })

export const system = (o: SystemWriteOptions = {}): PolicyFactory => (c, p) => new SystemWriteACL(c, p, o)

export const platform = (o: PolicyOptions = {}): PolicyFactory => (c, p) => new PlatformACL(c, p, o)

/**
 * A table whose existing hand-written rule is kept (see CustomACL). It still runs inside
 * PolicyACL, so guests are denied unless `guest` says otherwise.
 */
export const custom =
  (Cls: new (ctx: ACLContext, prisma: PrismaClient) => BaseQueryACL, o: PolicyOptions = {}): PolicyFactory =>
  (c, p) => new CustomACL(c, p, Cls, o)
