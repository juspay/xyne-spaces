import { jest, it, expect } from '@jest/globals';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { RecordingMessageCard } from '@/src/components/recordings/RecordingMessageCard';
import { DEFAULT_CHAT_RENDER_TOKENS } from '@/src/theme/chatRenderTokens';
import { getRecordingState, sendRecordingAction } from '@/src/stores/recordingStore';

jest.mock('@/src/contexts/AuthContext', () => ({
  useAuthContextValues: () => ({ userID: 'creator' }),
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useRouter: () => require('expo-router').router,
}));
jest.mock('@/src/stores/recordingStore', () => ({
  getRecordingState: jest.fn(),
  sendRecordingAction: jest.fn(),
  subscribeRecordingStore: jest.fn(() => () => {}),
}));
jest.mock('lucide-react-native', () => ({ Mic: () => null }));

it('opens the existing controls for the matching live recording', async () => {
  jest
    .mocked(getRecordingState)
    .mockReturnValue({ externalId: 'live', status: 'recording' } as ReturnType<
      typeof getRecordingState
    >);
  const { getByLabelText } = render(
    <RecordingMessageCard
      recording={{
        callId: 'live',
        title: 'Notes',
        durationMs: 0,
        isActive: true,
        createdBy: 'creator',
      }}
      tokens={DEFAULT_CHAT_RENDER_TOKENS}
      isCurrentUser={false}
    />,
  );
  fireEvent.press(getByLabelText('Open recording: Notes'));
  await waitFor(() =>
    expect(router.push).toHaveBeenCalledWith('/(protected)/(shortcuts)/recordings'),
  );
});

it('opens that recording’s existing playback screen after it ends, even if a different recording is active', async () => {
  jest
    .mocked(getRecordingState)
    .mockReturnValue({ externalId: 'other', status: 'recording' } as ReturnType<
      typeof getRecordingState
    >);
  const { getByLabelText } = render(
    <RecordingMessageCard
      recording={{ callId: 'ended', title: 'Notes', durationMs: 45000, isActive: false }}
      tokens={DEFAULT_CHAT_RENDER_TOKENS}
      isCurrentUser={false}
    />,
  );
  fireEvent.press(getByLabelText('Open recording: Notes'));
  await waitFor(() =>
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/recording/[recordingId]',
      params: { recordingId: 'ended' },
    }),
  );
});

it('stops only the matching live session without opening the recording', async () => {
  jest
    .mocked(getRecordingState)
    .mockReturnValue({ externalId: 'live', status: 'recording' } as ReturnType<
      typeof getRecordingState
    >);
  const view = render(
    <RecordingMessageCard
      recording={{
        callId: 'live',
        title: 'Notes',
        durationMs: 0,
        isActive: true,
        createdBy: 'creator',
      }}
      tokens={DEFAULT_CHAT_RENDER_TOKENS}
      isCurrentUser={false}
    />,
  );
  const button = await view.findByLabelText('Stop recording');
  const stopPropagation = jest.fn();
  fireEvent.press(button, { stopPropagation });
  await waitFor(() => expect(sendRecordingAction).toHaveBeenCalledWith({ type: 'stopRecording' }));
  expect(stopPropagation).toHaveBeenCalled();
  expect(router.push).not.toHaveBeenCalled();
});

it('does not stop a different recording if the local session changes before tapping Stop', async () => {
  jest
    .mocked(getRecordingState)
    .mockReturnValue({ externalId: 'live', status: 'recording' } as ReturnType<
      typeof getRecordingState
    >);
  const view = render(
    <RecordingMessageCard
      recording={{
        callId: 'live',
        title: 'Notes',
        durationMs: 0,
        isActive: true,
        createdBy: 'creator',
      }}
      tokens={DEFAULT_CHAT_RENDER_TOKENS}
      isCurrentUser={false}
    />,
  );
  const button = await view.findByLabelText('Stop recording');
  jest
    .mocked(getRecordingState)
    .mockReturnValue({ externalId: 'other', status: 'recording' } as ReturnType<
      typeof getRecordingState
    >);
  fireEvent.press(button, { stopPropagation: jest.fn() });
  // Flush the async store import before asserting there was no dispatch.
  await waitFor(() => expect(getRecordingState).toHaveBeenCalledTimes(2));
  expect(sendRecordingAction).not.toHaveBeenCalled();
});

it('opens completed recording details even before local recording state has caught up', async () => {
  jest
    .mocked(getRecordingState)
    .mockReturnValue({ externalId: 'ended', status: 'recording' } as ReturnType<
      typeof getRecordingState
    >);
  const view = render(
    <RecordingMessageCard
      recording={{ callId: 'ended', title: 'Notes', durationMs: 45000, isActive: false }}
      tokens={DEFAULT_CHAT_RENDER_TOKENS}
      isCurrentUser={false}
    />,
  );
  expect(view.queryByLabelText('Stop recording')).toBeNull();
  fireEvent.press(view.getByLabelText('Open recording: Notes'));
  await waitFor(() =>
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/recording/[recordingId]',
      params: { recordingId: 'ended' },
    }),
  );
});

it('keeps another user’s live recording inert', async () => {
  const view = render(
    <RecordingMessageCard
      recording={{
        callId: 'remote',
        title: 'Private notes',
        durationMs: 0,
        isActive: true,
        createdBy: 'teammate',
      }}
      tokens={DEFAULT_CHAT_RENDER_TOKENS}
      isCurrentUser={false}
    />,
  );
  fireEvent.press(view.getByLabelText('Open recording: Private notes'));
  expect(router.push).not.toHaveBeenCalled();
  expect(view.queryByLabelText('Stop recording')).toBeNull();
  expect(view.getByText('Recording in progress')).toBeTruthy();
});

it('lets the creator open a recording started on another device', async () => {
  jest
    .mocked(getRecordingState)
    .mockReturnValue({ externalId: null, status: 'idle' } as ReturnType<typeof getRecordingState>);
  const view = render(
    <RecordingMessageCard
      recording={{
        callId: 'remote',
        title: 'Remote notes',
        durationMs: 0,
        isActive: true,
        createdBy: 'creator',
      }}
      tokens={DEFAULT_CHAT_RENDER_TOKENS}
      isCurrentUser={false}
    />,
  );
  fireEvent.press(view.getByLabelText('Open recording: Remote notes'));
  await waitFor(() =>
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/recording/[recordingId]',
      params: { recordingId: 'remote' },
    }),
  );
  expect(view.queryByLabelText('Stop recording')).toBeNull();
});
