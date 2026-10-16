import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockPush = jest.fn();
const mockCreateDm = jest.fn<() => Promise<{ id: string }>>();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/src/contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'local', user: { user_id: 'viewer' } }),
}));
jest.mock('@/src/components/ui/avatar', () => ({ __esModule: true, default: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
jest.mock('@/src/theme/useBubbleAccent', () => ({
  useBubbleAccent: () => ({ accentText: '#555' }),
}));
jest.mock('@/src/services/ChannelService', () => ({
  ChannelService: class {
    createDm = mockCreateDm;
  },
}));
jest.mock('@/src/features/feed/api', () => ({ feedError: (error: Error) => error.message }));
import { FeedAuthor } from '@/src/features/feed/FeedAuthor';

beforeEach(() => {
  mockPush.mockReset();
  mockCreateDm.mockReset();
});
function open(userId = 'author', onNavigate = jest.fn()): void {
  render(<FeedAuthor userId={userId} name='Alex' onNavigate={onNavigate} />);
  fireEvent.press(screen.getByLabelText('User actions for Alex'));
}
describe('Feed author actions', () => {
  it('opens the existing profile and closes the parent discussion', () => {
    const close = jest.fn();
    open('author', close);
    fireEvent.press(screen.getByLabelText('View profile'));
    expect(close).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/profile/author');
  });
  it('opens the DM returned for the selected author', async () => {
    mockCreateDm.mockResolvedValue({ id: 'existing-dm' });
    open();
    fireEvent.press(screen.getByLabelText('Send message'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/(protected)/chat/existing-dm'));
    expect(mockCreateDm).toHaveBeenCalledWith({ participantIds: ['author'] });
  });
  it('keeps the sheet available when creating a DM fails', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockCreateDm.mockRejectedValue(new Error('Offline'));
    open();
    fireEvent.press(screen.getByLabelText('Send message'));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith('Could not start conversation', 'Offline'),
    );
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByLabelText('View profile')).toBeTruthy();
    alert.mockRestore();
  });
  it('does not create a DM with the current user', () => {
    open('viewer');
    fireEvent.press(screen.getByLabelText('Send message'));
    expect(mockCreateDm).not.toHaveBeenCalled();
  });
});
