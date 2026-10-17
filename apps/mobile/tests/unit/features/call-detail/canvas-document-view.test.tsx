import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('uniwind', () => ({ useCSSVariable: () => '#abcdef' }));

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

jest.mock('@/src/utils/canvasUrl', () => ({
  extractCanvasViewIdFromLink: () => null,
  openDashboardCanvas: jest.fn(),
}));

jest.mock('lucide-react-native', () => {
  const React = require('react') as typeof import('react');
  const { Text } = require('react-native') as typeof import('react-native');
  const stub = (name: string) => () => React.createElement(Text, null, `${name}-icon`);
  return new Proxy({}, { get: (_t, prop: string) => stub(prop) });
});

import { CallTimelineCard } from '@/src/features/call-detail/components/call-timeline-card';
import { CanvasDocumentView } from '@/src/features/call-detail/components/canvas-document-view';
import type { CanvasBlock } from '@/src/features/call-detail/utils/canvas-document';

const text = (value: string): CanvasBlock['content'][number] => ({
  kind: 'text',
  text: value,
  styles: {},
});

const blocks: CanvasBlock[] = [
  { id: 'h', type: 'heading', props: { level: 1 }, content: [text('Summary')], children: [] },
  {
    id: 'p',
    type: 'paragraph',
    props: {},
    content: [
      text('Agreed on plan B'),
      {
        kind: 'citation',
        callId: 'c',
        segment: 4,
        timestamp: '04:32',
        speaker: 'Ana',
        snippet: '',
        count: 1,
      },
    ],
    children: [],
  },
  { id: 'n1', type: 'numberedListItem', props: {}, content: [text('First')], children: [] },
  { id: 'n2', type: 'numberedListItem', props: {}, content: [text('Second')], children: [] },
  {
    id: 'c',
    type: 'checkListItem',
    props: { checked: true },
    content: [text('Done')],
    children: [],
  },
  {
    id: 't',
    type: 'table',
    props: {},
    content: [],
    rows: [
      [{ content: [text('Owner')], isHeader: true }],
      [{ content: [text('Ana')], isHeader: false }],
    ],
    children: [],
  },
  { id: 'x', type: 'someFutureBlock', props: {}, content: [text('Still readable')], children: [] },
];

describe('CanvasDocumentView', () => {
  it('renders every block kind and numbers list runs', () => {
    render(<CanvasDocumentView blocks={blocks} />);
    expect(screen.getByText('Summary')).toBeTruthy();
    expect(screen.getByText('Agreed on plan B')).toBeTruthy();
    expect(screen.getByText('1.')).toBeTruthy();
    expect(screen.getByText('2.')).toBeTruthy();
    expect(screen.getByText('Done')).toBeTruthy();
    expect(screen.getByText('Owner')).toBeTruthy();
    expect(screen.getByText('Still readable')).toBeTruthy();
  });

  it('reports a pressed citation', () => {
    const onCitationPress = jest.fn();
    render(<CanvasDocumentView blocks={blocks} onCitationPress={onCitationPress} />);
    fireEvent.press(screen.getByLabelText('Transcript at 04:32, Ana'));
    expect(onCitationPress).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'citation', segment: 4, timestamp: '04:32' }),
    );
  });
});

describe('CallTimelineCard', () => {
  it('lists markers and recordings and reports presses', () => {
    const onMarkerPress = jest.fn();
    const onRecordingPress = jest.fn();
    render(
      <CallTimelineCard
        spanSeconds={600}
        markedItems={[
          { type: 'decision', text: 'Go with B', timestampSeconds: 120 },
          { type: 'action', text: 'Ana drafts RFC', timestampSeconds: 300 },
        ]}
        participantEvents={[{ type: 'join', name: 'Ana', timestampSeconds: 0 }]}
        recordedSpans={[
          {
            recordingId: 'r1',
            startSeconds: 60,
            endSeconds: 400,
            name: null,
            kind: 'audio',
            recordingType: 'AUDIO_ONLY',
          },
        ]}
        onMarkerPress={onMarkerPress}
        onRecordingPress={onRecordingPress}
      />,
    );
    expect(screen.getByText('0:00 – 10:00')).toBeTruthy();
    fireEvent.press(screen.getByText('Ana drafts RFC'));
    expect(onMarkerPress).toHaveBeenCalledWith(expect.objectContaining({ type: 'action' }));
    fireEvent.press(screen.getByLabelText('Play recording 1'));
    expect(onRecordingPress).toHaveBeenCalledWith(
      expect.objectContaining({ recordingId: 'r1' }),
      0,
    );
  });
});
