/**
 * What an ending says, and what it reports.
 *
 * Both ride in what the FINISH carries, which is what the conversation's own
 * cycle returns — so the runtime case reads the farewell and the result off a
 * finished run, the way whoever started it would.
 */
import { describe, it, expect } from 'vitest';
import type { WorkflowConfig } from '../../types/workflow-config.js';
import { createConversationalFlow } from '../create.js';
import { readConversationalFlow } from '../read.js';
import { readTranscript, readTurn } from '../turn.js';
import { conversationOn, harness, parked, seen } from '../testing.js';
import type { ConversationalFlow, Screen } from '../types.js';
import { addOption } from './options.js';
import { setEndMessage, setEndResult } from './endings.js';

const ANYONE = {} as never;
const read = (config: WorkflowConfig): ConversationalFlow => readConversationalFlow(config)!;
const screen = (config: WorkflowConfig, id: string): Screen => read(config).screens.find((s) => s.id === id)!;

describe('what an ending says and reports', () => {
  const { config: made } = createConversationalFlow({ title: 'Support' });

  it('says a farewell, and forgets it when asked to', () => {
    const next = setEndMessage(made, 'done', 'Thanks for getting in touch!');
    expect(screen(next, 'done').endMessage).toBe('Thanks for getting in touch!');
    expect(screen(next, 'done').endValue).toEqual({ outcome: 'done' });

    const silent = setEndMessage(next, 'done', '  ');
    expect(screen(silent, 'done').endMessage).toBeUndefined();
    expect(screen(silent, 'done').endValue).toEqual({ outcome: 'done' });
  });

  it('reports what the run should report, keeping the farewell beside it', () => {
    const spoken = setEndMessage(made, 'done', 'Thanks!');
    const next = setEndResult(spoken, 'done', { outcome: 'resolved', team: 'billing' });

    expect(screen(next, 'done').endValue).toEqual({ outcome: 'resolved', team: 'billing' });
    expect(screen(next, 'done').endMessage).toBe('Thanks!');
  });

  it('refuses a screen that does not end the conversation', () => {
    expect(() => setEndMessage(made, 'start', 'Bye')).toThrow(/isn’t a Finish screen/);
    expect(() => setEndResult(made, 'nowhere', {})).toThrow(/no screen/);
  });

  it('is what the finished run reports', async () => {
    const spoken = setEndMessage(made, 'done', 'Thanks for getting in touch!');
    const next = setEndResult(spoken, 'done', { outcome: 'resolved', team: 'billing' });
    // The starter flow has no option leading to its ending; give it one so the
    // conversation can reach it without anyone typing.
    const withExit = addOption(next, screen(next, 'start').prompts[0]!.id, { label: 'That’s all', screen: 'done' });

    const { runtime } = harness();
    const id = await conversationOn(runtime, withExit, {});
    const { nodePath } = await parked(runtime, id);
    await runtime.resume(ANYONE, id, { data: { action: 'approve', data: { choice: 'done' } } as never, nodePath });

    const run = await seen(runtime, id);
    const turn = readTurn(run);
    // COMPLETED: the conversation ran to its end rather than being cancelled.
    expect(turn.status).toBe('finished');
    // The farewell is the last thing said; the result is what the run reports.
    expect(turn.messages.at(-1)).toMatchObject({ source: 'flow', text: 'Thanks for getting in touch!' });
    expect(readTranscript(run).outcome).toMatchObject({ outcome: 'resolved', team: 'billing' });
  });
});
