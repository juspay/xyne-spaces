import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { router } from 'expo-router';

import { RecordingSummaryActivity } from '@/src/components/activity/recording-summary-activity';
import { navigateToActivityTarget } from '@/src/features/activity/presentation/activityRowAssembler';
import type { ActivityWithRelated } from '@/src/types/activity';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('uniwind', () => ({ useCSSVariable: () => '#555555' }));
jest.mock('@xyne/shared', () => ({ CallType: { HEADLESS: 'HEADLESS' } }));
jest.mock('@/src/hooks/useChannels', () => ({ getChannelDisplayName: jest.fn() }));
jest.mock('@/src/components/activity/activity-v2-nav', () => ({ navigateToMessage: jest.fn() }));
jest.mock('@/src/components/activity/activity-v2-card', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { Pressable, Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    ActivityV2Card: ({
      actorName,
      description,
      onPress,
      children,
    }: {
      actorName: string;
      description: string;
      onPress: () => void;
      children: ReactNode;
    }) =>
      React.createElement(
        Pressable,
        { onPress, testID: 'summary-card' },
        React.createElement(Text, null, actorName),
        React.createElement(Text, null, description),
        children,
      ),
  };
});

const activity = (callType = 'HEADLESS') =>
  ({
    id: 'summary',
    actorAction: 'recording_summary_ready',
    callId: 'internal-call',
    call: { id: 'internal-call', externalId: 'external-recording', title: 'Planning', callType },
  }) as unknown as ActivityWithRelated;

describe('RecordingSummaryActivity', () => {
  it('shows the summary and opens recording detail with the external ID', () => {
    const view = render(<RecordingSummaryActivity activity={activity()} />);
    expect(view.getByText('Recording summary')).toBeTruthy();
    expect(view.getByText('· "Planning"')).toBeTruthy();
    expect(view.getByText('Summary is ready to view')).toBeTruthy();
    fireEvent.press(view.getByTestId('summary-card'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/recording/[recordingId]',
      params: { recordingId: 'external-recording' },
    });
  });

  it('opens a regular call summary with the internal ID', () => {
    const view = render(<RecordingSummaryActivity activity={activity('AUDIO')} />);
    expect(view.getByText('Call summary')).toBeTruthy();
    fireEvent.press(view.getByTestId('summary-card'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/call-detail/[callId]',
      params: { callId: 'internal-call' },
    });
  });

  it('waits for a missing relation instead of rendering a broken card', () => {
    const view = render(<RecordingSummaryActivity activity={{ ...activity(), call: undefined }} />);
    expect(view.queryByTestId('summary-card')).toBeNull();
  });

  it('preserves existing ticket navigation and no-op targets', () => {
    navigateToActivityTarget({ kind: 'none' });
    expect(router.push).not.toHaveBeenCalled();
    navigateToActivityTarget({ kind: 'ticket', ticketId: 'ticket-1', selectedTab: 'activity' });
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/ticket/[ticketId]',
      params: { ticketId: 'ticket-1', selectedTab: 'activity' },
    });
  });
});
