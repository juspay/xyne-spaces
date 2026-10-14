/**
 * Feature-level test: the real MorningBriefScreen with the real react-query
 * hooks and selectors, over a mocked HTTP layer (`dailyBriefApi`) and mocked
 * native/data-layer edges (markdown renderer, sheets, Zero-backed render
 * context). Exercises load → render, empty + enable, history switching, and
 * the regenerate flow end to end.
 */
/* eslint-disable @typescript-eslint/no-require-imports, react/display-name -- jest.mock factories run before imports and cannot reference module scope */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native') as typeof import('react-native');
  return {
    __esModule: true,
    default: { View },
    useSharedValue: (value: unknown) => ({ value }),
    useAnimatedStyle: () => ({}),
    withRepeat: (value: unknown) => value,
    withTiming: (value: unknown) => value,
    cancelAnimation: () => {},
    Easing: {
      inOut: () => () => 0,
      out: () => () => 0,
      ease: () => 0,
      cubic: () => 0,
    },
  };
});

jest.mock('react-native-enriched-markdown', () => {
  const React = require('react') as typeof import('react');
  const { Text } = require('react-native') as typeof import('react-native');
  return {
    EnrichedMarkdownText: ({ markdown }: { markdown: string }) =>
      React.createElement(Text, null, markdown),
  };
});

jest.mock('react-native-svg', () => ({ SvgXml: (): null => null }));

jest.mock('lucide-react-native', () => {
  const React = require('react') as typeof import('react');
  const { Text } = require('react-native') as typeof import('react-native');
  const stub = (name: string) => () => React.createElement(Text, null, `${name}-icon`);
  return new Proxy({}, { get: (_t, prop: string) => stub(prop) });
});

jest.mock('@/src/utils/haptics', () => ({
  haptics: { buttonTap: jest.fn(), gestureStart: jest.fn(), gestureEnd: jest.fn() },
}));

jest.mock('@/src/utils/toast', () => ({
  showMessageToast: jest.fn(),
}));

// The logger singleton (reached via the API-client import chain) starts a
// flush interval at construction, which keeps the jest worker alive.
jest.mock('@/src/utils/logger', () => ({
  logger: new Proxy({}, { get: () => jest.fn() }),
  initializeLogger: jest.fn(),
  getNativeBuildType: () => 'debug',
}));

jest.mock('uniwind', () => ({
  useCSSVariable: () => '#ffffff',
  useUniwind: () => ({ theme: 'light' }),
}));

jest.mock('expo-router', () => {
  const StackMock = (): null => null;
  StackMock.Screen = (): null => null;
  return {
    Stack: StackMock,
    useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
  };
});

jest.mock('react-native-safe-area-context', () => {
  const React = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  return {
    SafeAreaView: ({ children }: { children: ReactNode }) =>
      React.createElement(View, null, children),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});

// Native menu (UIMenu / PopupMenu): render the anchor child plus one
// pressable per action so tests can pick a menu option directly.
jest.mock('@react-native-menu/menu', () => {
  const React = require('react') as typeof import('react');
  const { Pressable, View } = require('react-native') as typeof import('react-native');
  return {
    MenuView: ({
      children,
      actions,
      onPressAction,
    }: {
      children: ReactNode;
      actions: Array<{ id: string; title: string }>;
      onPressAction?: (event: { nativeEvent: { event: string } }) => void;
    }) =>
      React.createElement(
        View,
        null,
        children,
        actions.map(action =>
          React.createElement(Pressable, {
            key: action.id,
            accessibilityRole: 'menuitem',
            accessibilityLabel: action.title,
            onPress: () => onPressAction?.({ nativeEvent: { event: action.id } }),
          }),
        ),
      ),
  };
});

jest.mock('@/src/components/ui/header-icon-button', () => {
  const React = require('react') as typeof import('react');
  const { Pressable, Text } = require('react-native') as typeof import('react-native');
  return {
    HeaderBackButton: ({ onPress }: { onPress: () => void }) =>
      React.createElement(
        Pressable,
        { accessibilityLabel: 'Go back', onPress },
        React.createElement(Text, null, 'back'),
      ),
  };
});

jest.mock('@/src/components/ui/app-bottom-sheet', () => {
  const React = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  return {
    AppBottomSheet: ({ children, isOpen }: { children: ReactNode; isOpen: boolean }) =>
      isOpen ? React.createElement(View, null, children) : null,
  };
});

jest.mock('@gorhom/bottom-sheet', () => {
  const React = require('react') as typeof import('react');
  const { TextInput, View } = require('react-native') as typeof import('react-native');
  return {
    BottomSheetView: ({ children }: { children: ReactNode }) =>
      React.createElement(View, null, children),
    BottomSheetTextInput: (props: Record<string, unknown>) => React.createElement(TextInput, props),
  };
});

jest.mock('@/src/components/ui/switch', () => {
  const React = require('react') as typeof import('react');
  const { Pressable } = require('react-native') as typeof import('react-native');
  return {
    Switch: ({
      isSelected,
      onSelectedChange,
    }: {
      isSelected: boolean;
      onSelectedChange: (value: boolean) => void;
    }) =>
      React.createElement(Pressable, {
        accessibilityRole: 'switch',
        accessibilityState: { checked: isSelected },
        onPress: () => onSelectedChange(!isSelected),
      }),
  };
});

// The Zero-backed context hook (users/channels/projects) is the one data edge
// mocked at hook level — its pure internals are covered by the logic suite.
jest.mock('@/src/features/morning-brief/hooks/useBriefRenderContext', () => ({
  useBriefRenderContext: () => ({
    lineContext: {
      isRoutable: () => true,
      ticketPrefixes: new Set<string>(),
      resolveUserName: () => null,
      resolveChannelName: () => null,
    },
    markdownStyle: {},
    palette: {
      foreground: '#111111',
      foregroundMuted: '#666666',
      cardBg: '#ffffff',
      brand: '#fe6d36',
      linkColor: '#3b82f6',
      mentionColor: '#3b82f6',
      mentionBg: 'rgba(59,130,246,0.1)',
      chipBg: '#f4f4f5',
    },
    resolveCitation: () => ({ kind: 'ticket', ticketId: 'T-1', label: 'Ticket T-1' }),
  }),
  useOpenCitation: () => jest.fn(),
  useBriefLinkHandler: () => jest.fn(),
}));

jest.mock('@/src/features/morning-brief/api/dailyBriefApi', () => ({
  DAILY_BRIEF_INSTRUCTIONS_LIMIT: 8000,
  dailyBriefApi: {
    getConfig: jest.fn(),
    saveConfig: jest.fn(),
    getLatest: jest.fn(),
    getHistory: jest.fn(),
    getDates: jest.fn(),
    getByDate: jest.fn(),
    trackSwitch: jest.fn(),
    regenerate: jest.fn(),
  },
}));

import MorningBriefScreen from '@/src/features/morning-brief/screens/MorningBriefScreen';
import { dailyBriefApi } from '@/src/features/morning-brief/api/dailyBriefApi';
import { setBoolean } from '@/src/services/localStorage';
import { makePayload } from './helpers/briefFixtures';

const api = dailyBriefApi as jest.Mocked<typeof dailyBriefApi>;

const READY_LATEST = {
  status: 'ready',
  date: '2026-09-01',
  content: '# Brief',
  data: makePayload(),
  isToday: true,
};

const CONFIG = { enabled: true, instructions: '', instructionsEnabled: true, updatedAt: null };

function renderScreen(): void {
  // gcTime: Infinity keeps react-query from arming cache-GC timers that
  // outlive the test and trip jest's open-handle detection.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MorningBriefScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // The intro banner is device-persisted; keep it out of these scenarios.
  setBoolean('lotus.morning-brief.intro-seen', true);
  api.getConfig.mockResolvedValue(CONFIG);
  api.getLatest.mockResolvedValue(READY_LATEST);
  api.getHistory.mockResolvedValue([]);
  api.getDates.mockResolvedValue([{ date: '2026-09-01', status: 'ready' }]);
  api.trackSwitch.mockResolvedValue(undefined);
});

describe('MorningBriefScreen', () => {
  it("loads and renders today's brief with title and sections", async () => {
    renderScreen();
    expect(await screen.findByText('Brief // Sep 1')).toBeTruthy();
    expect(screen.getByText('Morning Brief')).toBeTruthy();
    expect(screen.getByText('What needs you')).toBeTruthy();
    expect(screen.getByText('Triage the queue before deep work.')).toBeTruthy();
    expect(screen.getByText('Regenerate')).toBeTruthy();
  });

  it('shows the empty state with an enable CTA and saves the flag', async () => {
    api.getLatest.mockResolvedValue({ status: 'none' });
    api.getDates.mockResolvedValue([]);
    api.getConfig.mockResolvedValue({ ...CONFIG, enabled: false });
    api.saveConfig.mockResolvedValue({ ...CONFIG, enabled: true });
    renderScreen();
    const cta = await screen.findByText('Turn on morning brief');
    fireEvent.press(cta);
    await waitFor(() => expect(api.saveConfig).toHaveBeenCalledWith({ enabled: true }));
  });

  it('switches to a history brief and fires the switch beacon', async () => {
    api.getHistory.mockResolvedValue([
      {
        date: '2026-08-31',
        status: 'ready',
        content: 'old',
        data: makePayload({ date: '2026-08-31', what_needs_you: ['Yesterday item.'] }),
      },
    ]);
    renderScreen();
    await screen.findByText('Brief // Sep 1');
    fireEvent.press(screen.getByLabelText('More options'));
    fireEvent.press(await screen.findByLabelText('Version history'));
    fireEvent.press(await screen.findByText('Morning Brief 31 Aug'));
    expect(await screen.findByText('Brief // Aug 31')).toBeTruthy();
    expect(screen.getByText('Yesterday item.')).toBeTruthy();
    expect(api.trackSwitch).toHaveBeenCalledWith('history_menu');
  });

  it('opens the settings sheet from the kebab menu', async () => {
    renderScreen();
    await screen.findByText('Brief // Sep 1');
    fireEvent.press(screen.getByLabelText('More options'));
    fireEvent.press(await screen.findByLabelText('Settings'));
    expect(await screen.findByText('Brief settings')).toBeTruthy();
  });

  it('regenerates via the buffered SSE flow and refreshes the brief', async () => {
    api.regenerate.mockResolvedValue({
      data: [
        'event: complete',
        'data: {"content":"# Brief","brief":{"date":"2026-09-01"}}',
        '',
      ].join('\n'),
    });
    renderScreen();
    await screen.findByText('Brief // Sep 1');
    fireEvent.press(screen.getByText('Regenerate'));
    await waitFor(() => expect(api.regenerate).toHaveBeenCalledTimes(1));
    // The flow invalidates and refetches the brief queries afterwards.
    await waitFor(() => expect(api.getLatest.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(await screen.findByText('Brief // Sep 1')).toBeTruthy();
  });

  it('surfaces a load failure in the error banner', async () => {
    api.getLatest.mockRejectedValue(new Error('boom'));
    renderScreen();
    expect(await screen.findByText('Failed to load daily brief.')).toBeTruthy();
  });
});
