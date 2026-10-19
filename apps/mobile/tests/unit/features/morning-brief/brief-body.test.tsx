/* eslint-disable @typescript-eslint/no-require-imports, react/display-name -- jest.mock factories run before imports and cannot reference module scope */
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

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

// The native markdown renderer becomes a plain Text so assertions can read the
// prepared markdown the pipeline produced.
jest.mock('react-native-enriched-markdown', () => {
  const React = require('react') as typeof import('react');
  const { Text } = require('react-native') as typeof import('react-native');
  return {
    EnrichedMarkdownText: ({ markdown }: { markdown: string }) =>
      React.createElement(Text, null, markdown),
  };
});

jest.mock('react-native-svg', () => ({
  SvgXml: (): null => null,
}));

jest.mock('@/src/utils/haptics', () => ({
  haptics: { buttonTap: jest.fn() },
}));

jest.mock('lucide-react-native', () => {
  const React = require('react') as typeof import('react');
  const { Text } = require('react-native') as typeof import('react-native');
  const stub = (name: string) => () => React.createElement(Text, null, `${name}-icon`);
  return new Proxy({}, { get: (_t, prop: string) => stub(prop) });
});

import { BriefBody } from '@/src/features/morning-brief/components/BriefBody';
import { computeSections } from '@/src/features/morning-brief/utils/selectors';
import { makeHandlers, makePayload, makeRenderContext } from './helpers/briefFixtures';

const context = makeRenderContext();
const handlers = makeHandlers();

const baseProps = {
  isBusy: false,
  briefEnabled: true as boolean | undefined,
  enabling: false,
  onEnable: () => {},
  context,
  handlers,
};

function renderBody(overrides: Partial<Parameters<typeof BriefBody>[0]>): void {
  render(<BriefBody {...baseProps} selected={null} sections={[]} {...overrides} />);
}

describe('BriefBody states', () => {
  it('shows the skeleton while busy', () => {
    renderBody({ isBusy: true });
    expect(screen.getByLabelText('Loading brief')).toBeTruthy();
  });

  it('shows the empty state without a CTA when the brief is enabled', () => {
    renderBody({ selected: null });
    expect(screen.getByText('No brief to show yet. Use “Generate” to create one.')).toBeTruthy();
    expect(screen.queryByText('Turn on morning brief')).toBeNull();
  });

  it('shows the enable CTA when the brief is off and fires onEnable', () => {
    const onEnable = jest.fn();
    renderBody({ selected: null, briefEnabled: false, onEnable });
    fireEvent.press(screen.getByText('Turn on morning brief'));
    expect(onEnable).toHaveBeenCalledTimes(1);
  });

  it('shows the failed message when a failed brief has no content', () => {
    renderBody({
      selected: { date: '2026-09-01', status: 'failed', content: '', data: null },
    });
    expect(screen.getByText('This brief failed to generate.')).toBeTruthy();
  });

  it('shows the stale notice above sections when the last refresh failed', () => {
    const data = makePayload();
    renderBody({
      selected: { date: '2026-09-01', status: 'failed', content: 'x', data },
      sections: computeSections(data),
    });
    expect(screen.getByText('The last refresh failed — showing the previous brief.')).toBeTruthy();
    expect(screen.getByText('What needs you')).toBeTruthy();
  });

  it('falls back to rendering `content` when there is no structured data', () => {
    renderBody({
      selected: { date: '2026-09-01', status: 'ready', content: '# Brief\n\nHello', data: null },
    });
    expect(screen.getByText(/Hello/)).toBeTruthy();
  });

  it('shows the no-content message for an empty ready brief', () => {
    renderBody({
      selected: { date: '2026-09-01', status: 'ready', content: '', data: null },
    });
    expect(screen.getByText('This brief has no content.')).toBeTruthy();
  });
});

describe('BriefBody structured sections', () => {
  const data = makePayload();
  const sections = computeSections(data);
  const selected = { date: '2026-09-01', status: 'ready', content: 'md', data };

  it('renders only non-empty section labels', () => {
    renderBody({ selected, sections });
    expect(screen.getByText('What needs you')).toBeTruthy();
    expect(screen.getByText('Overdue')).toBeTruthy();
    expect(screen.getByText("Today's schedule")).toBeTruthy();
    expect(screen.queryByText('Waiting on others')).toBeNull();
    expect(screen.queryByText('Assigned to you')).toBeNull();
  });

  it('renders line prose with citation tokens stripped', () => {
    renderBody({ selected, sections });
    expect(screen.getByText('Triage the queue before deep work.')).toBeTruthy();
    expect(screen.queryByText(/clf-/)).toBeNull();
  });

  it('renders a labeled citation chip and forwards its press', () => {
    const onPressCitation = jest.fn();
    renderBody({ selected, sections, handlers: makeHandlers({ onPressCitation }) });
    const chip = screen.getByText('Ticket tool.a:0');
    fireEvent.press(chip);
    expect(onPressCitation).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Ticket tool.a:0' }),
    );
  });

  it("renders the schedule section's weekday/day gutter for the brief date", () => {
    renderBody({ selected, sections });
    // 2026-09-01 is a Tuesday.
    expect(screen.getByText('Tue')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('Standup at 10:00.')).toBeTruthy();
  });
});
