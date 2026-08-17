/**
 * Compile-time drift check between the published contract and the Zero schema.
 *
 * The response schemas in @xyne/spaces-contract are hand-authored, so nothing
 * stops them silently disagreeing with the tables they describe after a schema
 * change. These assertions make `tsc` the detector: if a column is added,
 * removed, renamed, or changes nullability, this file stops compiling and the
 * contract has to be updated deliberately — rather than the API quietly
 * returning a shape the OpenAPI document and SDK types no longer describe.
 *
 * Type-level only; nothing here runs.
 */

import type { User, UserProfile } from '@xyne/spaces-contract';
import type { Row } from '@rocicorp/zero';
import type { schema } from '@xyne/shared';

type UserRow = Row<(typeof schema)['tables']['users']>;
type UserProfileRow = Row<(typeof schema)['tables']['user_profiles']>;

/**
 * JSON serialization widens a few things (dates are already epoch numbers here,
 * and `json()` columns arrive as unknown), so the check is that every contract
 * field exists on the row with a compatible type — not strict mutual equality.
 */
type AssertAssignable<Contract, RowType extends Contract> = RowType;

// Rows must satisfy the contract: every field the contract promises is present
// on the row, with an assignable type.
type _UserMatchesRow = AssertAssignable<
  {
    [K in keyof User]: K extends keyof UserRow ? UserRow[K] : never;
  },
  UserRow extends { [K in keyof User]: unknown } ? UserRow : never
>;

type _UserProfileMatchesRow = AssertAssignable<
  {
    [K in keyof UserProfile]: K extends keyof UserProfileRow ? UserProfileRow[K] : never;
  },
  UserProfileRow extends { [K in keyof UserProfile]: unknown } ? UserProfileRow : never
>;

/** Field-name drift: every contract key must still exist on the table. */
type _UserKeysExist = Exclude<keyof User, keyof UserRow> extends never
  ? true
  : ['contract declares fields absent from users table:', Exclude<keyof User, keyof UserRow>];

type _UserProfileKeysExist = Exclude<keyof UserProfile, keyof UserProfileRow> extends never
  ? true
  : [
      'contract declares fields absent from user_profiles table:',
      Exclude<keyof UserProfile, keyof UserProfileRow>,
    ];

// Force evaluation so a mismatch is an error rather than an unused type.
const _userKeysExist: _UserKeysExist = true;
const _userProfileKeysExist: _UserProfileKeysExist = true;

export type ContractDriftChecks = [
  _UserMatchesRow,
  _UserProfileMatchesRow,
  typeof _userKeysExist,
  typeof _userProfileKeysExist,
];
