import { act, renderHook } from '@testing-library/react-native';
import { beforeEach, expect, it, jest } from '@jest/globals';
import { useThreadHeaderOverflow } from '@/src/hooks/useThreadHeaderOverflow';

let mockPreference: { showThreadTags?: boolean } | undefined;
let mockArchived = false;
jest.mock('@/src/hooks/useQuery', () => ({
  useQuery: (query: string) => [
    query === 'preference'
      ? mockPreference
      : query === 'conversation'
        ? { callId: null }
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
jest.mock('@/src/hooks/useChannels', () => ({ useChannel: () => ({ isArchived: mockArchived }) }));
jest.mock('@/src/hooks/useRoomMachine', () => ({
  useRoomSelector: () => null,
  useIsInCall: () => false,
}));
jest.mock('@/src/machines/roomMachine', () => ({
  roomActor: { getSnapshot: () => ({ matches: () => false }) },
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
