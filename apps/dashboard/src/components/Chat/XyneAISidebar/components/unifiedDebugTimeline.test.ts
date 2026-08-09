import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DebugArtifactBundle, DebugEventRecord } from '../utils/XyneAITypes';
import { mergeLiveDebugTimeline } from './unifiedDebugTimeline.ts';

const sessionStart: DebugEventRecord = {
  seq: 1,
  at: '2026-08-06T11:00:00.000Z',
  kind: 'session_start',
  data: { sessionId: 'run-1', task: 'Inspect JWT' },
};

void describe('mergeLiveDebugTimeline', () => {
  void it('merges live events into their persisted run without creating a duplicate run', () => {
    const persisted: DebugArtifactBundle = {
      conversationId: 'conversation-1',
      debugSession: null,
      debugEvents: null,
      runs: [
        {
          fileName: 'run-1.json',
          data: { sessionId: 'run-1', task: 'Inspect JWT', events: [sessionStart] },
        },
      ],
      subagents: [],
    };
    const thinking: DebugEventRecord = {
      seq: 2,
      at: '2026-08-06T11:00:01.000Z',
      kind: 'thinking',
      data: { text: 'Searching repository' },
    };

    const merged = mergeLiveDebugTimeline(persisted, [sessionStart, thinking], 'conversation-1');

    assert.ok(merged);
    assert.equal(merged.runs.length, 1);
    assert.equal(merged.debugSession, null);
    assert.deepEqual(
      (merged.runs[0]?.data['events'] as DebugEventRecord[]).map(event => event.kind),
      ['session_start', 'thinking'],
    );
  });

  void it('creates one structured active run before persistence is available', () => {
    const merged = mergeLiveDebugTimeline(null, [sessionStart], 'conversation-1');

    assert.ok(merged?.debugSession);
    assert.equal(merged?.runs.length, 0);
    assert.equal(merged?.debugSession?.['sessionId'], 'run-1');
    assert.equal(merged?.debugSession?.['task'], 'Inspect JWT');
  });

  void it('attaches live subagent events beneath their parent tool call', () => {
    const subagentEvent: DebugEventRecord = {
      seq: 3,
      at: '2026-08-06T11:00:02.000Z',
      kind: 'thinking',
      parentToolCallId: 'tool-1',
      subagentName: 'researcher',
      data: { task: 'Inspect auth implementation', text: 'Reading files' },
    };

    const merged = mergeLiveDebugTimeline(null, [sessionStart, subagentEvent], 'conversation-1');

    assert.equal(merged?.subagents.length, 1);
    assert.equal(merged?.subagents[0]?.data['parentSessionId'], 'run-1');
    assert.equal(merged?.subagents[0]?.data['parentToolCallId'], 'tool-1');
  });
});
