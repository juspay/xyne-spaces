import { z } from 'zod';

// ─── Xyne Apps users, user groups and guests (/apps/user, /apps/usergroups, /apps/guests) ──
// Bot token. Profile data and ids only: nothing encrypted. Body and query rules are the
// controllers' own (UserController, UserGroupController, GuestController), moved here.
// Responses are the shared helpers' results (getUserData, getAllUserGroups, guestUtils).

export const dateish = z.union([z.date(), z.string()]);

export const email = z.string().trim().email().max(254);