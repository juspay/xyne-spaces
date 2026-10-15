import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

/**
 * The icon's branch logic is the whole point of the component — it is what let
 * the thread header and the conversation header show different identities.
 * Avatar and the lucide glyphs are stubbed so the assertions are about which
 * branch ran, not about how those render.
 *
 * The stub is a `mock`-prefixed helper rather than a `require` inside each
 * factory: jest's hoisting allows that prefix, and the factories only call it
 * at render time, by which point the module body has run.
 */
const mockGlyph = (label: string): React.ReactElement => <Text>{label}</Text>;

// uniwind ships ESM that jest-expo does not transform, and the only thing this
// component takes from it is the foreground colour for the glyph stroke.
jest.mock('uniwind', () => ({
  useCSSVariable: () => '#000000',
}));

jest.mock('@/src/components/ui/avatar', () => ({
  __esModule: true,
  default: ({ userIds }: { userIds: string[] }) => mockGlyph(`avatar:${userIds.join(',')}`),
}));

jest.mock('lucide-react-native', () => ({
  Hash: () => mockGlyph('hash-icon'),
  Lock: () => mockGlyph('lock-icon'),
}));

import { ConversationHeaderIcon } from '@/src/components/chat/conversation-header-icon';

const baseProps = {
  isDM: false,
  isChannel: false,
  isPrivateChannel: false,
  dmProfileUserId: null,
  isOnline: false,
};

describe('ConversationHeaderIcon', () => {
  it('renders the other participant avatar for a DM', () => {
    render(<ConversationHeaderIcon {...baseProps} isDM dmProfileUserId='user-1' />);
    expect(screen.getByText('avatar:user-1')).toBeTruthy();
    expect(screen.queryByText('hash-icon')).toBeNull();
    expect(screen.queryByText('lock-icon')).toBeNull();
  });

  it('renders an empty avatar when the DM counterpart is unresolved', () => {
    render(<ConversationHeaderIcon {...baseProps} isDM dmProfileUserId={null} />);
    expect(screen.getByText('avatar:')).toBeTruthy();
  });

  it('renders a lock for a private channel', () => {
    render(<ConversationHeaderIcon {...baseProps} isChannel isPrivateChannel />);
    expect(screen.getByText('lock-icon')).toBeTruthy();
    expect(screen.queryByText('hash-icon')).toBeNull();
  });

  it('renders a hash for a public channel', () => {
    render(<ConversationHeaderIcon {...baseProps} isChannel />);
    expect(screen.getByText('hash-icon')).toBeTruthy();
    expect(screen.queryByText('lock-icon')).toBeNull();
  });

  it('renders a hash as the fallback when the channel is not resolved yet', () => {
    render(<ConversationHeaderIcon {...baseProps} />);
    expect(screen.getByText('hash-icon')).toBeTruthy();
  });

  it('prefers the DM avatar over the channel glyphs', () => {
    render(
      <ConversationHeaderIcon
        {...baseProps}
        isDM
        isChannel
        isPrivateChannel
        dmProfileUserId='user-2'
      />,
    );
    expect(screen.getByText('avatar:user-2')).toBeTruthy();
    expect(screen.queryByText('lock-icon')).toBeNull();
  });
});
