/**
 * Resolves ids to the names the rest of Spaces shows, for artifact apps.
 *
 * Apps used to resolve names themselves: declare a `user` data requirement, then
 * join on it in generated code. That failed three ways at once —
 *
 *   1. `displayName` is null for most real users, so the obvious `u.displayName`
 *      renders blank. The app-wide rule is `displayName || name || email`.
 *   2. A DM channel's `name` column is NOT a name. It is the participant ids,
 *      comma-separated and sorted ("id1,id2"), so rendering `channel.name` for a
 *      DM prints raw cuids.
 *   3. It burned one of the eight dataRequirement slots, and re-fetched the whole
 *      user table on every open, for data the dashboard already holds in memory.
 *
 * So the host resolves instead, calling the SAME functions every other surface
 * calls — `getUserDisplayName` and `getDMNames`, the latter documented in-tree as
 * the canonical DM resolver — and pushes finished strings into the app. Generated
 * code cannot get this wrong because it never does it.
 *
 * Everything here reads the XState store IMPERATIVELY via `getSnapshot()`. It
 * must never use `useSelector`: this runs inside the memoized Sandpack child, and
 * a re-render there tears down the iframe and forces a full re-bundle.
 */

import { stateMachineActor } from '../../../machines/stateMachine';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { getDMNames, isDMChannel } from '../../Chat/ChatDirectory/ChatDirectory.utils';
import type { ArtifactDirectory } from './artifactData.constants';

/**
 * Names shown before the roll-up kicks in. Matches AddDmForm / ComposeDmPanel,
 * which are what a user sees when composing the same conversation.
 */
const MAX_DM_NAMES_SHOWN = 3;

/**
 * Collapse a DM's participant names into ONE string, the way the compose surfaces
 * do: up to three names joined, otherwise the first two plus a count. Apps get a
 * single string rather than the array `getDMNames` returns, so every app renders
 * a group DM identically instead of inventing its own truncation.
 */
function joinDmNames(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length <= MAX_DM_NAMES_SHOWN) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} + ${names.length - 2} others`;
}

/**
 * Snapshot every id → name the viewer can see.
 *
 * Reads the same store `InitialStateLoader` populates, so this costs no network
 * call at all: the users and channels are already resident, hydrated from
 * IndexedDB and kept current by Zero deltas.
 */
export function buildArtifactDirectory(currentUserId: string): ArtifactDirectory {
  const { context } = stateMachineActor.getSnapshot();

  const users: Record<string, string> = {};
  const usersById = new Map<string, { name: string; displayName?: string | null }>();

  for (const user of context.users ?? []) {
    if (!user?.id) continue;
    usersById.set(user.id, { name: user.name ?? '', displayName: user.displayName });
    users[user.id] = getUserDisplayName(user);
  }

  const channels: Record<string, string> = {};
  for (const channel of context.allChannels ?? []) {
    if (!channel?.id) continue;
    if (!isDMChannel(channel.scopeType)) {
      channels[channel.id] = channel.name ?? '';
      continue;
    }
    // DMs and group DMs: the ids live in `name`, so this must go through the
    // canonical resolver — it also handles the self-DM "You" case.
    const { display } = getDMNames(channel, currentUserId, usersById);
    channels[channel.id] = joinDmNames(display);
  }

  return { users, channels };
}

/**
 * Cheap identity check so the bridge only re-posts when something actually
 * changed. The store replaces these arrays wholesale on update, so comparing
 * references is enough and avoids rebuilding the directory on every store event.
 */
export function directorySourceRefs(): { users: unknown; channels: unknown } {
  const { context } = stateMachineActor.getSnapshot();
  return { users: context.users, channels: context.allChannels };
}
