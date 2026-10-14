import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';

import { ChannelListUnreadBadge } from '@/src/components/chat/channel-list/channel-list-unread-badge';

describe('ChannelListUnreadBadge', () => {
  it('renders the exact unread count', () => {
    render(<ChannelListUnreadBadge count={5} />);

    expect(screen.getByText('5')).toBeTruthy();
  });

  it('caps counts above 99 as "99+"', () => {
    render(<ChannelListUnreadBadge count={128} />);

    expect(screen.getByText('99+')).toBeTruthy();
    expect(screen.queryByText('128')).toBeNull();
  });

  it('renders a zero count as "0"', () => {
    render(<ChannelListUnreadBadge count={0} />);

    expect(screen.getByText('0')).toBeTruthy();
  });
});
