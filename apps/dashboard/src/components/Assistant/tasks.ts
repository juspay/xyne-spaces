import {
  ChannelAddUserPolicy,
  ChannelRole,
  ChannelScopeType,
  MessageType,
  OrgRole,
  WorkspaceRole,
  type Channel,
} from '@xyne/shared';
import type { User, UserGroup } from '@xyne/shared/machines';
import { sendMessage, type ConversationRef } from '@xyne/shared/messages';
import { v4 as uuidv4 } from 'uuid';
import { queries } from '../../zero/queries';
import { mutators } from '../../zero/mutators';
import { resolveOrCreateDmChannelId } from '../../utils/searchNavigation';
import { channelService } from '../../services/Chat/channelService';
import {
  isInvitationRevocable,
  isLastAdmin,
  isWorkspaceAdmin,
} from '../../routes/WorkspaceManagementScreen/workspaceRules';
import { userToMentionResult } from '../../utils/userDisplayName';
import { escapeHtml, processMessageForSending } from '../Chat/ChatInput/ChatInput.utils';
import { hasValue, type FieldValue } from './actions/action';
import type { Resolved } from './engine/resolve';

/**
 * What an action does in code when there is no page to do it on: a plan step of `perform`. A task
 * runs once the request is confirmed, and fails with a message that is fit to tell the user.
 */
export type ZeroClient = Parameters<typeof sendMessage>[0];

export interface TaskEnv {
  zero: ZeroClient;
  selfId: string;
  people: readonly User[];
  channels: readonly Channel[]; // all the user is in, DMs included
  joined: ReadonlySet<string>; // the channels the user is a participant of
  userGroups: readonly UserGroup[];
  navigate: (path: string) => void;
}

export interface TaskInput {
  values: Record<string, FieldValue>;
  resolved: Record<string, Resolved>;
  env: TaskEnv;
}

const chatPath = (channelId: string, conversationId?: string): string =>
  `/chat/dir/${channelId}${conversationId ? `/${conversationId}` : ''}`;

// Everyone a pick stands for: the people of a group, or the one person.
const everyoneIn = (pick: Resolved): Resolved[] => pick.group ?? [pick];

// The DM with a person, found or made; with several, their group DM, as the New message screen
// makes it: the server hands back the one these people already have, which is reopened.
async function dmWith(pick: Resolved, { channels, selfId, zero }: TaskEnv): Promise<string> {
  if (!pick.group) return resolveOrCreateDmChannelId(pick.id, [...channels], selfId);
  const { id, isExisting } = await channelService.createDm({
    participantIds: pick.group.map(({ id: userId }) => userId),
  });
  if (isExisting) zero.mutate(mutators.channel.reopenDm({ channelId: id, updatedAt: Date.now() }));
  return id;
}

// A channel, or one of its threads, is as it is; a person is the DM with them.
// A channel named alongside a person wins: the person is then only who is mentioned.
async function targetOf({
  resolved: { channel, person },
  env,
}: TaskInput): Promise<ConversationRef> {
  if (channel) {
    return channel.thread
      ? { kind: 'thread', channelId: channel.id, conversationId: channel.thread }
      : { kind: 'channel', channelId: channel.id };
  }
  if (!person) throw new Error("I don't know who to send it to.");
  return { kind: 'channel', channelId: await dmWith(person, env) };
}

// The server refuses these too, but only after the message was shown as sent.
function checkCanPost({ channelId }: ConversationRef, { channels, joined }: TaskEnv): void {
  const channel = channels.find(({ id }) => id === channelId);
  if (channel?.isArchived) throw new Error(`#${channel.name} is archived.`);
  if (channel?.scopeType === ChannelScopeType.DEFAULT && !joined.has(channelId)) {
    throw new Error(`You need to join #${channel.name} first.`);
  }
}

// The message as the composer would send it. What the user said is text, never markup; the @Name
// becomes the mention the composer makes. A person named alongside a channel ("tell Priya in
// #design…") is posted there, so is mentioned. One who cannot be found is never left out quietly.
function contentOf({
  values: { message },
  resolved: { mention: tagged, channel, person },
  env,
}: TaskInput): string {
  const said = tagged ?? (channel ? person : undefined);
  const mentioned = env.people.find(({ id }) => id === said?.id);
  if (said && !mentioned) throw new Error(`I can't find ${said.label} to mention.`);
  const mention = mentioned ? userToMentionResult(mentioned, false) : null;
  const text = [mention && `@${mention.name}`, message?.trim()].filter(hasValue).join(' ');
  return processMessageForSending(`<p>${escapeHtml(text)}</p>`, mention ? [mention] : undefined);
}

async function sendTo(input: TaskInput): Promise<void> {
  const { env } = input;
  const target = await targetOf(input);
  checkCanPost(target, env);
  sendMessage(env.zero, target, { content: contentOf(input), type: MessageType.USER });
  // So the user sees it where it was sent.
  env.navigate(
    chatPath(target.channelId, target.kind === 'thread' ? target.conversationId : undefined),
  );
}

async function openChat({ resolved: { person }, env }: TaskInput): Promise<void> {
  if (!person) throw new Error("I don't know who to chat with.");
  env.navigate(chatPath(await dmWith(person, env)));
}

// Told of each channel people were added to, so a page's Add people form for it closes as it does
// after its own add.
const addedTo = new Set<(channelId: string) => void>();
export const onPeopleAdded = (listener: (channelId: string) => void): (() => void) => {
  addedTo.add(listener);
  return (): void => {
    addedTo.delete(listener);
  };
};

// As the channel's Add people dialog does it, and only when it would offer to: a member of the
// channel, and an admin of it when only admins may add people. A DM grows into a group with its
// history asked about, so that is left to its dialog. Those already in it are left as they are.
async function addToChannel({ resolved: { person, channel }, env }: TaskInput): Promise<string> {
  if (!person || !channel) throw new Error("I don't know who to add, or where.");
  const { zero, selfId, channels } = env;
  const target = channels.find(({ id }) => id === channel.id);
  if (target?.scopeType !== ChannelScopeType.DEFAULT) {
    throw new Error('I can only add people to a channel. Use Add people in the conversation.');
  }
  const channelId = target.id;
  const [participants, stats] = await Promise.all([
    zero.run(queries.channelParticipants({ channelId }), { type: 'complete' }),
    zero.run(queries.channelStats({ channelId }), { type: 'complete' }),
  ]);
  const me = participants.find(({ userId }) => userId === selfId);
  if (!me) throw new Error(`You need to join #${target.name} first.`);
  if (stats?.addUserPolicy === ChannelAddUserPolicy.ADMINS_ONLY && me.role !== ChannelRole.ADMIN) {
    throw new Error(`Only the admins of #${target.name} can add people to it.`);
  }
  const userIds = everyoneIn(person)
    .map(({ id }) => id)
    .filter(id => !participants.some(({ userId }) => userId === id));
  if (userIds.length === 0) {
    throw new Error(`${person.label} ${person.group ? 'are' : 'is'} already in #${target.name}.`);
  }
  // The server's answer, so a refusal is told rather than shown as done.
  const result = await zero.mutate(
    mutators.channel.addParticipants({
      channelId,
      userIds,
      timestamp: Date.now(),
      participantIds: Object.fromEntries(userIds.map(id => [id, uuidv4()])),
      userStatusIds: Object.fromEntries(userIds.map(id => [id, uuidv4()])),
    }),
  ).server;
  if (result.type === 'error') throw new Error(result.error.message);
  // The channel's Add people form, if open, is done with, and the user is shown the channel, so
  // they can see it and post there.
  addedTo.forEach(listener => listener(channelId));
  env.navigate(chatPath(channelId));
  return `Want me to post something in #${target.name}?`;
}

// The server's answer to a change: its refusal is told, never shown as done.
async function settled(change: {
  server: Promise<{ type: string; error?: { message: string } }>;
}): Promise<void> {
  const result = await change.server;
  if (result.type === 'error') throw new Error(result.error?.message ?? 'It was refused.');
}

// What a change to a member is refused with, in the words of that change.
interface MemberChange {
  permission: string; // "change roles"
  self: string; // "You can't change your own role."
  refused: string; // "their role can't be changed"
  demotes: boolean; // the member may stop being an admin
}

// A member the Members page would offer to change: by an admin, never themselves or the owner,
// and never the last admin, who can be neither demoted nor removed. The server checks again.
function memberToChange(
  { resolved: { person }, env: { selfId, people } }: TaskInput,
  change: MemberChange,
): { member: User; workspaceId: string } {
  const self = people.find(({ id }) => id === selfId);
  if (!self?.workspaceId || !isWorkspaceAdmin(self.role)) {
    throw new Error(`You don't have permission to ${change.permission}. Ask a workspace admin.`);
  }
  const member = people.find(({ id }) => id === person?.id);
  const name = person?.label ?? 'them';
  if (!member || member.workspaceId !== self.workspaceId) {
    throw new Error(`I can't find ${name} in this workspace.`);
  }
  if (member.id === selfId) throw new Error(change.self);
  if (member.role === WorkspaceRole.OWNER) {
    throw new Error(`${name} owns the workspace, so ${change.refused}.`);
  }
  if (change.demotes && isLastAdmin(member, people)) {
    throw new Error(`${name} is the last admin, so ${change.refused}.`);
  }
  return { member, workspaceId: self.workspaceId };
}

// As the Members page's Make admin and Make member do it.
async function changeMemberRole(input: TaskInput): Promise<void> {
  const role =
    input.values['role']?.trim() === 'Admin' ? WorkspaceRole.ADMIN : WorkspaceRole.MEMBER;
  const { member, workspaceId } = memberToChange(input, {
    permission: 'change roles',
    self: "You can't change your own role.",
    refused: "their role can't be changed",
    demotes: role !== WorkspaceRole.ADMIN,
  });
  if (member.role === role) {
    const already = role === WorkspaceRole.ADMIN ? 'an admin' : 'a member';
    throw new Error(`${input.resolved['person']?.label ?? 'They'} is already ${already}.`);
  }
  await settled(
    input.env.zero.mutate(
      mutators.users.updateRole({
        workspaceId,
        userId: member.id,
        updates: { role },
        timestamp: Date.now(),
      }),
    ),
  );
}

// As the Members page's Remove from workspace does it.
async function removeMember(input: TaskInput): Promise<void> {
  const { member, workspaceId } = memberToChange(input, {
    permission: 'remove people',
    self: "You can't remove yourself.",
    refused: "they can't be removed",
    demotes: true,
  });
  await settled(
    input.env.zero.mutate(
      mutators.users.remove({ workspaceId, userId: member.id, timestamp: Date.now() }),
    ),
  );
}

// "the Finance group", "finance team": a user group by its name or alias, said exactly, since a
// change to the wrong group is worse than a question.
const groupName = (words: string): string =>
  words
    .trim()
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/\s+(?:user\s+)?(?:group|team)$/, '')
    .replace(/^@/, '');

// As the User Groups page edits a group: renamed as its form saves it, and people added as its
// Members tab adds them. Taking people out asks about their open tickets, so it stays on the page.
async function updateUserGroup({
  values: { group: said, name },
  resolved: { add },
  env: { zero, userGroups },
}: TaskInput): Promise<void> {
  const wanted = groupName(said ?? '');
  const group = userGroups.find(
    candidate =>
      candidate.isActive &&
      [candidate.name, candidate.alias].some(known => known?.toLowerCase() === wanted),
  );
  if (!group) throw new Error(`I can't find a user group called ${said?.trim() ?? ''}.`);
  if (hasValue(name)) {
    await settled(
      zero.mutate(
        mutators.userGroup.update({
          userGroupId: group.id,
          name: name.trim(),
          timestamp: Date.now(),
        }),
      ),
    );
  }
  if (add) {
    const userIds = everyoneIn(add).map(({ id }) => id);
    await settled(
      zero.mutate(
        mutators.userGroup.addUsers({
          userGroupId: group.id,
          userIds,
          mappingIds: Object.fromEntries(userIds.map(id => [id, uuidv4()])),
          timestamp: Date.now(),
        }),
      ),
    );
  }
}

// As the Invitations page's Revoke does it, for an invitation it would offer to revoke.
async function revokeInvitation({ values: { email }, env }: TaskInput): Promise<void> {
  const self = env.people.find(({ id }) => id === env.selfId);
  if (!isWorkspaceAdmin(self?.role)) {
    throw new Error("You don't have permission to revoke invitations. Ask a workspace admin.");
  }
  const address = email?.trim().toLowerCase() ?? '';
  const invitations = await env.zero.run(queries.getAllInvitations({}), { type: 'complete' });
  const invitation = invitations.find(
    candidate =>
      candidate.workspaceId === self?.workspaceId &&
      candidate.email.toLowerCase() === address &&
      isInvitationRevocable(candidate),
  );
  if (!invitation) throw new Error(`There's no pending invitation for ${address}.`);
  await settled(
    env.zero.mutate(
      mutators.invitation.revoke({ invitationId: invitation.id, timestamp: Date.now() }),
    ),
  );
}

// As the organisation's Add Member by Email does it, in the organisation the user belongs to, by
// its admins, and only from a workspace of that organisation, as the page allows.
async function addToOrganisation({ values: { email }, env }: TaskInput): Promise<void> {
  const { zero, people, selfId } = env;
  const self = people.find(({ id }) => id === selfId);
  const [membership, workspace] = await Promise.all([
    self?.orgMemberId
      ? zero.run(queries.getOrgMemberById({ memberId: self.orgMemberId }), { type: 'complete' })
      : undefined,
    self?.workspaceId
      ? zero.run(queries.getWorkspaceById({ workspaceId: self.workspaceId }), {
          type: 'complete',
        })
      : undefined,
  ]);
  if (!membership) throw new Error("You aren't in an organisation, so I can't add anyone to one.");
  if (membership.role !== OrgRole.OWNER && membership.role !== OrgRole.ADMIN) {
    throw new Error("Only your organisation's admins can add people to it. Ask one of them.");
  }
  if (workspace?.orgId && workspace.orgId !== membership.orgId) {
    throw new Error("Your organisation can't be managed from this workspace.");
  }
  const address = email?.trim().toLowerCase() ?? '';
  const members = await zero.run(queries.getOrgMembers({ orgId: membership.orgId }), {
    type: 'complete',
  });
  if (members.some(member => member.email.toLowerCase() === address)) {
    throw new Error(`${address} is already in your organisation.`);
  }
  await settled(
    zero.mutate(
      mutators.orgMember.add({
        memberId: uuidv4(),
        orgId: membership.orgId,
        email: address,
        role: OrgRole.MEMBER,
        timestamp: Date.now(),
      }),
    ),
  );
}

export type TaskId =
  | 'sendMessage'
  | 'openChat'
  | 'addToChannel'
  | 'changeMemberRole'
  | 'removeMember'
  | 'revokeInvitation'
  | 'updateUserGroup'
  | 'addToOrganisation';

// A task may resolve to the next step to offer, said after the action's `done`.
export const TASKS: Record<TaskId, (input: TaskInput) => Promise<string | void>> = {
  sendMessage: sendTo,
  openChat,
  addToChannel,
  changeMemberRole,
  removeMember,
  revokeInvitation,
  updateUserGroup,
  addToOrganisation,
};
