import { PrismaClient } from '@prisma/client'
import type { ACLContext, BaseQueryACL } from '../base-acl'
import {
  AdminWriteACL,
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
 * A table still on its hand-written ACL. Every table starts here; moving one onto its access
 * class replaces its `legacy(...)` line.
 */
export const legacy =
  (Cls: new (ctx: ACLContext, prisma: PrismaClient) => BaseQueryACL): PolicyFactory =>
  (c, p) => new Cls(c, p)
