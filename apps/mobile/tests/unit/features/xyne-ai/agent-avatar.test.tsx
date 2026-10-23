import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';

// Only `bot-known` is in the user directory.
jest.mock('@/src/components/ui/avatar/avatar.utils', () => ({
  useUserSnapshot: (userId: string) => (userId === 'bot-known' ? { id: userId } : undefined),
}));

jest.mock('@/src/components/ui/avatar', () => {
  const React = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  return {
    __esModule: true,
    default: ({ userIds }: { userIds: readonly string[] }) =>
      React.createElement(View, { testID: `user-avatar-${userIds[0]}` }),
  };
});

import { AgentAvatar } from '@/src/features/xyne-ai/components/AgentAvatar';

describe('AgentAvatar', () => {
  it("draws the bot user's avatar when that user is in the directory", () => {
    render(<AgentAvatar identity={{ name: 'Xyne Doctor', userId: 'bot-known' }} />);
    expect(screen.getByTestId('user-avatar-bot-known')).toBeTruthy();
    expect(screen.queryByTestId('agent-avatar-letter')).toBeNull();
  });

  it('falls back to a letter tile when the bot user is not hydrated', () => {
    render(
      <AgentAvatar identity={{ name: 'Xyne Doctor', userId: 'bot-missing', color: '#123456' }} />,
    );
    expect(screen.getByTestId('agent-avatar-letter')).toBeTruthy();
    expect(screen.getByText('X')).toBeTruthy();
    expect(screen.queryByTestId('user-avatar-bot-missing')).toBeNull();
  });

  it('uses the agent colour for the tile, and the accent when it has none', () => {
    render(<AgentAvatar identity={{ name: 'Research', color: '#2563EB' }} />);
    expect(screen.getByTestId('agent-avatar-letter')).toHaveStyle({ backgroundColor: '#2563EB' });
    screen.unmount();
    render(<AgentAvatar identity={{ name: 'Ask AI' }} />);
    expect(screen.getByText('A')).toBeTruthy();
  });
});
