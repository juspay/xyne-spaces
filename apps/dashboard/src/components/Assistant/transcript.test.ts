import { describe, expect, it } from 'vitest';
import {
  chipWithLabel,
  chipsFor,
  isAssistantMessage,
  stageContent,
  toChatMessages,
  STARTERS,
  type AssistantTurn,
} from './transcript';

const at = new Date('2026-09-26T10:00:00Z');

describe('the assistant transcript', () => {
  it('turns a preview into Yes and Cancel buttons that answer yes and no', () => {
    expect(
      chipsFor({
        kind: 'preview',
        summary: 'Send “hi”',
        confirmLabel: 'Yes',
        cancelLabel: 'Cancel',
      }),
    ).toEqual([
      { id: 'yes', label: 'Yes' },
      { id: 'no', label: 'Cancel' },
    ]);
  });

  it('tells two people with the same name apart by their detail', () => {
    const chips = chipsFor({
      kind: 'choices',
      prompt: 'Which one?',
      options: [
        { id: 'u1', label: 'Daniel Park', detail: 'dp@x.io' },
        { id: 'u2', label: 'Daniel Park', detail: 'daniel.park@x.io' },
      ],
    });
    expect(chips.map(chip => chip.label)).toEqual([
      'Daniel Park · dp@x.io',
      'Daniel Park · daniel.park@x.io',
    ]);
  });

  it('shows turns as chat messages, and only the latest turn’s buttons are live', () => {
    const turns: AssistantTurn[] = [
      {
        id: '1',
        role: 'assistant',
        text: 'Public or private?',
        at,
        chips: [{ id: 'public', label: 'Public' }],
      },
      { id: '2', role: 'user', text: 'private', at },
    ];
    const messages = toChatMessages(turns);
    expect(messages[0]).toMatchObject({ type: 'bot', followUpSuggestions: ['Public'] });
    expect(messages.every(message => isAssistantMessage(message.id))).toBe(true);
    expect(chipWithLabel(turns, 'Public')).toBeUndefined();
  });

  it('starts with a starter for each area of the action list', () => {
    expect(stageContent([])).toEqual({
      prompt: 'What can I help with?',
      chips: STARTERS,
      caption: null,
      steps: [],
    });
    expect(STARTERS.map(chip => chip.label)).toEqual(['Send a direct message', 'Create a channel']);
    expect(STARTERS[0]?.text).toBe('Send a direct message');
  });

  it('shows a question with its own buttons', () => {
    const turns: AssistantTurn[] = [
      {
        id: '1',
        role: 'assistant',
        text: 'Send “hi” to Daniel?',
        at,
        chips: [{ id: 'yes', label: 'Yes' }],
      },
    ];
    expect(stageContent(turns)).toEqual({
      prompt: null,
      chips: [{ id: 'yes', label: 'Yes' }],
      caption: { text: 'Send “hi” to Daniel?', tone: 'default' },
      steps: [],
    });
  });

  it('always shows the reply, and offers starters again once it is done', () => {
    const done: AssistantTurn = { id: '1', role: 'assistant', text: 'Sent to Daniel.', at };
    expect(stageContent([done])).toMatchObject({
      prompt: 'Anything else?',
      chips: STARTERS,
      caption: { text: 'Sent to Daniel.', tone: 'default' },
    });
    const question: AssistantTurn = { ...done, text: 'What should I say?', expectsReply: true };
    expect(stageContent([question])).toMatchObject({
      chips: [],
      caption: { text: 'What should I say?' },
    });
    const failed: AssistantTurn = { ...done, text: 'That didn’t finish.', tone: 'error' };
    expect(stageContent([failed]).caption?.tone).toBe('error');
  });

  it('shows the running plan as a checklist, with no starters until it is done', () => {
    const running: AssistantTurn[] = [
      { id: '1', role: 'user', text: 'post hello in general', at },
      {
        id: '2',
        role: 'assistant',
        text: '',
        at,
        steps: [
          { label: 'Opened #general', status: 'done' },
          { label: 'Sending “hello”', status: 'running' },
        ],
      },
    ];
    expect(stageContent(running)).toMatchObject({ chips: [], prompt: null });
    expect(stageContent(running).steps).toHaveLength(2);
    expect(toChatMessages(running)[1]?.content).toBe('- ✓ Opened #general\n- … Sending “hello”');

    const finished: AssistantTurn[] = [
      running[0]!,
      {
        ...running[1]!,
        steps: [
          { label: 'Opened #general', status: 'done' },
          { label: 'Sent “hello”', status: 'done' },
        ],
      },
      { id: '3', role: 'assistant', text: 'Posted in general.', at },
    ];
    expect(stageContent(finished)).toMatchObject({ prompt: 'Anything else?', chips: STARTERS });
    expect(stageContent(finished).steps).toHaveLength(2);
  });
});
