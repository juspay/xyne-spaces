import { describe, expect, it } from 'vitest';
import {
  applyPropertyOps,
  buildDraftHistory,
  guardQuestions,
  serializeAnswers,
  type DraftQuestion,
  canvasFieldFor,
  fromDraftSchedule,
  readDraftEvents,
  removalPatch,
  plainInstructions,
  replaceSection,
  silentTurnReply,
  TOOLS_INSERT_BEFORE,
  toDraftSchedule,
  userOwnedFields,
} from './agentDraftStream';
import { EMPTY_CREATE_FORM } from './types';

describe('agentDraftStream', () => {
  it('reads SSE frames into typed events and keeps the unfinished tail', () => {
    const buffer =
      ': keepalive\n\n' +
      'event: identity\ndata: {"seq":1,"turnId":"t","name":"PR Digest"}\n\n' +
      'event: instructions.delta\ndata: {"seq":2,"text":"You are"}\n\n' +
      'event: ack\ndata: {"seq":3';
    const { events, rest } = readDraftEvents(buffer);
    expect(events).toEqual([
      { event: 'identity', seq: 1, turnId: 't', name: 'PR Digest' },
      { event: 'instructions.delta', seq: 2, text: 'You are' },
    ]);
    expect(rest).toBe('event: ack\ndata: {"seq":3');
  });

  it('points field.start at the right canvas field and row', () => {
    expect(canvasFieldFor('handle')).toEqual({ field: 'slug', hubRow: null });
    expect(canvasFieldFor('instructions')).toEqual({ field: 'systemPrompt', hubRow: null });
    expect(canvasFieldFor('tools')).toEqual({ field: 'tools', hubRow: 'mcp' });
    expect(canvasFieldFor('schedule')).toEqual({ field: 'schedule', hubRow: null });
  });

  it('tells the draft which fields the user owns', () => {
    expect(
      userOwnedFields({ name: true, systemPrompt: true, tools: false }, 'slug').sort(),
    ).toEqual(['handle', 'instructions', 'name']);
  });

  it('round-trips schedules between the canvas and the draft', () => {
    const once = {
      kind: 'once' as const,
      at: '2026-10-03T03:30:00.000Z',
      timezone: 'Asia/Kolkata',
      task: 'Post',
    };
    expect(fromDraftSchedule(toDraftSchedule(once)!)).toEqual(once);
    const repeat = { kind: 'repeat' as const, cron: '0 9 * * 1-5', timezone: 'UTC', task: '' };
    expect(toDraftSchedule(repeat)).toMatchObject({ kind: 'repeat', cron: '0 9 * * 1-5' });
    expect(toDraftSchedule(null)).toBeNull();
  });

  it('applies property ops by title, case-insensitively', () => {
    const current = [{ id: 'p1', type: 'text' as const, title: 'Priority', value: 'low' }];
    const next = applyPropertyOps(current, [
      { op: 'set', title: 'priority', type: 'text', value: 'high' },
      { op: 'set', title: 'Budget', type: 'number', value: '500' },
    ]);
    expect(next[0]).toEqual({ id: 'p1', type: 'text', title: 'Priority', value: 'high' });
    expect(next[1]).toMatchObject({ type: 'number', title: 'Budget', value: '500' });
    expect(applyPropertyOps(next, [{ op: 'remove', title: 'BUDGET' }])).toHaveLength(1);
  });

  it('removes subagents, skills and knowledge the draft asked to drop', () => {
    const form = {
      ...EMPTY_CREATE_FORM,
      tools: { ...EMPTY_CREATE_FORM.tools, subagents: ['spaces', 'research'] },
      selectedSkillIds: ['s1', 's2'],
      selectedKbResources: [{ collectionId: 'c1', fileId: null }],
    };
    expect(
      removalPatch(
        form,
        [
          { hub: 'subagent', id: 'research' },
          { hub: 'skill', id: 's1' },
          { hub: 'knowledge', id: 'c1' },
        ],
        null,
      ),
    ).toEqual({
      tools: { ...form.tools, subagents: ['spaces'] },
      selectedSkillIds: ['s2'],
      selectedKbResources: [],
    });
    expect(removalPatch(form, [], null)).toEqual({});
  });

  it('replaces a late tools section or appends it', () => {
    const prompt = 'You are x.\n## When to use each tool\n- old\n## Guardrails\n- never';
    const replaced = replaceSection(prompt, 'Tools', 'Tools\n- new');
    expect(replaced).toBe('You are x.\nTools\n- new\n## Guardrails\n- never');
    expect(replaceSection('You are x.', 'Extra', 'Extra\n- y')).toBe('You are x.\n\nExtra\n- y');
  });

  it('puts a plain tools section in place, before the rules when it is new', () => {
    const plain = 'You are x.\n\nHow you work\n1. A.\n2. B.\n\nRules\n- Never y.';
    const added = replaceSection(plain, 'Tools', 'Tools\n- Slack: post.', TOOLS_INSERT_BEFORE);
    expect(added).toBe(
      'You are x.\n\nHow you work\n1. A.\n2. B.\n\nTools\n- Slack: post.\n\nRules\n- Never y.',
    );
    expect(replaceSection(added, 'Tools', 'Tools\n- Jira: file.', TOOLS_INSERT_BEFORE)).toBe(
      'You are x.\n\nHow you work\n1. A.\n2. B.\n\nTools\n- Jira: file.\n\nRules\n- Never y.',
    );
  });

  it('keeps streamed instructions free of markdown symbols', () => {
    expect(plainInstructions('## Rules\n* **Never** post.\n- Ask __first__.\n1. Step')).toBe(
      'Rules\n- Never post.\n- Ask first.\n1. Step',
    );
    // A bold marker still being written stays as typed until it closes.
    expect(plainInstructions('Be **cal')).toBe('Be **cal');
    expect(plainInstructions('How you work\n\n1. Read.\n\nRules\n\n- Never guess.')).toBe(
      'How you work\n1. Read.\n\nRules\n- Never guess.',
    );
  });

  it('answers a turn that filled the canvas but sent no chat text', () => {
    expect(silentTurnReply('draft', ' Daily Digest Agent ')).toBe('Drafted Daily Digest Agent.');
    expect(silentTurnReply('draft', '')).toBe('Drafted the agent.');
    expect(silentTurnReply('edit', 'Daily Digest Agent')).toBe('Updated the canvas.');
    expect(silentTurnReply(null, '')).toBe('Updated the canvas.');
  });

  it("reads the chat's activity, suggestion and question events", () => {
    const buffer =
      'event: activity\ndata: {"seq":1,"turnId":"t","id":"search-1","kind":"search","status":"done","label":"Searched the web","sources":[{"title":"A","url":"https://a"}]}\n\n' +
      'event: suggestion\ndata: {"seq":2,"turnId":"t","suggestions":[{"id":"s1","label":"Add PR reviews","message":"Add a PR review step."}]}\n\n' +
      'event: question\ndata: {"seq":3,"turnId":"t","id":"t-q","questions":[]}\n\n';
    const { events } = readDraftEvents(buffer);
    expect(events.map(e => e.event)).toEqual(['activity', 'suggestion', 'question']);
    expect(events[0]).toMatchObject({
      status: 'done',
      sources: [{ title: 'A', url: 'https://a' }],
    });
  });

  const QUESTIONS: DraftQuestion[] = [
    {
      id: 'q1',
      label: 'Job',
      question: 'What should it do?',
      type: 'single_choice',
      options: [{ label: 'Review pull requests' }, { label: 'Daily digest' }],
    },
    {
      id: 'q2',
      label: 'Channels',
      question: 'Where should it post?',
      type: 'multiple_choice',
      options: [{ label: 'Slack' }, { label: 'Email' }],
    },
  ];

  it('turns card answers into one message, a sentence per question', () => {
    expect(
      serializeAnswers(
        QUESTIONS,
        { q1: 'Review pull requests', q2: ['Slack', 'Email'] },
        { q2: 'only #eng-releases.' },
      ),
    ).toBe('Job: Review pull requests. Channels: Slack, Email; only #eng-releases.');
    expect(serializeAnswers(QUESTIONS, { q1: 'Skip this question' }, { q2: 'Teams' })).toBe(
      'Job: you decide. Channels: Teams.',
    );
  });

  it('sends the last 12 turns and says which questions a card asked', () => {
    const messages = Array.from({ length: 15 }, (_v, i) => ({
      type: i % 2 === 0 ? ('user' as const) : ('bot' as const),
      content: `turn ${i}`,
    }));
    const withCard = [
      ...messages,
      { type: 'bot' as const, content: 'A couple of choices:', asked: QUESTIONS.slice(0, 1) },
      { type: 'bot' as const, content: '', failed: false },
      { type: 'user' as const, content: 'boom', failed: true },
    ];
    const history = buildDraftHistory(withCard);
    expect(history).toHaveLength(12);
    expect(history.at(-1)).toEqual({
      role: 'assistant',
      text: 'A couple of choices: (Asked: Job: Review pull requests / Daily digest)',
    });
  });

  it('only lets well-formed questions onto a card', () => {
    expect(guardQuestions(QUESTIONS)).toHaveLength(2);
    expect(
      guardQuestions([
        { id: 'q', label: 'X', question: '?', type: 'open_ended', options: [] },
        'x',
      ]),
    ).toEqual([]);
    expect(guardQuestions(null)).toEqual([]);
  });
});
