import { memo, type ReactElement } from 'react';

import { UnreadCountBadge } from '@/src/components/ui/unread-count-badge';

type ChannelListUnreadBadgeProps = {
  count: number;
};

/** Channel-list spelling of the shared badge. Kept as a named component because
 *  it is rendered directly by tests and by the channel row. */
export const ChannelListUnreadBadge = memo(function ChannelListUnreadBadge({
  count,
}: ChannelListUnreadBadgeProps): ReactElement {
  return <UnreadCountBadge count={count} size='sm' />;
});
