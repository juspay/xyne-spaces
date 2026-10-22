import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildParticipantEvents,
  buildRecordedSpans,
  findIndexByTimeSeconds,
  findTranscriptTargetIndex,
  formatCallHeldOn,
  formatCallLength,
  formatOffset,
  getCanvasIdFromUrl,
  getTemplateIcon,
  normalizeLabelInput,
  parseMarkedItems,
  parseTranscript,
  parseTranscriptTimestamp,
  type CallRecordingSession,
} from '@/src/features/call-detail/utils/call-detail-format';

describe('call detail formatting', () => {
  it('formats the held-on line like the dashboard', () => {
    const date = new Date(2026, 7, 4, 15, 12);
    assert.equal(formatCallHeldOn(date.getTime()), 'Tue Aug 4, 2026 · 3:12 PM');
    assert.equal(formatCallHeldOn(null), null);
    assert.equal(formatCallHeldOn('not a date'), null);
  });

  it('rounds call length and never says 0 min', () => {
    assert.equal(formatCallLength(12_000), '1 min');
    assert.equal(formatCallLength(22 * 60_000), '22 min');
    assert.equal(formatCallLength(60 * 60_000), '1 hr');
    assert.equal(formatCallLength(65 * 60_000), '1 hr 5 min');
    assert.equal(formatCallLength(null), null);
    assert.equal(formatCallLength(0), null);
  });

  it('formats offsets with and without hours', () => {
    assert.equal(formatOffset(272), '4:32');
    assert.equal(formatOffset(3872), '1:04:32');
    assert.equal(formatOffset(-4), '0:00');
  });

  it('pulls the canvas id off a canvas url', () => {
    assert.equal(getCanvasIdFromUrl('https://app.example.com/chat/canvas/abc-123'), 'abc-123');
    assert.equal(getCanvasIdFromUrl('/chat/canvas/xyz/'), 'xyz');
    assert.equal(getCanvasIdFromUrl(undefined), null);
  });

  it('uses the dashboard template glyphs', () => {
    assert.equal(getTemplateIcon('Default summary'), '⚡');
    assert.equal(getTemplateIcon('sales call'), 'S');
    assert.equal(getTemplateIcon('  '), '#');
  });

  it('normalizes typed labels', () => {
    assert.equal(normalizeLabelInput('  customer   call '), 'customer call');
    assert.equal(normalizeLabelInput('x'.repeat(60)).length, 40);
  });
});

describe('marked items', () => {
  it('drops malformed entries and sorts chronologically', () => {
    const items = parseMarkedItems([
      { type: 'action', text: 'Ship it', timestampSeconds: 90 },
      { type: 'decision', text: 'Go with B', timestampSeconds: 30 },
      { type: 'moment', timestampSeconds: 60 },
      { type: 'unknown', timestampSeconds: 5 },
      { type: 'action', timestampSeconds: 'soon' },
      null,
      'nope',
    ]);
    assert.deepEqual(
      items.map(item => [item.type, item.timestampSeconds, item.text]),
      [
        ['decision', 30, 'Go with B'],
        ['moment', 60, ''],
        ['action', 90, 'Ship it'],
      ],
    );
    assert.deepEqual(parseMarkedItems(undefined), []);
    assert.deepEqual(parseMarkedItems({}), []);
  });
});

describe('timeline geometry', () => {
  it('measures joins and leaves from the call start, pinning early joins to 0', () => {
    const origin = 1_000_000;
    const events = buildParticipantEvents(
      [
        { name: 'Ana', joinedAt: origin - 5_000, leftAt: origin + 120_000 },
        { name: '  ', joinedAt: origin + 30_000, leftAt: null },
      ],
      origin,
    );
    assert.deepEqual(events, [
      { type: 'join', name: 'Ana', timestampSeconds: 0 },
      { type: 'join', name: 'Someone', timestampSeconds: 30 },
      { type: 'leave', name: 'Ana', timestampSeconds: 120 },
    ]);
  });

  it('keeps only uploaded, finished recordings', () => {
    const origin = Date.UTC(2026, 0, 1, 10, 0, 0);
    const at = (seconds: number): string => new Date(origin + seconds * 1000).toISOString();
    const sessions: CallRecordingSession[] = [
      {
        id: 'b',
        name: 'Screen',
        recordingType: 'AUDIO_SCREEN',
        status: 'RECORDING_UPLOADED',
        startedAt: at(300),
        endedAt: at(600),
        durationMs: 300_000,
      },
      {
        id: 'a',
        name: null,
        recordingType: 'AUDIO_ONLY',
        status: 'RECORDING_UPLOADED',
        startedAt: at(-10),
        endedAt: at(100),
        durationMs: 110_000,
      },
      {
        id: 'live',
        name: null,
        recordingType: 'AUDIO_ONLY',
        status: 'RECORDING',
        startedAt: at(700),
        endedAt: null,
        durationMs: null,
      },
    ];
    const spans = buildRecordedSpans(sessions, origin);
    assert.deepEqual(
      spans.map(span => [span.recordingId, span.startSeconds, span.endSeconds, span.kind]),
      [
        ['a', 0, 100, 'audio'],
        ['b', 300, 600, 'video'],
      ],
    );
  });
});

describe('transcript parsing', () => {
  const text = [
    '[00:05] Ana: Hello everyone',
    'continuation without a timestamp',
    '[01:10] Ben: Let us decide on B',
    '',
    '[1:02:03] Ana: Wrapping up',
  ].join('\n');

  it('numbers timestamped lines like the backend segments', () => {
    const lines = parseTranscript(text);
    assert.equal(lines.length, 4);
    assert.deepEqual(
      lines.map(line => [line.segment, line.speaker]),
      [
        [1, 'Ana'],
        [null, null],
        [2, 'Ben'],
        [3, 'Ana'],
      ],
    );
  });

  it('parses MM:SS and HH:MM:SS', () => {
    assert.equal(parseTranscriptTimestamp('04:32'), 272);
    assert.equal(parseTranscriptTimestamp('1:04:32'), 3872);
    assert.equal(parseTranscriptTimestamp('soon'), null);
  });

  it('finds the line for a marker or citation', () => {
    const lines = parseTranscript(text);
    assert.equal(findIndexByTimeSeconds(lines, 80), 2);
    assert.equal(findIndexByTimeSeconds(lines, 1), 0);
    assert.equal(findTranscriptTargetIndex(lines, { segment: 3 }), 3);
    assert.equal(findTranscriptTargetIndex(lines, { segment: 99, timestampSeconds: 70 }), 2);
    assert.equal(findTranscriptTargetIndex(lines, {}), -1);
  });
});
