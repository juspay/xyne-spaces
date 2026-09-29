import { ACTIONS, type Draft, type EntityKind } from '@xyne/shared/assistant';
import type { JevAnswer } from '@/services/queryIntent/jevClient';
import { createBreaker } from './breaker';
import { piecesWereCut, readingFor, sentencePieces, type FieldReading } from './fields';
import { decideIntent, readSentence } from './intent';
import { quickChoice, quickText } from './quickReplies';
import { matchName, type FoundRecord } from './records';
import { EMPTY_SESSION, parseSession, serializeSession, type OpenQuestion } from './session';

const visibility: OpenQuestion = {
  kind: 'detail',
  field: 'visibility',
  options: [
    { id: 'public', label: 'Public' },
    { id: 'private', label: 'Private' },
  ],
};

function emptyDraft(action: string): Draft {
  return {
    id: 'd1',
    action,
    values: {},
    unsure: [],
    open: [],
    later: [],
    offered: [],
    awaiting: null,
  };
}

describe('quick replies (no model)', () => {
  it('answers a question on screen from a word, a number, or a label', () => {
    expect(quickText('Yes, please', { kind: 'preview' })).toEqual({
      kind: 'event',
      event: { type: 'yes' },
    });
    expect(quickText('no', visibility)).toEqual({ kind: 'event', event: { type: 'no' } });
    expect(quickText('the second one', visibility)).toEqual({
      kind: 'event',
      event: { type: 'choose', optionId: 'private' },
    });
    expect(quickText('Private.', visibility)).toEqual({
      kind: 'event',
      event: { type: 'choose', optionId: 'private' },
    });
  });

  it('picks an option on screen before reading the words as yes or no', () => {
    const team: OpenQuestion = {
      kind: 'detail',
      field: 'team',
      options: [
        { id: 'none', label: 'None' },
        { id: 'design', label: 'Design' },
      ],
    };
    expect(quickText('none', team)).toEqual({
      kind: 'event',
      event: { type: 'choose', optionId: 'none' },
    });
  });

  it('cancels at any time, even with no question on screen', () => {
    expect(quickText('never mind', null)).toEqual({ kind: 'event', event: { type: 'cancel' } });
  });

  it('leaves everything else to the intent model', () => {
    expect(quickText('yes', null)).toBeNull();
    expect(quickText('message Priya hi', visibility)).toBeNull();
    expect(quickText('3', visibility)).toBeNull();
  });

  it('turns a "which action?" button into that action', () => {
    const question: OpenQuestion = {
      kind: 'action',
      options: [{ id: 'send_dm', label: 'Send a direct message' }],
      text: 'hi Priya',
    };
    expect(quickChoice('send_dm', question)).toEqual({ kind: 'pick-action', action: 'send_dm' });
    expect(quickChoice('create_channel', question)).toBeNull();
  });
});

describe('matching a spoken name to records', () => {
  const person = (id: string, name: string, detail?: string): FoundRecord => ({
    record: { kind: 'person', id, name },
    ...(detail ? { detail } : {}),
  });
  const people = [
    person('1', 'Daniel Okafor', 'daniel@x.io'),
    person('2', 'Daniel Park', 'dpark@x.io'),
    person('3', 'Priya Shah'),
  ];

  it('prefers the full name, and counts only an exact match as certain', () => {
    expect(matchName('Daniel Okafor', people)).toMatchObject({ kind: 'one', certain: true });
    expect(matchName('priya', people)).toMatchObject({
      kind: 'one',
      record: { id: '3' },
      certain: false,
    });
  });

  it('asks which one when names tie, telling them apart', () => {
    expect(matchName('Daniel', people)).toEqual({
      kind: 'several',
      candidates: [
        { id: '1', label: 'Daniel Okafor', detail: 'daniel@x.io', value: people[0]?.record },
        { id: '2', label: 'Daniel Park', detail: 'dpark@x.io', value: people[1]?.record },
      ],
    });
  });

  it('finds a name spelled the way it sounds, but never counts it as certain', () => {
    const team = [
      person('4', 'Preeti Sharma', 'preeti@x.io'),
      person('5', 'Prisha Rao'),
      person('6', 'Xyne Doctor'),
    ];
    expect(matchName('Priti', team)).toMatchObject({
      kind: 'one',
      record: { id: '4' },
      certain: false,
    });
    expect(matchName('priti sharma', team)).toMatchObject({ kind: 'one', record: { id: '4' } });
    expect(matchName('Preeti Sharma', team)).toMatchObject({ kind: 'one', certain: true });
    expect(matchName('Zyne', team)).toMatchObject({
      kind: 'one',
      certain: false,
      record: { id: '6' },
    });
    expect(matchName('Priya', team)).toEqual({ kind: 'none' });
    expect(matchName('Alistair', team)).toEqual({ kind: 'none' });
  });

  it('asks which one when two names sound alike', () => {
    const team = [person('4', 'Preeti Sharma'), person('6', 'Priti Verma')];
    expect(matchName('Preetee', team)).toMatchObject({ kind: 'several' });
    expect(matchName('Priti Sharma', team)).toMatchObject({
      kind: 'one',
      record: { id: '4' },
      certain: false,
    });
  });

  it('treats hyphens and spaces in channel names alike', () => {
    const channel: FoundRecord = { record: { kind: 'channel', id: 'c', name: 'release-planning' } };
    expect(matchName('Release Planning', [channel])).toMatchObject({ kind: 'one', certain: true });
    expect(matchName('Zorro', people)).toEqual({ kind: 'none' });
  });
});

describe('choosing the action', () => {
  const choice = (probabilities: Record<string, number>): JevAnswer => {
    const [best] = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);
    return {
      type: 'choice',
      choice: best?.[0] ?? 'none',
      confidence: best?.[1] ?? 0,
      probabilities,
    };
  };

  it('asks the kind, the action, and every action’s details, all in one request', () => {
    const { questions, state } = readSentence('tell Priya hi', ACTIONS, { draft: null });
    expect(Object.keys(questions)).toEqual(
      expect.arrayContaining([
        'kind',
        'action',
        'send_dm.recipient',
        'send_dm.message',
        'create_channel.name',
      ])
    );
    expect(questions.continues).toBeUndefined();
    expect(questions.action?.type === 'choice' && Object.keys(questions.action.criteria)).toEqual([
      ...[...ACTIONS.values()].map((action) => action.id),
      'none',
    ]);
    expect(state).toEqual({ request: 'tell Priya hi' });
  });

  it('gives Jev the channel on screen and the question on screen', () => {
    const { questions, state } = readSentence('ABC', ACTIONS, {
      draft: { ...emptyDraft('create_channel'), awaiting: { kind: 'field', field: 'name' } },
      screen: 'design',
    });
    expect(questions.continues?.type).toBe('noul');
    expect(state).toEqual({
      request: 'ABC',
      screen: { channel: 'design' },
      inProgress: { request: 'create_channel', question: 'What should I name the channel?' },
    });
  });

  it('shows the matches on screen when a search asks which one', () => {
    const { state } = readSentence('open the Android one', ACTIONS, {
      draft: {
        ...emptyDraft('find_conversation'),
        awaiting: { kind: 'field', field: 'conversation' },
        open: [
          {
            field: 'conversation',
            said: 'mobile performance',
            options: [
              {
                id: 'thread-1',
                label: 'Android startup delay',
                detail: '#android · Vinit',
                value: {
                  kind: 'thread',
                  id: 'thread-1',
                  name: 'Android startup delay',
                  channelId: 'channel-android',
                  channelName: 'android',
                },
              },
            ],
          },
        ],
      },
    });
    expect(state).toMatchObject({
      inProgress: {
        openField: { field: 'conversation', said: 'mobile performance' },
        question:
          'Here are the closest matches for “mobile performance”. Tap one, or tell me who was in it or which channel.',
        options: ['Android startup delay · #android · Vinit'],
      },
    });
  });

  it('ranks actions by Jev’s probability and reads the chosen action’s details', () => {
    const reading = readSentence('tell Priya hi', ACTIONS, { draft: null });
    const priya = `p${sentencePieces('tell Priya hi').indexOf('Priya')}`;
    const heard = reading.read({
      kind: choice({ action: 0.9, question: 0.1 }),
      action: choice({ send_dm: 0.9, post_message: 0.05, none: 0.05 }),
      'send_dm.recipient': choice({ [priya]: 0.8, none: 0.2 }),
    });
    expect(heard.ranked[0]).toEqual({ action: 'send_dm', probability: 0.9 });
    expect(heard.decision).toEqual({ kind: 'act', action: 'send_dm' });
    expect(heard.words(ACTIONS.get('send_dm')!)).toEqual({ recipient: 'Priya' });
  });

  it('asks "did you mean" when two actions are close, and says none when nothing fits', () => {
    const close = [
      { action: 'send_dm', probability: 0.45 },
      { action: 'create_channel', probability: 0.4 },
    ];
    expect(decideIntent(close)).toEqual({ kind: 'ask', actions: ['send_dm', 'create_channel'] });
    expect(decideIntent([{ action: 'send_dm', probability: 0.1 }])).toEqual({ kind: 'none' });
  });

  it('does not act on a lone candidate below the clear-winner threshold', () => {
    expect(decideIntent([{ action: 'send_dm', probability: 0.35 }])).toEqual({ kind: 'none' });
  });
});

describe('reading details from the sentence', () => {
  const picked = (choice: string): JevAnswer => ({
    type: 'choice',
    choice,
    confidence: 0.9,
    probabilities: { [choice]: 0.9 },
  });
  /** The option id Jev would answer with to pick `piece` for `field`. */
  const optionFor = (reading: FieldReading, field: string, piece: string): string => {
    const question = reading.questions[field];
    const criteria = question?.type === 'choice' ? question.criteria : {};
    return Object.entries(criteria).find(([, text]) => text === `“${piece}”`)?.[0] ?? 'none';
  };

  /** The options of the question for `field`, by option id. */
  const criteriaOf = (reading: FieldReading, field: string): Record<string, string> => {
    const question = reading.questions[field];
    return question?.type === 'choice' ? question.criteria : {};
  };
  const LONG_SENTENCE =
    'in the design review channel mention Daniel Okafor and Priya Shah to check the crash on the new android build today';

  it('offers only runs of words that do not start or end on a framing word', () => {
    const pieces = sentencePieces('Message Arjun, I will pick it up later');
    expect(pieces).toContain('Arjun');
    expect(pieces).toContain('I will pick it up later');
    expect(pieces).not.toContain('Message Arjun');
    expect(pieces.some((piece) => piece.endsWith(','))).toBe(false);
    expect(sentencePieces('create a channel')).toEqual([]);
  });

  it('asks one question per field and returns the words picked', () => {
    const sendDm = ACTIONS.get('send_dm')!;
    const reading = readingFor(sendDm, 'tell Priya the build is green');
    expect(Object.keys(reading.questions)).toEqual(['recipient', 'message']);
    const answers = {
      recipient: picked(optionFor(reading, 'recipient', 'Priya')),
      message: picked(optionFor(reading, 'message', 'the build is green')),
    };
    expect(reading.read(answers)).toEqual({ recipient: 'Priya', message: 'the build is green' });
    expect(reading.read({ recipient: picked('none'), message: picked('none') })).toEqual({});
  });

  it('answers a choice field with an option, and splits several members', () => {
    const createChannel = ACTIONS.get('create_channel')!;
    const reading = readingFor(createChannel, 'make a private channel for Priya and Daniel');
    const members = optionFor(reading, 'members', 'Priya and Daniel');
    expect(reading.read({ visibility: picked('private'), members: picked(members) })).toEqual({
      visibility: 'private',
      members: ['Priya', 'Daniel'],
    });
  });

  it('skips a field when the sentence has no words it could be', () => {
    const reading = readingFor(ACTIONS.get('create_channel')!, 'create a channel');
    expect(Object.keys(reading.questions)).toEqual(['visibility']);
  });

  it('does not reuse a channel name as its first message', () => {
    const reading = readingFor(ACTIONS.get('create_channel')!, 'call it ops weekly');
    const sameWords = optionFor(reading, 'name', 'ops weekly');

    expect(
      reading.read({
        name: picked(sameWords),
        visibility: picked('none'),
        members: picked('none'),
        firstMessage: picked(sameWords),
      })
    ).toEqual({ name: 'ops weekly' });
  });

  it('preserves the reply body when its words overlap with the thread topic', () => {
    const reading = readingFor(ACTIONS.get('reply_in_thread')!, 'reply here saying looks good');
    const sameWords = optionFor(reading, 'thread', 'looks good');

    expect(
      reading.read({
        thread: picked(sameWords),
        mentions: picked('none'),
        message: picked(optionFor(reading, 'message', 'looks good')),
      })
    ).toEqual({ thread: 'looks good', message: 'looks good' });
  });

  it('offers the open thread as a destination without treating it as message text', () => {
    const reading = readingFor(ACTIONS.get('reply_in_thread')!, 'reply here saying looks good', {
      onScreen: new Set<EntityKind>(['thread']),
    });
    const threadQuestion = reading.questions.thread;
    const threadChoice =
      threadQuestion?.type === 'choice'
        ? Object.keys(threadQuestion.criteria).find((id) => id === 'current_thread')
        : undefined;

    expect(
      reading.read({
        thread: picked(threadChoice ?? 'none'),
        message: picked(optionFor(reading, 'message', 'looks good')),
      })
    ).toEqual({ thread: 'this thread', message: 'looks good' });
  });

  it('offers the open thread to the thread field only, with the field’s own text', () => {
    const reading = readingFor(ACTIONS.get('reply_in_thread')!, 'reply here saying looks good', {
      onScreen: new Set<EntityKind>(['thread']),
    });

    expect(criteriaOf(reading, 'thread')).toMatchObject({
      current_thread:
        'the thread already open on screen, when the user means “here” or asks an agent to act there without naming another thread',
    });
    const threadOptions = Object.keys(criteriaOf(reading, 'thread'));
    expect(threadOptions.slice(-2)).toEqual(['current_thread', 'none']);
    expect(criteriaOf(reading, 'mentions')).not.toHaveProperty('current_thread');
    expect(criteriaOf(reading, 'message')).not.toHaveProperty('current_thread');
  });

  it('offers nothing on screen to a field that does not ask for it', () => {
    const reading = readingFor(ACTIONS.get('post_message')!, 'say hello here', {
      onScreen: new Set<EntityKind>(['thread']),
    });
    const options = Object.keys(reading.questions).flatMap((field) =>
      Object.keys(criteriaOf(reading, field))
    );

    expect(options.length).toBeGreaterThan(0);
    expect(options.filter((option) => option.startsWith('current_'))).toEqual([]);
  });

  it.each([
    'summarize this channel',
    'review this message',
    'explain who I should talk to',
  ])('preserves a message body ending in a framing word: %s', (message) => {
    const reading = readingFor(ACTIONS.get('reply_in_thread')!, message);
    const selected = optionFor(reading, 'message', message);

    expect(reading.read({ message: picked(selected) })).toEqual({ message });
  });

  it('cuts a long sentence to 51 pieces, unless the details are read on their own', () => {
    const postMessage = ACTIONS.get('post_message')!;
    const names = 'Daniel Okafor and Priya Shah';

    expect(sentencePieces(LONG_SENTENCE)).toHaveLength(51);
    expect(piecesWereCut(postMessage, LONG_SENTENCE)).toBe(true);
    expect(optionFor(readingFor(postMessage, LONG_SENTENCE), 'mentions', names)).toBe('none');

    const everything = readingFor(postMessage, LONG_SENTENCE, { every: true });
    expect(optionFor(everything, 'mentions', names)).not.toBe('none');
    expect(Object.keys(criteriaOf(everything, 'message')).length).toBeLessThanOrEqual(255);
  });

  it('asks the same questions with or without every piece when none were cut', () => {
    const text = 'tell Priya hi';

    for (const action of ACTIONS.values()) {
      expect(piecesWereCut(action, text)).toBe(false);
      expect(readingFor(action, text, { every: true }).questions).toEqual(
        readingFor(action, text).questions
      );
    }
  });

  it('removes an explicitly added member from the channel name', () => {
    const reading = readingFor(
      ACTIONS.get('create_channel')!,
      'new private channel called hiring with Meera Iyer'
    );

    expect(
      reading.read({
        name: picked(optionFor(reading, 'name', 'hiring with Meera Iyer')),
        visibility: picked('private'),
        members: picked(optionFor(reading, 'members', 'Meera Iyer')),
      })
    ).toEqual({ name: 'hiring', visibility: 'private', members: ['Meera Iyer'] });
  });
});

describe('the stored session', () => {
  it('round-trips, and starts fresh from anything unreadable or from another version', () => {
    expect(parseSession(serializeSession(EMPTY_SESSION))).toEqual(EMPTY_SESSION);
    expect(parseSession(null)).toBe(EMPTY_SESSION);
    expect(parseSession('not json')).toBe(EMPTY_SESSION);
    expect(parseSession(JSON.stringify({ ...EMPTY_SESSION, version: 2 }))).toBe(EMPTY_SESSION);
  });

  it('round-trips a populated draft, question, candidate, and pending run', () => {
    const person = { kind: 'person' as const, id: 'u-1', name: 'Priya Shah' };
    const session = {
      ...EMPTY_SESSION,
      conversation: {
        ...EMPTY_SESSION.conversation,
        seq: 1,
        active: {
          ...emptyDraft('create_channel'),
          values: { members: [person] },
          unsure: ['members'],
          open: [
            {
              field: 'members',
              said: 'Priya',
              options: [{ id: person.id, label: person.name, value: person }],
            },
          ],
          later: [{ field: 'members', said: 'Meera' }],
          offered: ['members'],
          awaiting: { kind: 'field' as const, field: 'visibility' },
        },
      },
      question: {
        kind: 'detail' as const,
        field: 'visibility',
        options: [
          { id: 'public', label: 'Public' },
          { id: 'private', label: 'Private' },
        ],
      },
      run: {
        runId: 'run-1',
        action: 'create_channel',
        expectedResults: 2,
        done: 'Created the channel.',
      },
    };

    expect(parseSession(serializeSession(session))).toEqual(session);
  });

  it('starts fresh when nested conversation, reference, question, or run data is malformed', () => {
    const invalidActive: unknown = {
      ...EMPTY_SESSION,
      conversation: { ...EMPTY_SESSION.conversation, active: {} },
    };
    const oldVersion: unknown = {
      ...EMPTY_SESSION,
      conversation: { ...EMPTY_SESSION.conversation, version: 1 },
    };
    const invalidCandidateRef: unknown = {
      ...EMPTY_SESSION,
      conversation: {
        ...EMPTY_SESSION.conversation,
        active: {
          ...emptyDraft('create_channel'),
          open: [
            {
              field: 'members',
              said: 'Priya',
              options: [
                {
                  id: 'w-1',
                  label: 'Workspace',
                  value: { kind: 'workspace', id: 'w-1', name: 'Workspace' },
                },
              ],
            },
          ],
        },
      },
    };
    const invalidQuestion: unknown = {
      ...EMPTY_SESSION,
      question: { kind: 'detail', field: 'visibility', options: [{ id: 'public' }] },
    };
    const invalidRun: unknown = {
      ...EMPTY_SESSION,
      run: { runId: 'run-1', action: 'send_dm', done: 'Sent.', expectedResults: 'three' },
    };

    for (const value of [
      invalidActive,
      oldVersion,
      invalidCandidateRef,
      invalidQuestion,
      invalidRun,
    ]) {
      expect(parseSession(JSON.stringify(value))).toEqual(EMPTY_SESSION);
    }
  });

  it('rejects a stored session that exceeds the byte limit', () => {
    const oversized = {
      ...EMPTY_SESSION,
      run: { runId: 'run-1', action: 'send_dm', expectedResults: 1, done: '🙂'.repeat(17_000) },
    };

    expect(Buffer.byteLength(JSON.stringify(oversized), 'utf8')).toBeGreaterThan(64 * 1024);
    expect(parseSession(JSON.stringify(oversized))).toEqual(EMPTY_SESSION);
  });
});

describe('pausing a failing service', () => {
  it('pauses after repeated failures, and a success resets the count', () => {
    const breaker = createBreaker(3, 30_000);
    breaker.record(false, 0);
    breaker.record(false, 0);
    breaker.record(true, 0);
    breaker.record(false, 0);
    breaker.record(false, 0);
    expect(breaker.allows(0)).toBe(true);
    breaker.record(false, 1_000);
    expect(breaker.allows(1_000)).toBe(false);
    expect(breaker.allows(31_000)).toBe(true);
  });

  it('pauses again at once when the first try after a pause fails', () => {
    const breaker = createBreaker(3, 30_000);
    for (let i = 0; i < 3; i += 1) breaker.record(false, 0);
    breaker.record(false, 30_000);
    expect(breaker.allows(30_001)).toBe(false);
  });
});
