/**
 * Rendering tests for the User Guide hub and detail screens: the real screens
 * over the real catalog, search and list primitives, with the router, theme,
 * icons, haptics, metrics and the shared app header stubbed out.
 */
/* eslint-disable @typescript-eslint/no-require-imports, react/display-name -- jest.mock factories run before imports and cannot reference module scope */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  Stack: { Screen: (): null => null },
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: jest.fn(),
    canGoBack: () => true,
  }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native') as typeof import('react-native');
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
  };
});
jest.mock('uniwind', () => ({ useCSSVariable: (name: string) => `var(${name})` }));
jest.mock('@/src/theme/useBubbleAccent', () => ({
  useBubbleAccent: () => ({
    accentBg: '#2563eb',
    accentFg: '#ffffff',
    accentSoft: '#dbeafe',
    accentText: '#1d4ed8',
  }),
}));
jest.mock('lucide-react-native', () => {
  const React = require('react') as typeof import('react');
  const { Text } = require('react-native') as typeof import('react-native');
  const stub = (name: string) => () => React.createElement(Text, null, `${name}-icon`);
  return new Proxy({}, { get: (_t, prop: string) => stub(prop) });
});
jest.mock('react-native-svg', () => {
  const { View } = require('react-native') as typeof import('react-native');
  return { __esModule: true, default: View, Svg: View, Path: View };
});
jest.mock('@/src/utils/haptics', () => ({
  haptics: {
    buttonTap: jest.fn(),
    selection: jest.fn(),
    success: jest.fn(),
  },
}));
jest.mock('@/src/utils/toast', () => ({ showMessageToast: jest.fn() }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({})) }));
const mockRecordScreenView = jest.fn();
jest.mock('@/src/services/metrics', () => ({
  recordScreenView: (...args: unknown[]) => mockRecordScreenView(...args),
}));
jest.mock('@xyne/shared/hooks', () => ({ useCanReadTicket: () => true }));
jest.mock('@/src/features/user-guide/components/guide-screen-header', () => {
  const React = require('react') as typeof import('react');
  const { Text } = require('react-native') as typeof import('react-native');
  return {
    GuideScreenHeader: ({ title }: { title?: string }) =>
      React.createElement(Text, null, title ? `header:${title}` : 'header'),
  };
});

import UserGuideHubScreen from '@/src/features/user-guide/screens/UserGuideHubScreen';
import UserGuideDetailScreen from '@/src/features/user-guide/screens/UserGuideDetailScreen';
import UserGuideTopicScreen from '@/src/features/user-guide/screens/UserGuideTopicScreen';
import { USER_GUIDES } from '@/src/features/user-guide/guides';
import { getGuideReturnTarget } from '@/src/features/user-guide/guide-return-store';

describe('UserGuideHubScreen', () => {
  beforeEach(() => {
    mockParams = {};
  });

  it('shows only search, the Start here path and the topic list', () => {
    render(<UserGuideHubScreen />);

    expect(screen.getByText('header:User guide')).toBeTruthy();
    expect(screen.getByPlaceholderText('What do you want to do?')).toBeTruthy();
    expect(screen.getByText('New to Xyne Spaces? Start here')).toBeTruthy();
    expect(screen.getByText('Browse by topic')).toBeTruthy();
    // The Start here path ends on the SOS guide.
    expect(screen.getByLabelText('Sign in and enroll your device')).toBeTruthy();
    expect(screen.getByLabelText('What an SOS alert looks like')).toBeTruthy();
    // Topics are rows, not expanded lists: no individual messaging guide is visible.
    expect(screen.getByLabelText('Messaging')).toBeTruthy();
    expect(screen.queryByLabelText('Act on a message')).toBeNull();
    expect(screen.queryByLabelText('Start here')).toBeNull();
    expect(mockRecordScreenView).toHaveBeenCalledWith('user-guide');
  });

  it('opens a Start here guide directly', () => {
    render(<UserGuideHubScreen />);

    fireEvent.press(screen.getByLabelText('Gestures you should know'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(protected)/guide/[guideId]',
      params: { guideId: 'gestures' },
    });
  });

  it('opens a topic screen from the topic list', () => {
    render(<UserGuideHubScreen />);

    fireEvent.press(screen.getByLabelText('Calls'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(protected)/guide/topic/[categoryId]',
      params: { categoryId: 'calls' },
    });
  });

  it('searches the catalog and replaces the browse layout while a query is active', () => {
    render(<UserGuideHubScreen />);

    fireEvent.changeText(screen.getByPlaceholderText('What do you want to do?'), 'lock screen');

    expect(screen.getByLabelText('Answer calls on the lock screen')).toBeTruthy();
    expect(screen.queryByText('Browse by topic')).toBeNull();
    expect(screen.getByText(/^\d+ guides?$/)).toBeTruthy();
  });

  it('offers suggestions on an empty result and applies one on press', () => {
    render(<UserGuideHubScreen />);

    fireEvent.changeText(screen.getByPlaceholderText('What do you want to do?'), 'qwertyuiop');
    expect(screen.getByText(/No guides match/)).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Search for mute a channel'));

    expect(screen.getByLabelText('Quiet a busy channel')).toBeTruthy();
  });
});

describe('UserGuideTopicScreen', () => {
  it("lists a topic's guides in order and opens one", () => {
    mockParams = { categoryId: 'calls' };

    render(<UserGuideTopicScreen />);

    expect(screen.getByText('Calls')).toBeTruthy();
    expect(screen.getByText('Start, answer and revisit calls')).toBeTruthy();
    expect(screen.getByLabelText('Start or join a call')).toBeTruthy();
    expect(screen.getByLabelText('Answer calls on the lock screen')).toBeTruthy();
    expect(screen.getByLabelText('Recordings, transcripts and AI summaries')).toBeTruthy();
    expect(mockRecordScreenView).toHaveBeenCalledWith('user-guide/topic/calls');

    fireEvent.press(screen.getByLabelText('Answer calls on the lock screen'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(protected)/guide/[guideId]',
      params: { guideId: 'answer-calls' },
    });
  });

  it('shows a not-available state for an unknown topic', () => {
    mockParams = { categoryId: 'nope' };

    render(<UserGuideTopicScreen />);

    expect(screen.getByText('This topic is not available')).toBeTruthy();
  });
});

describe('UserGuideDetailScreen', () => {
  beforeEach(() => {
    mockParams = { guideId: 'message-actions' };
  });

  it('renders the guide anatomy: category, title, steps, tip, caution and related', () => {
    const guide = USER_GUIDES.find(candidate => candidate.id === 'message-actions');
    expect(guide).toBeTruthy();

    render(<UserGuideDetailScreen />);

    expect(screen.getByText('Act on a message')).toBeTruthy();
    expect(screen.getByText(/Messaging\s+·\s+4 of 8/)).toBeTruthy();
    expect(screen.getByLabelText('Threads and replying in context')).toBeTruthy();
    expect(screen.getByLabelText(`Step 1 of ${guide!.steps.length}`)).toBeTruthy();
    expect(
      screen.getByLabelText(`Step ${guide!.steps.length} of ${guide!.steps.length}`),
    ).toBeTruthy();
    expect(screen.getByText(/Mark as Unread/)).toBeTruthy();
    expect(screen.getByText(/cannot be undone/)).toBeTruthy();
    expect(screen.getByText('Related')).toBeTruthy();
    expect(mockRecordScreenView).toHaveBeenCalledWith('user-guide/message-actions');
  });

  it('deep-links into the real screen from Try it', () => {
    render(<UserGuideDetailScreen />);

    fireEvent.press(screen.getByLabelText('Try it: Open DMs'));

    expect(mockPush).toHaveBeenCalledWith('/(protected)/(tabs)/dms');
    expect(getGuideReturnTarget()).toEqual({
      guideId: 'message-actions',
      title: 'Act on a message',
    });
  });

  it('records helpful feedback and thanks the reader', () => {
    render(<UserGuideDetailScreen />);

    fireEvent.press(screen.getByLabelText('Yes, helpful'));

    expect(screen.getByText('Thanks for the feedback')).toBeTruthy();
  });

  it('navigates to a related guide', () => {
    render(<UserGuideDetailScreen />);

    fireEvent.press(screen.getByText('Bookmarks and reminders'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(protected)/guide/[guideId]',
      params: { guideId: 'bookmarks-and-reminders' },
    });
  });

  it('marks OS-specific steps with a platform pill', () => {
    mockParams = { guideId: 'answer-calls' };

    render(<UserGuideDetailScreen />);

    expect(screen.getByText('iOS only')).toBeTruthy();
    expect(screen.getByText('Android only')).toBeTruthy();
  });

  it('shows a not-found state for an unknown guide and routes back to the hub', () => {
    mockParams = { guideId: 'does-not-exist' };

    render(<UserGuideDetailScreen />);

    expect(screen.getByText('This guide is not available')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Browse all guides'));
    expect(mockReplace).toHaveBeenCalledWith('/(protected)/guide');
  });
});
