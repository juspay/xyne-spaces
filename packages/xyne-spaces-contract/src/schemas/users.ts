/**
 * User and profile response contracts.
 *
 * Field names and nullability mirror the `users` and `user_profiles` tables in
 * the Zero schema exactly — no renaming layer, which is what lets the API layer
 * return catalog rows directly and lets a type-level drift check in the backend
 * (`api/v1/contract-drift.ts`) fail compilation if a column changes shape.
 *
 * Timestamps are epoch milliseconds, matching the underlying columns.
 */

import { z } from 'zod';

/**
 * `nullish` rather than `optional` throughout: SQL returns explicit NULLs for
 * absent optional columns, so both forms have to be accepted.
 */
const optionalString = z.string().nullish();
const optionalNumber = z.number().nullish();

export const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  picture: optionalString,
  authProvider: z.string(),
  providerUserId: z.string(),
  status: z.string(),
  userType: z.string(),
  metadata: z.unknown().nullish(),
  displayName: optionalString,
  workspaceId: z.string(),
  role: z.string(),
  orgMemberId: z.string(),
  leftAt: optionalNumber,
  createdAt: z.number(),
  updatedAt: z.number(),
  statusEmoji: optionalString,
  statusContent: optionalString,
  statusExpiryAt: optionalNumber,
  lastActiveAt: optionalNumber,
  notificationsPausedUntil: optionalNumber,
  assignmentUnavailableUntil: optionalNumber,
  calendarVisibility: z.string(),
});

export type User = z.infer<typeof userSchema>;

export const userProfileSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  userId: z.string(),
  dob: optionalNumber,
  phoneNumber: optionalString,
  displayName: optionalString,
  team: optionalString,
  pronunciation: optionalString,
  manager: optionalString,
  role: optionalString,
  joinedOn: optionalNumber,
  hasVoiceSignature: z.boolean().nullish(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type UserProfile = z.infer<typeof userProfileSchema>;

/** The acting principal for the current access token. */
export const meSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  displayName: z.string().nullable(),
  workspaceId: z.string(),
  memberId: z.string(),
  role: z.string(),
  orgRole: z.string(),
  scopes: z.array(z.string()),
  profile: userProfileSchema.nullable(),
});

export type Me = z.infer<typeof meSchema>;
