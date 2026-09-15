import { BaseACL } from '../core/base-acl';

/**
 * Guest access grants. No mutator writes this table, so all writes are denied
 * (BaseACL throws on insert/update/delete/upsert).
 */
export class GuestAccessACL extends BaseACL<'guest_access'> {}
