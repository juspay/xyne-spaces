/**
 * Rendering test for the floating "Back to guide" bar: real store, real bar,
 * with the router, segments, insets, tab bar, theme, icons and animations stubbed.
 */
/* eslint-disable @typescript-eslint/no-require-imports, react/display-name -- jest.mock factories run before imports and cannot reference module scope */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

const mockNavigate = jest.fn();
let mockSegments: string[] = ['(protected)', '(tabs)', 'dms'];

jest.mock('expo-router', () => ({
  useRouter: () => ({ navigate: mockNavigate }),
  useSegments: () => mockSegments,
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));
jest.mock('@/src/hooks/useTabBarHeight', () => ({
  useTabBarHeight: () => ({ tabBarHeight: 83, tabBarPaddingBottom: 50 }),
}));
jest.mock('uniwind', () => ({ useCSSVariable: (name: string) => `var(${name})` }));
jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native') as typeof import('react-native');
  const anim = { duration: (): unknown => anim };
  return { __esModule: true, default: { View }, FadeInDown: anim, FadeOutDown: anim };
});
jest.mock('lucide-react-native', () => {
  const React = require('react') as typeof import('react');
  const { Text } = require('react-native') as typeof import('react-native');
  const stub = (name: string) => () => React.createElement(Text, null, `${name}-icon`);
  return new Proxy({}, { get: (_t, prop: string) => stub(prop) });
});
jest.mock('@/src/utils/haptics', () => ({
  haptics: { buttonTap: jest.fn(), selection: jest.fn() },
}));

import { GuideReturnBar } from '@/src/features/user-guide/components/guide-return-bar';
import {
  armGuideReturn,
  clearGuideReturn,
  getGuideReturnTarget,
} from '@/src/features/user-guide/guide-return-store';

describe('GuideReturnBar', () => {
  beforeEach(() => {
    clearGuideReturn();
    mockSegments = ['(protected)', '(tabs)', 'dms'];
  });

  it('renders nothing until a guide is armed', () => {
    render(<GuideReturnBar />);
    expect(screen.queryByLabelText(/Back to guide/)).toBeNull();
  });

  it('shows the armed guide on a non-guide screen and returns to it on tap', () => {
    render(<GuideReturnBar />);

    act(() => {
      armGuideReturn({ guideId: 'gestures', title: 'Gestures you should know' });
    });

    expect(screen.getByText('Back to guide')).toBeTruthy();
    expect(screen.getByText('Gestures you should know')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Back to guide: Gestures you should know'));

    expect(mockNavigate).toHaveBeenCalledWith({
      pathname: '/(protected)/guide/[guideId]',
      params: { guideId: 'gestures' },
    });
    expect(getGuideReturnTarget()).toBeNull();
  });

  it('dismisses from the X without navigating', () => {
    render(<GuideReturnBar />);
    act(() => {
      armGuideReturn({ guideId: 'gestures', title: 'Gestures you should know' });
    });

    fireEvent.press(screen.getByLabelText('Dismiss'));

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(getGuideReturnTarget()).toBeNull();
    expect(screen.queryByText('Back to guide')).toBeNull();
  });

  it('stays hidden on guide screens and clears once the user is back in the guide', () => {
    mockSegments = ['(protected)', 'guide', '[guideId]'];
    const view = render(<GuideReturnBar />);

    // Armed while still on the guide (the moment Try it is tapped): hidden, still armed.
    act(() => {
      armGuideReturn({ guideId: 'gestures', title: 'Gestures you should know' });
    });
    expect(screen.queryByText('Back to guide')).toBeNull();
    expect(getGuideReturnTarget()).not.toBeNull();

    // On the target screen: visible.
    mockSegments = ['(protected)', '(tabs)', 'dms'];
    view.rerender(<GuideReturnBar />);
    expect(screen.getByText('Back to guide')).toBeTruthy();

    // Back in the guide by the system back button: cleared.
    mockSegments = ['(protected)', 'guide', '[guideId]'];
    view.rerender(<GuideReturnBar />);
    expect(getGuideReturnTarget()).toBeNull();
  });
});
