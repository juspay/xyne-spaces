import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ChannelVisibility } from '@xyne/shared';

import {
  ChannelMentionRenderer,
  GroupMentionRenderer,
  MentionRenderer,
} from '../Chat/RenderMessageWithHTML/RenderMessageWithHTML';
import { useAllChannels } from '../../hooks/useChannels';
import { useUserGroups } from '../../hooks/useUserGroup';
import { getUserDisplayName } from '../../utils/userDisplayName';

type UserLite = {
  id: string;
  name?: string;
  displayName?: string | null;
  email?: string;
};

type GroupLite = {
  id: string;
  name: string;
  alias?: string | null;
};

type ChannelLite = {
  id: string;
  name: string;
  visibility?: ChannelVisibility | null;
};

export type CanvasCommentMentionType = 'user' | 'group' | 'channel';

export interface CanvasCommentMentionRef {
  type: CanvasCommentMentionType;
  id: string;
}

export interface CanvasMentionNotificationResponse {
  success?: boolean;
  notified?: number;
  skipped?: {
    mentionType: CanvasCommentMentionType;
    mentionId: string;
    reason: string;
  }[];
}

export const serializeCanvasCommentMentionRef = (mention: CanvasCommentMentionRef): string =>
  mention.type === 'user' ? mention.id : `${mention.type}:${mention.id}`;

export const parseCanvasCommentMentionRef = (value: string): CanvasCommentMentionRef => {
  if (value.startsWith('group:')) {
    return { type: 'group', id: value.slice('group:'.length) };
  }
  if (value.startsWith('channel:')) {
    return { type: 'channel', id: value.slice('channel:'.length) };
  }
  if (value.startsWith('user:')) {
    return { type: 'user', id: value.slice('user:'.length) };
  }
  return { type: 'user', id: value };
};

const extractAttributeValues = (
  html: string,
  spanPattern: RegExp,
  attributePattern: RegExp,
): string[] => {
  const ids = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = spanPattern.exec(html)) !== null) {
    const span = match[0];
    const attributeMatch = span.match(attributePattern);
    const id = attributeMatch?.[1];
    if (id) ids.add(id);
  }

  return [...ids];
};

export const extractCanvasCommentMentionRefsFromHtml = (
  html: string,
  fallbackMentionIds: string[] = [],
): string[] => {
  const refs = new Set<string>();

  fallbackMentionIds.forEach(id => refs.add(id));

  extractAttributeValues(
    html,
    /<span[^>]*data-mention-type=["']user["'][^>]*>/g,
    /data-user-id=["']([^"']+)["']/,
  ).forEach(id => refs.add(serializeCanvasCommentMentionRef({ type: 'user', id })));

  extractAttributeValues(
    html,
    /<span[^>]*data-mention-type=["']group["'][^>]*>/g,
    /data-group-id=["']([^"']+)["']/,
  ).forEach(id => refs.add(serializeCanvasCommentMentionRef({ type: 'group', id })));

  extractAttributeValues(
    html,
    /<span[^>]*data-channel-mention[^>]*>/g,
    /data-channel-id=["']([^"']+)["']/,
  ).forEach(id => refs.add(serializeCanvasCommentMentionRef({ type: 'channel', id })));

  return [...refs];
};

export const parseCanvasCommentMentionRefs = (mentionedUserIds?: string | null): string[] => {
  if (!mentionedUserIds) return [];
  try {
    const parsed: unknown = JSON.parse(mentionedUserIds);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

export const getCanvasMentionNoAccessUserIds = (
  response?: CanvasMentionNotificationResponse,
  fallbackMention?: CanvasCommentMentionRef,
): string[] => {
  const skippedUserIds =
    response?.skipped
      ?.filter(skip => skip.mentionType === 'user' && skip.reason === 'NO_CANVAS_ACCESS')
      .map(skip => skip.mentionId) ?? [];

  if (skippedUserIds.length > 0) return skippedUserIds;
  if (fallbackMention?.type === 'user' && response?.notified === 0) return [fallbackMention.id];

  return [];
};

export const isCanvasCommentMentionRefRetained = (
  mentionRef: string,
  body: string,
  users: UserLite[],
  groups: GroupLite[],
  channels: ChannelLite[],
): boolean => {
  const ref = parseCanvasCommentMentionRef(mentionRef);

  if (ref.type === 'user') {
    const user = users.find(candidate => candidate.id === ref.id);
    const displayName = user ? getUserDisplayName(user) : '';
    return displayName ? body.includes(`@${displayName}`) : true;
  }

  if (ref.type === 'group') {
    const group = groups.find(candidate => candidate.id === ref.id);
    if (!group) return true;
    return [group.alias, group.name].some(name => Boolean(name) && body.includes(`@${name}`));
  }

  const channel = channels.find(candidate => candidate.id === ref.id);
  if (!channel) return true;
  return body.includes(`#${channel.name}`) || body.includes(`🔒${channel.name}`);
};

interface MentionTarget {
  ref: CanvasCommentMentionRef;
  token: string;
  node: React.ReactNode;
}

function CanvasCommentGroupMention({ groupId }: { groupId: string }): React.JSX.Element {
  const groups = useUserGroups();
  const group = groups.find(candidate => candidate.id === groupId);
  const groupName = group?.name ?? groupId;
  const alias = group?.alias ?? groupName;
  return <GroupMentionRenderer groupId={groupId} groupName={groupName} alias={alias} />;
}

function CanvasCommentChannelMention({ channelId }: { channelId: string }): React.JSX.Element {
  const navigate = useNavigate();
  const channels = useAllChannels();
  const channel = channels.find(candidate => candidate.id === channelId);
  return (
    <ChannelMentionRenderer
      channelId={channelId}
      channelName={channel?.name ?? channelId}
      isPrivate={channel?.visibility === ChannelVisibility.PRIVATE}
      navigate={navigate}
    />
  );
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function CanvasCommentBody({
  body,
  mentionIds,
  users,
}: {
  body: string;
  mentionIds: string[];
  users: UserLite[];
}): React.JSX.Element {
  const groups = useUserGroups();
  const channels = useAllChannels();

  if (mentionIds.length === 0 || !body) return <>{body}</>;

  const targets = mentionIds.flatMap((value): MentionTarget[] => {
    const ref = parseCanvasCommentMentionRef(value);

    if (ref.type === 'user') {
      const user = users.find(candidate => candidate.id === ref.id);
      const displayName = user ? getUserDisplayName(user) : '';
      return displayName
        ? [
            {
              ref,
              token: `@${displayName}`,
              node: <MentionRenderer userId={ref.id} fallbackName={displayName} />,
            },
          ]
        : [];
    }

    if (ref.type === 'group') {
      const group = groups.find(candidate => candidate.id === ref.id);
      const groupName = group?.name ?? ref.id;
      const alias = group?.alias ?? groupName;
      const tokens = new Set([`@${alias}`, `@${groupName}`]);
      return [...tokens].map(token => ({
        ref,
        token,
        node: <CanvasCommentGroupMention groupId={ref.id} />,
      }));
    }

    const channel = channels.find(candidate => candidate.id === ref.id);
    const channelName = channel?.name ?? ref.id;
    return [`#${channelName}`, `🔒${channelName}`].map(token => ({
      ref,
      token,
      node: <CanvasCommentChannelMention channelId={ref.id} />,
    }));
  });

  if (targets.length === 0) return <>{body}</>;

  const tokenToTarget = new Map<string, MentionTarget>();
  targets.forEach(target => tokenToTarget.set(target.token, target));
  const tokenPattern = [...tokenToTarget.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');

  if (!tokenPattern) return <>{body}</>;

  const tokenRegex = new RegExp(`(${tokenPattern})`, 'g');
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(body)) !== null) {
    const token = match[0];
    const target = tokenToTarget.get(token);
    if (!target) continue;
    const start = match.index;
    if (start > lastIndex) nodes.push(body.slice(lastIndex, start));
    nodes.push(
      <React.Fragment key={`${target.ref.type}-${target.ref.id}-${start}`}>
        {target.node}
      </React.Fragment>,
    );
    lastIndex = start + token.length;
  }

  if (lastIndex < body.length) nodes.push(body.slice(lastIndex));
  return <>{nodes.length > 0 ? nodes : body}</>;
}
