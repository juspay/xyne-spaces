/* eslint-disable @typescript-eslint/no-require-imports, react/display-name -- jest.mock factories run before imports and cannot reference module scope */
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

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

import { BriefCitationChips } from '@/src/features/morning-brief/components/CitationChip';
import { makeRenderContext, testPalette } from './helpers/briefFixtures';

const context = makeRenderContext();

describe('BriefCitationChips', () => {
  it('renders a labeled chip for a singleton run and forwards taps', () => {
    const onPressCitation = jest.fn();
    render(
      <BriefCitationChips
        runs={[[{ toolCallId: 'tool.a:0', chunkIndex: 1 }]]}
        resolveCitation={context.resolveCitation}
        onPressCitation={onPressCitation}
        onPressGroup={jest.fn()}
        palette={testPalette}
      />,
    );
    fireEvent.press(screen.getByText('Ticket tool.a:0'));
    expect(onPressCitation).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Ticket tool.a:0' }),
    );
  });

  it('renders a +N cluster for a grouped run and opens the group', () => {
    const onPressGroup = jest.fn();
    render(
      <BriefCitationChips
        runs={[
          [
            { toolCallId: 'a', chunkIndex: 1 },
            { toolCallId: 'b', chunkIndex: 2 },
            { toolCallId: 'c', chunkIndex: 3 },
          ],
        ]}
        resolveCitation={context.resolveCitation}
        onPressCitation={jest.fn()}
        onPressGroup={onPressGroup}
        palette={testPalette}
      />,
    );
    fireEvent.press(screen.getByText('+3'));
    expect(onPressGroup).toHaveBeenCalledTimes(1);
    expect(onPressGroup.mock.calls[0]?.[0]).toHaveLength(3);
  });

  it('uses the citation kind fallback label when none is set', () => {
    render(
      <BriefCitationChips
        runs={[[{ toolCallId: 'x', chunkIndex: 1 }]]}
        resolveCitation={() => ({ kind: 'thread', channelName: 'launch' })}
        onPressCitation={jest.fn()}
        onPressGroup={jest.fn()}
        palette={testPalette}
      />,
    );
    expect(screen.getByText('Thread in #launch')).toBeTruthy();
  });

  it('renders nothing when no run resolves to a citation', () => {
    render(
      <BriefCitationChips
        runs={[[{ toolCallId: 'gone', chunkIndex: 1 }]]}
        resolveCitation={() => null}
        onPressCitation={jest.fn()}
        onPressGroup={jest.fn()}
        palette={testPalette}
      />,
    );
    expect(screen.toJSON()).toBeNull();
  });
});
