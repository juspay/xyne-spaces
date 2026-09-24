import { Hashtag, Lock02Close, UserDefault, UserTwo } from '@xyne/icons';
import { ChannelScopeType, ChannelVisibility } from '@xyne/shared';
import type { ReactElement } from 'react';
import { useChannel } from '../../../../hooks/useChannels';
import { surfaceFor } from '../Surfaces/Surfaces';
import type { ColumnSource } from '../Streams/Streams.types';

/**
 * A channel's own glyph: hash, lock, one person or two.
 *
 * Split out from the column so the `useChannel` subscription sits somewhere it
 * can be called unconditionally. `ColumnIcon` below has an early return for
 * non-channel sources, and a hook cannot live behind one.
 *
 * The hash is the answer for a channel that has not resolved yet as well as for
 * a public one, which matches `ChannelIcon` elsewhere in the app: a lock that
 * appears a beat late reads as the channel having changed, and is worse than a
 * hash that never changes at all.
 */
const ChannelGlyph = ({
  channelId,
  className,
}: {
  channelId: string;
  className?: string | undefined;
}): ReactElement => {
  const channel = useChannel(channelId);
  if (channel === undefined) return <Hashtag className={className} aria-hidden />;
  // One person for a DM, two for a group: the glyph says how many people are
  // on the other end, which is the thing that tells the two kinds apart at a
  // glance when their titles are both just names.
  if (channel.scopeType === ChannelScopeType.DM) {
    return <UserDefault className={className} aria-hidden />;
  }
  if (channel.scopeType === ChannelScopeType.GROUP_DM) {
    return <UserTwo className={className} aria-hidden />;
  }
  return channel.visibility === ChannelVisibility.PRIVATE ? (
    <Lock02Close className={className} aria-hidden />
  ) : (
    <Hashtag className={className} aria-hidden />
  );
};

/**
 * The glyph in front of a column's name, in its header and in the top nav.
 *
 * A channel column cannot take this from the surface registry. That registry is
 * keyed by `SurfaceKind`, and every channel — public, private, DM — is the same
 * kind, so `SURFACES.channel.icon` can only ever be one glyph, and it was the
 * hash for all three. What the glyph has to say is a property of the channel
 * row rather than of the surface, and the channel row is a Zero query. Which is
 * the same reason `Title` in that registry is a component and not a string.
 *
 * `Lock02Close` from `@xyne/icons` rather than the `ChatLock` SVG the channel
 * header uses: `ChatLock` takes a `color` and no `className`, so it cannot be
 * held to the 14px the two column glyphs are drawn at, and would sit 2px
 * taller than the hashes beside it.
 */
const ColumnIcon = ({
  source,
  className = '',
}: {
  source: ColumnSource;
  className?: string | undefined;
}): ReactElement => {
  if (source.kind === 'channel') {
    return <ChannelGlyph channelId={source.channelId} className={className} />;
  }
  const { icon: Icon } = surfaceFor(source);
  return <Icon className={className} aria-hidden />;
};

export default ColumnIcon;
