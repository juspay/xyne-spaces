import { useSelector } from "@xstate/react";
import { useMemo } from "react";
import { stateMachineActor } from "../machines/stateMachine.js";
import type { User } from "../machines/stateMachine.js";
import { useSharedAuthContext } from "./context.js";
import {
  searchUsers as _searchUsers,
  searchUsersWithScores as _searchUsersWithScores,
} from "../utils/search.js";
import { UserStatus } from "../zero/schema.js";
import { WorkspaceRole } from "../zero/types.js";
import { queries } from "../zero/queries.js";
import { useQuery } from "./useQuery.js";

export { type User } from "../machines/stateMachine.js";

export function searchUsers(users: User[], query: string, limit = 10): User[] {
  return _searchUsers(users, query, limit);
}

export function searchUsersWithScores(
  users: User[],
  query: string,
  limit = 10,
): { item: User; score: number }[] {
  return _searchUsersWithScores(users, query, limit);
}

// Shared users-by-id Map, rebuilt only when users array reference changes.
let _usersMapRef: User[] | null = null;
let _usersMap = new Map<string, User>();

// Force the users map to rebuild on next access. Call this after clearing the
// underlying users array (e.g. on workspace switch) so the cached Map doesn't
// keep old entries alive while the state-machine context is empty.
export function invalidateUsersMapCache(): void {
  _usersMapRef = null;
  _usersMap = new Map();
}

// Community members must not see other users' emails. Emails are blanked (not removed) so
// `user.email` stays a string and existing `email && …` / `name || email` checks just skip it.
let _maskedSrc: User[] | null = null;
let _maskedSelfId: string | null = null;
let _masked: User[] = [];

function maskUserEmail(user: User, selfId: string): User {
  return user.id === selfId || !user.email ? user : { ...user, email: "" };
}

function maskEmails(users: User[], selfId: string | null): User[] {
  if (selfId === null) return users;
  if (_maskedSrc !== users || _maskedSelfId !== selfId) {
    _maskedSrc = users;
    _maskedSelfId = selfId;
    _masked = users.map((u) => maskUserEmail(u, selfId));
  }
  return _masked;
}

/** Viewer's id when emails of other users must be hidden, otherwise null. */
const useEmailMaskSelfId = (): string | null => {
  const { userID, role } = useSharedAuthContext();
  return role === WorkspaceRole.COMMUNITY_MEMBER ? userID : null;
};

function getUsersMap(users: User[]): Map<string, User> {
  if (_usersMapRef !== users) {
    _usersMapRef = users;
    _usersMap = new Map(users.map((u) => [u.id, u]));
  }
  return _usersMap;
}

export const useUsers = (): User[] => {
  const maskSelfId = useEmailMaskSelfId();
  const users = useSelector(stateMachineActor, (state) => state.context.users);
  return useMemo(() => maskEmails(users, maskSelfId), [users, maskSelfId]);
};

/**
 * Returns a stable id -> User Map for the whole workspace. Backed by the same
 * reference-keyed `getUsersMap` cache as `useUser`, so it is built once per
 * users-array reference and reused across all callers. Use this instead of
 * `useUsers().filter(...)` when you need to look participants up by id — an O(1)
 * Map lookup per id instead of an O(users) scan per lookup.
 */
export const useUsersById = (): Map<string, User> => {
  const maskSelfId = useEmailMaskSelfId();
  return useSelector(stateMachineActor, (state) =>
    getUsersMap(maskEmails(state.context.users, maskSelfId)),
  );
};

export interface UserLookup {
  user: User | undefined;
  /**
   * True while the user is absent from the workspace users set and the
   * `getUserById` fallback has not completed yet. Callers that render an
   * "Unknown user" label should wait for this to be false.
   */
  isResolving: boolean;
}

/**
 * Resolves a user by id. Reads from the shared workspace users set first (O(1)
 * Map lookup); only when the id is missing from a hydrated set does it fall
 * back to a `getUserById` Zero query. `user` is undefined after resolution
 * only when the backend has no visible user with that id.
 */
export const useUserLookup = (userId: string): UserLookup => {
  // O(1) Map lookup inside selector. Re-renders only when this specific user
  // object changes (=== check on the returned User object, not the entire array).
  const maskSelfId = useEmailMaskSelfId();
  const cachedUser = useSelector(stateMachineActor, (state) =>
    getUsersMap(maskEmails(state.context.users, maskSelfId)).get(userId),
  );
  // Before the users set is hydrated every id is "missing"; firing a point
  // query per rendered avatar then would flood Zero on initial load.
  const usersHydrated = useSelector(
    stateMachineActor,
    (state) => state.context.users.length > 0,
  );

  const needsFallback = !!userId && !cachedUser && usersHydrated;

  const [fallbackUser, fallbackDetails] = useQuery(
    queries.getUserById({ userId }),
    { enabled: needsFallback },
  );

  const maskedFallbackUser = useMemo(
    () =>
      fallbackUser && maskSelfId !== null
        ? maskUserEmail(fallbackUser as User, maskSelfId)
        : (fallbackUser as User | undefined),
    [fallbackUser, maskSelfId],
  );

  if (cachedUser) return { user: cachedUser, isResolving: false };
  if (!needsFallback) return { user: undefined, isResolving: !!userId && !usersHydrated };
  return {
    user: maskedFallbackUser ?? undefined,
    isResolving: !fallbackUser && fallbackDetails.type !== "complete",
  };
};

export const useUser = (userId: string): User | undefined => {
  return useUserLookup(userId).user;
};

export const useSelf = (): User | undefined => {
  const context = useSharedAuthContext();
  const me = useUser(context.userID);
  return me;
};

export const useUserSearch = (query: string, limit: number): User[] => {
  const users = useUsers();
  return useMemo(() => searchUsers(users, query, limit), [users, query, limit]);
};

/**
 * Returns only active users (status === ACTIVE)
 * Use this for assignment dropdowns, participant selection, etc.
 */
export const useActiveUsers = (): User[] => {
  const users = useUsers();
  return useMemo(
    () => users.filter((u) => u.status === UserStatus.ACTIVE),
    [users],
  );
};

/**
 * Search only active users
 * Use this for assignment dropdowns where deactivated users should not appear
 */
export const useActiveUserSearch = (query: string, limit: number): User[] => {
  const users = useActiveUsers();
  return useMemo(() => searchUsers(users, query, limit), [users, query, limit]);
};
