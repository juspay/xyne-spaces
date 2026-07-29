import { useSelector } from '@xstate/react';
import { stateMachineActor } from '../machines/stateMachine.js';

export type { Role } from '../zero/schema.js';

/**
 * Returns the roleIds the current user holds. Loaded once by
 * InitialStateLoader via the `/auth/roles` API (union of
 * user_role_mappings and user_group_mappings.roleId) and kept
 * in the state machine. Use this for client-side checks like "is the
 * current user an approver for this stage via role membership?"
 */
export const useCurrentUserRoleIds = (): string[] => {
  return useSelector(stateMachineActor, state => state.context.currentUserRoleIds);
};
