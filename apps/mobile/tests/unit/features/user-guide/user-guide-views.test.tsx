/**
 * Rendering tests for the User Guide's pure views. They take fixtures and
 * callbacks, so only the theme, icon and haptics modules are stubbed: no
 * router, no permissions, no storage, no metrics.
 */
/* eslint-disable @typescript-eslint/no-require-imports, react/display-name -- jest.mock factories run before imports and cannot reference module scope */
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

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
  haptics: { buttonTap: jest.fn(), selection: jest.fn(), success: jest.fn() },
}));

import { GUIDE_CATEGORY_BY_ID } from '@/src/features/user-guide/categories';
import { UserGuideDetailView } from '@/src/features/user-guide/components/user-guide-detail-view';
import { UserGuideHubView } from '@/src/features/user-guide/components/user-guide-hub-view';
import { UserGuideTopicView } from '@/src/features/user-guide/components/user-guide-topic-view';
import type { MobileGuide } from '@/src/features/user-guide/types';

const guide = (overrides: Partial<MobileGuide> & Pick<MobileGuide, 'id'>): MobileGuide => ({
  title: overrides.id,
  tagline: `About ${overrides.id}`,
  category: 'messaging',
  icon: 'Info',
  findIn: ['More'],
  steps: ['Tap one.', 'Tap two.', 'Tap three.'],
  keywords: [],
  priority: 'P1',
  ...overrides,
});

const SIGN_IN = guide({ id: 'sign-in', title: 'Sign in', category: 'start', icon: 'LogIn' });
const GESTURES = guide({ id: 'gestures', title: 'Gestures', category: 'start', icon: 'Hand' });
const CHANNELS = guide({ id: 'channels', title: 'Channels', icon: 'Hash' });
const ACT = guide({
  id: 'act',
  title: 'Act on a message',
  tagline: 'Everything behind long-press.',
  icon: 'MousePointerClick',
  steps: [
    'Long-press any message.',
    { text: 'Swipe to accept, like a phone call.', platform: 'ios' },
    'Tap [[Plus]] to attach.',
  ],
  tip: 'Mark as Unread keeps it bold.',
  caution: 'Delete cannot be undone.',
  tryIt: { label: 'Open DMs', href: '/(protected)/(tabs)/dms' },
  videoUrl: 'https://example.com/video',
  related: ['channels'],
});
const CALLS = guide({ id: 'calls', title: 'Start a call', category: 'calls', icon: 'Phone' });

const TOPICS = [
  { category: GUIDE_CATEGORY_BY_ID.messaging, guides: [CHANNELS, ACT] },
  { category: GUIDE_CATEGORY_BY_ID.calls, guides: [CALLS] },
];

const noop = (): void => {};

function renderHub(overrides: Partial<Parameters<typeof UserGuideHubView>[0]> = {}) {
  const props = {
    query: '',
    onQueryChange: jest.fn(),
    isSearching: false,
    results: [],
    suggestions: ['share a photo', 'mute a channel'],
    startHere: [SIGN_IN, GESTURES],
    topics: TOPICS,
    onOpenGuide: jest.fn(),
    onOpenTopic: jest.fn(),
    ...overrides,
  };
  render(<UserGuideHubView {...props} />);
  return props;
}

describe('UserGuideHubView', () => {
  it('shows the search bar, the Start here path and one row per topic with counts', () => {
    renderHub();

    expect(screen.getByPlaceholderText('What do you want to do?')).toBeTruthy();
    expect(screen.getByText('New to Xyne Spaces? Start here')).toBeTruthy();
    expect(screen.getByLabelText('Sign in')).toBeTruthy();
    expect(screen.getByLabelText('Gestures')).toBeTruthy();
    // Start here rows show no tagline; topic rows show a count, not their guides.
    expect(screen.queryByText('About sign-in')).toBeNull();
    expect(screen.getByLabelText('Messaging')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.queryByLabelText('Act on a message')).toBeNull();
  });

  it('reports guide and topic taps with the tapped item', () => {
    const props = renderHub();

    fireEvent.press(screen.getByLabelText('Gestures'));
    fireEvent.press(screen.getByLabelText('Calls'));

    expect(props.onOpenGuide).toHaveBeenCalledWith(GESTURES);
    expect(props.onOpenTopic).toHaveBeenCalledWith(GUIDE_CATEGORY_BY_ID.calls);
  });

  it('forwards typing to onQueryChange', () => {
    const props = renderHub();

    fireEvent.changeText(screen.getByPlaceholderText('What do you want to do?'), 'lock');

    expect(props.onQueryChange).toHaveBeenCalledWith('lock');
  });

  it('shows results with taglines instead of the browse layout while searching', () => {
    renderHub({ query: 'act', isSearching: true, results: [ACT] });

    expect(screen.getByText('1 guide')).toBeTruthy();
    expect(screen.getByLabelText('Act on a message')).toBeTruthy();
    expect(screen.getByText('Everything behind long-press.')).toBeTruthy();
    expect(screen.queryByText('Browse by topic')).toBeNull();
    expect(screen.queryByText('New to Xyne Spaces? Start here')).toBeNull();
  });

  it('offers suggestions and a clear action when nothing matches', () => {
    const props = renderHub({ query: 'zzz', isSearching: true, results: [] });

    expect(screen.getByText('No guides match “zzz”')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Search for mute a channel'));
    expect(props.onQueryChange).toHaveBeenCalledWith('mute a channel');

    fireEvent.press(screen.getByLabelText('Clear search'));
    expect(props.onQueryChange).toHaveBeenCalledWith('');
  });
});

describe('UserGuideTopicView', () => {
  it('renders the topic header and its guides with taglines', () => {
    const onOpenGuide = jest.fn();
    render(
      <UserGuideTopicView
        category={GUIDE_CATEGORY_BY_ID.messaging}
        guides={[CHANNELS, ACT]}
        onOpenGuide={onOpenGuide}
      />,
    );

    expect(screen.getByRole('header')).toHaveTextContent('Messaging');
    expect(screen.getByText(GUIDE_CATEGORY_BY_ID.messaging.description)).toBeTruthy();
    expect(screen.getByText('About channels')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Act on a message'));
    expect(onOpenGuide).toHaveBeenCalledWith(ACT);
  });

  it('shows a not-available state without a category', () => {
    render(<UserGuideTopicView category={null} guides={[]} onOpenGuide={noop} />);
    expect(screen.getByText('This topic is not available')).toBeTruthy();
  });
});

function renderDetail(overrides: Partial<Parameters<typeof UserGuideDetailView>[0]> = {}) {
  const props = {
    guide: ACT,
    position: { index: 2, total: 8 },
    related: [CHANNELS],
    feedback: null,
    onTryIt: jest.fn(),
    onWatchVideo: jest.fn(),
    onOpenGuide: jest.fn(),
    onFeedback: jest.fn(),
    onReportIssue: jest.fn(),
    onBrowseAll: jest.fn(),
    ...overrides,
  };
  render(<UserGuideDetailView {...props} />);
  return props;
}

describe('UserGuideDetailView', () => {
  it('renders eyebrow, title, tagline, steps, callouts and related', () => {
    renderDetail();

    expect(screen.getByText(/Messaging\s+·\s+2 of 8/)).toBeTruthy();
    expect(screen.getByRole('header')).toHaveTextContent('Act on a message');
    expect(screen.getByText('Everything behind long-press.')).toBeTruthy();
    expect(screen.getByLabelText('Step 1 of 3')).toBeTruthy();
    expect(screen.getByLabelText('Step 3 of 3')).toBeTruthy();
    expect(screen.getByText('iOS only')).toBeTruthy();
    // Inline icon tokens render as glyphs and read as their key.
    expect(screen.getByText('Plus-icon')).toBeTruthy();
    expect(screen.getByLabelText('Tap Plus to attach.')).toBeTruthy();
    expect(screen.getByText(/Mark as Unread keeps it bold/)).toBeTruthy();
    expect(screen.getByText(/Delete cannot be undone/)).toBeTruthy();
    expect(screen.getByText('Related')).toBeTruthy();
    expect(screen.getByLabelText('Channels')).toBeTruthy();
  });

  it('omits the position when the topic has a single guide', () => {
    renderDetail({ position: { index: 1, total: 1 } });
    expect(screen.getByText('Messaging')).toBeTruthy();
    expect(screen.queryByText(/1 of 1/)).toBeNull();
  });

  it('fires the action callbacks', () => {
    const props = renderDetail();

    fireEvent.press(screen.getByLabelText('Try it: Open DMs'));
    fireEvent.press(screen.getByLabelText('Watch video'));
    fireEvent.press(screen.getByLabelText('Channels'));
    fireEvent.press(screen.getByLabelText('No, not helpful'));
    fireEvent.press(screen.getByLabelText('Still stuck? Report an issue'));

    expect(props.onTryIt).toHaveBeenCalledTimes(1);
    expect(props.onWatchVideo).toHaveBeenCalledTimes(1);
    expect(props.onOpenGuide).toHaveBeenCalledWith(CHANNELS);
    expect(props.onFeedback).toHaveBeenCalledWith('no');
    expect(props.onReportIssue).toHaveBeenCalledTimes(1);
  });

  it('hides Try it and Watch video when the guide has neither', () => {
    renderDetail({ guide: CHANNELS, related: [] });

    expect(screen.queryByLabelText(/^Try it/)).toBeNull();
    expect(screen.queryByLabelText('Watch video')).toBeNull();
    expect(screen.queryByText('Related')).toBeNull();
  });

  it('reflects recorded feedback', () => {
    renderDetail({ feedback: 'yes' });

    expect(screen.getByText('Thanks for the feedback')).toBeTruthy();
    expect(screen.getByLabelText('Yes, helpful')).toBeSelected();
    expect(screen.getByLabelText('No, not helpful')).not.toBeSelected();
  });

  it('shows the not-found state and routes Browse all guides', () => {
    const props = renderDetail({ guide: null, position: null, related: [] });

    expect(screen.getByText('This guide is not available')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Browse all guides'));
    expect(props.onBrowseAll).toHaveBeenCalledTimes(1);
  });
});
