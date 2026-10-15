import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseBriefSse } from '@/src/features/morning-brief/api/parseBriefSse';

const COMPLETE_STREAM = [
  'event: start',
  'data: {"date":"2026-09-01"}',
  '',
  ':ka',
  '',
  'event: progress',
  'data: {"label":"Gathering your day…"}',
  '',
  'event: complete',
  'data: {"content":"# Brief","brief":{"date":"2026-09-01","generated_for":"u1","what_needs_you":["x"],"overdue":[],"waiting_on_others":[],"assigned_to_you":[],"todays_schedule":[]}}',
  '',
].join('\n');

describe('parseBriefSse', () => {
  it('replays a complete stream into date, content and brief', () => {
    const result = parseBriefSse(COMPLETE_STREAM);
    assert.equal(result.sawComplete, true);
    assert.equal(result.date, '2026-09-01');
    assert.equal(result.content, '# Brief');
    assert.equal(result.brief?.what_needs_you[0], 'x');
    assert.equal(result.error, undefined);
  });

  it('surfaces an error frame when no complete follows', () => {
    const result = parseBriefSse(
      ['event: error', 'data: {"message":"Agent unavailable"}', ''].join('\n'),
    );
    assert.equal(result.sawComplete, false);
    assert.equal(result.error, 'Agent unavailable');
  });

  it('ignores keepalive comments and malformed data lines', () => {
    const result = parseBriefSse([':ka', 'data: not-json', 'event: start', 'data: {}'].join('\n'));
    assert.equal(result.sawComplete, false);
    assert.equal(result.error, undefined);
  });

  it('joins multi-line data frames before parsing (SSE spec)', () => {
    const result = parseBriefSse(
      [
        'event: complete',
        'data: {"content":"# Brief",',
        'data: "brief":{"date":"2026-09-01","generated_for":"u1","what_needs_you":["x"],',
        'data: "overdue":[],"waiting_on_others":[],"assigned_to_you":[],"todays_schedule":[]}}',
        '',
      ].join('\n'),
    );
    assert.equal(result.sawComplete, true);
    assert.equal(result.content, '# Brief');
    assert.equal(result.brief?.what_needs_you[0], 'x');
  });

  it('reports sawComplete=false for a body truncated before any complete frame', () => {
    const result = parseBriefSse(
      [
        'event: start',
        'data: {"date":"2026-09-01"}',
        '',
        'event: progress',
        'data: {"label":"…"',
      ].join('\n'),
    );
    assert.equal(result.sawComplete, false);
    assert.equal(result.error, undefined);
  });

  it('dispatches the final event even without a trailing blank line', () => {
    const result = parseBriefSse(['event: complete', 'data: {"content":"ok"}'].join('\n'));
    assert.equal(result.sawComplete, true);
    assert.equal(result.content, 'ok');
  });

  it('lets a complete supersede an earlier transient error', () => {
    const result = parseBriefSse(
      [
        'event: error',
        'data: {"message":"blip"}',
        '',
        'event: complete',
        'data: {"content":"ok"}',
        '',
      ].join('\n'),
    );
    assert.equal(result.sawComplete, true);
    assert.equal(result.error, undefined);
  });
});
