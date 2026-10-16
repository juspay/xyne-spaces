import { ChannelScopeType } from '@xyne/shared';

/** Route params that scope Xyne AI to a channel. DMs are no scope, as on the dashboard. */
export const channelScopeParams = (
  channel: { id: string; name: string; scopeType?: string | null } | undefined,
): { channelId?: string; channelName?: string } =>
  channel &&
  channel.scopeType !== ChannelScopeType.DM &&
  channel.scopeType !== ChannelScopeType.GROUP_DM
    ? { channelId: channel.id, channelName: channel.name }
    : {};
