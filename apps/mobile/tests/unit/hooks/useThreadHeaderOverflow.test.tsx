import { beforeEach, expect, it, jest } from '@jest/globals';
import { Alert } from 'react-native';
import { startAudioCall } from '@/src/utils/startAudioCall';
import { requestRecordingPermissionsAsync } from 'expo-audio';
import { sendRecordingAction } from '@/src/hooks/useRecordingStore';
import { act, renderHook } from '@testing-library/react-native';
import { useThreadHeaderOverflow } from '@/src/hooks/useThreadHeaderOverflow';

let mockPreference: { showThreadTags?: boolean } | undefined;
let mockArchived = false;
let mockScope = 'DEFAULT';
let mockCallId: string | null = null;
let mockRoomState = 'idle';
jest.mock('@xyne/shared', () => ({ ChannelScopeType: { DM: 'DM', GROUP_DM: 'GROUP_DM' } }));
jest.mock('@/src/contexts/AuthContext', () => ({
  useAuthContextValues: () => ({ userID: 'self' }),
}));
jest.mock('@/src/utils/startAudioCall', () => ({ startAudioCall: jest.fn() }));
jest.mock('@/src/hooks/useQuery', () => ({
  useQuery: (query: string) => [
    query === 'preference'
      ? mockPreference
      : query === 'conversation'
        ? { callId: mockCallId }
        : { isSubscribed: false },
    { type: 'complete' },
  ],
}));
jest.mock('@/src/zero/queries', () => ({
  queries: {
    getCurrentUserPreference: () => 'preference',
    getConversationById: () => 'conversation',
    conversationParticipantByConversationId: () => 'participant',
  },
}));
jest.mock('@/src/hooks/useZero', () => ({ useZero: () => ({ mutate: jest.fn() }) }));
jest.mock('@/src/zero/mutators', () => ({ mutators: {} }));
jest.mock('@/src/zero/awaitMutation', () => ({ awaitMutation: jest.fn() }));
jest.mock('@/src/hooks/useChannels', () => ({
  useChannel: () => ({ isArchived: mockArchived, name: 'self,peer', scopeType: mockScope }),
}));
jest.mock('@/src/hooks/useRoomMachine', () => ({
  useRoomSelector: () => null,
  useIsInCall: () => false,
}));
jest.mock('@/src/machines/roomMachine', () => ({
  roomActor: { getSnapshot: () => ({ matches: (state: string) => state === mockRoomState }) },
}));
jest.mock('@/src/hooks/useRecordingStore', () => ({
  useRecordingStore: (selector: (state: { status: string; error: null }) => unknown) =>
    selector({ status: 'idle', error: null }),
  sendRecordingAction: jest.fn(),
}));
jest.mock('@/src/stores/recordingStore', () => ({ getRecordingState: () => ({ status: 'idle' }) }));
jest.mock('@/src/utils/toast', () => ({ showMessageToast: jest.fn() }));
jest.mock('expo-audio', () => ({ requestRecordingPermissionsAsync: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

beforeEach(() => {
  mockPreference = undefined;
  mockArchived = false;
  mockScope = 'DEFAULT';
  mockCallId = null;
  mockRoomState = 'idle';
});
it('shows tags from the queried preference without app-state preference hydration', () => {
  mockPreference = { showThreadTags: true };
  const { result } = renderHook(() => useThreadHeaderOverflow('channel', 'thread', true));
  expect(result.current.actions.some(action => action.id === 'thread-tags')).toBe(true);
  act(() => result.current.handleAction('thread-tags'));
  expect(result.current.isTagsOpen).toBe(true);
});
it('defaults off and reacts to preference hydration and later opt-out', () => {
  const { result, rerender } = renderHook(() => useThreadHeaderOverflow('channel', 'thread', true));
  expect(result.current.actions.some(action => action.id === 'thread-tags')).toBe(false);
  act(() => result.current.handleAction('thread-tags'));
  expect(result.current.isTagsOpen).toBe(false);
  mockPreference = { showThreadTags: true };
  rerender({});
  expect(result.current.actions.some(action => action.id === 'thread-tags')).toBe(true);
  act(() => result.current.handleAction('thread-tags'));
  mockPreference = { showThreadTags: false };
  rerender({});
  expect(result.current.actions.some(action => action.id === 'thread-tags')).toBe(false);
  expect(result.current.isTagsOpen).toBe(false);
});
it('retains the archive and membership guards even when tags are enabled', () => {
  mockPreference = { showThreadTags: true };
  const { result, rerender } = renderHook(
    ({ member }: { member: boolean }) => useThreadHeaderOverflow('channel', 'thread', member),
    { initialProps: { member: false } },
  );
  expect(result.current.actions.some(action => action.id === 'thread-tags')).toBe(false);
  act(() => result.current.handleAction('thread-tags'));
  expect(result.current.isTagsOpen).toBe(false);
  mockArchived = true;
  rerender({ member: true });
  expect(result.current.actions.some(action => action.id === 'thread-tags')).toBe(false);
  act(() => result.current.handleAction('thread-tags'));
  expect(result.current.isTagsOpen).toBe(false);
});

it('starts a DM thread directly with its members and never opens the picker', () => {
  mockScope = 'DM';
  const { result } = renderHook(() => useThreadHeaderOverflow('channel', 'thread', true));
  act(() => result.current.handleAction('start-call'));
  expect(startAudioCall).toHaveBeenCalledWith('channel', 'thread', ['self', 'peer']);
  expect(result.current.isCallOpen).toBe(false);
});
it('does not directly start a DM call while a call or recording is linked', () => {
  mockScope = 'DM';
  mockCallId = 'linked';
  const { result } = renderHook(() => useThreadHeaderOverflow('channel', 'thread', true));
  act(() => result.current.handleAction('start-call'));
  expect(startAudioCall).not.toHaveBeenCalled();
});
it.each(['failed', 'permissionError', 'connecting'])(
  'blocks Take notes in %s after permission returns and explains why',
  async state => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    jest.mocked(requestRecordingPermissionsAsync).mockImplementation(async () => {
      mockRoomState = state;
      return { granted: true } as Awaited<ReturnType<typeof requestRecordingPermissionsAsync>>;
    });
    const { result } = renderHook(() => useThreadHeaderOverflow('channel', 'thread', true));
    await act(async () => result.current.handleAction('take-notes'));
    expect(sendRecordingAction).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith('Recording unavailable', expect.any(String));
    alert.mockRestore();
  },
);
