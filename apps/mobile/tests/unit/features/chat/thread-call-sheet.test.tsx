import React from 'react';
import { beforeEach, expect, it, jest } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThreadCallSheet } from '@/src/features/chat/thread-header/thread-call-sheet';
import { startAudioCall } from '@/src/utils/startAudioCall';

let mockCallId: string | null = null;
let mockScope = 'DEFAULT';
jest.mock('@xyne/shared', () => ({ ChannelScopeType: { DM: 'DM' } }));
jest.mock('@/src/hooks/useChannels', () => ({ useChannel: () => ({ scopeType: mockScope }) }));
jest.mock('@/src/contexts/AuthContext', () => ({
  useAuthContextValues: () => ({ userID: 'self' }),
}));
jest.mock('@/src/hooks/useUsers', () => ({ useUsers: () => [] }));
jest.mock('@/src/hooks/useQuery', () => ({
  useQuery: (query: string) => [
    query === 'thread'
      ? { callId: mockCallId, participants: [] }
      : [{ userId: 'self' }, { userId: 'peer' }],
    { type: 'complete' },
  ],
}));
jest.mock('@/src/zero/queries', () => ({
  queries: { getConversationById: () => 'thread', channelParticipants: () => 'members' },
}));
jest.mock('@/src/machines/roomMachine', () => ({
  roomActor: { getSnapshot: () => ({ matches: () => true }) },
}));
jest.mock('@/src/stores/recordingStore', () => ({ getRecordingState: () => ({ status: 'idle' }) }));
jest.mock('@/src/utils/startAudioCall', () => ({ startAudioCall: jest.fn() }));
jest.mock('@/src/utils/statusUtils', () => ({ isUserDeactivated: () => false }));
jest.mock('@/src/components/ui/avatar', () => () => null);
jest.mock('@/src/components/ui/input-v2', () => ({ InputV2: () => null }));
jest.mock('@/src/features/global-search/components/filters/filter-option-row', () => ({
  FilterOptionRow: () => null,
}));
jest.mock('@gorhom/bottom-sheet', () => ({ BottomSheetFlatList: () => null }));
jest.mock('@/src/components/ui/app-bottom-sheet', () => ({
  AppBottomSheet: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/src/features/global-search/components/filters/filter-sheet-header', () => ({
  FilterSheetHeader: ({ onApply }: { onApply?: () => void }) => {
    const { Pressable, Text } = require('react-native');
    return onApply ? (
      <Pressable onPress={onApply}>
        <Text>Start</Text>
      </Pressable>
    ) : null;
  },
}));

beforeEach(() => {
  mockCallId = null;
  mockScope = 'DEFAULT';
});
const props = { channelId: 'channel', threadId: 'thread', isOpen: true, onClose: jest.fn() };
it('does not offer Start for a thread with a linked call or recording', () => {
  mockCallId = 'recording';
  const view = render(<ThreadCallSheet {...props} />);
  expect(view.queryByText('Start')).toBeNull();
  expect(startAudioCall).not.toHaveBeenCalled();
});
it('removes Start if a call is linked while the picker is open', () => {
  const view = render(<ThreadCallSheet {...props} />);
  expect(view.getByText('Start')).toBeTruthy();
  mockCallId = 'call';
  view.rerender(<ThreadCallSheet {...props} />);
  expect(view.queryByText('Start')).toBeNull();
  expect(startAudioCall).not.toHaveBeenCalled();
});
it('starts a group thread with an explicit caller instead of a channel-wide fallback', () => {
  const view = render(<ThreadCallSheet {...props} />);
  fireEvent.press(view.getByText('Start'));
  expect(startAudioCall).toHaveBeenCalledWith('channel', 'thread', ['self']);
});
it('starts a DM thread with the DM members without showing a picker', async () => {
  mockScope = 'DM';
  const view = render(<ThreadCallSheet {...props} />);
  await waitFor(() =>
    expect(startAudioCall).toHaveBeenCalledWith('channel', 'thread', ['self', 'peer']),
  );
  expect(view.queryByText('Start')).toBeNull();
  expect(startAudioCall).toHaveBeenCalledTimes(1);
});
