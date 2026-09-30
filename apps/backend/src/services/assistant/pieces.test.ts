import {
  ACTIONS,
  type Draft,
  type EntityKind,
  type EntityRef,
  type PersonRef,
  type Plan,
} from '@xyne/shared/assistant';
import type { JevAnswer } from '@/services/queryIntent/jevClient';
import { createBreaker } from './breaker';
import { isLongSentence, readingFor, sentencePieces, type FieldReading } from './fields';
import { decideIntent, readSentence } from './intent';
import { quickChoice, quickText } from './quickReplies';
import {
  isNotAName,
  isOnScreen,
  matchFound,
  matchName,
  pointsBack,
  withScreen,
  type FoundRecord,
  type RecordFinder,
} from './records';
import {
  EMPTY_SESSION,
  parseSession,
  refsInPlan,
  remember,
  serializeSession,
  type OpenQuestion,
} from './session';

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

describe('words that point back at someone just talked about', () => {
  const danielRef: PersonRef = { kind: 'person', id: 'u-daniel', name: 'Daniel Okafor' };
  const daniel: FoundRecord = { record: danielRef, detail: 'daniel@x.io' };
  const android: FoundRecord = {
    record: { kind: 'channel', id: 'c-android', name: 'android' },
    detail: '#android',
  };
  const dm: FoundRecord = {
    record: { kind: 'channel', id: 'c-dm', name: 'dm' },
    partner: danielRef,
  };
  const stranger: FoundRecord = { record: { kind: 'person', id: 'u-stranger', name: 'Stranger' } };

  /** Reads by id from `known`; a search finds only the stranger. */
  const finderOf = (known: FoundRecord[]): RecordFinder => ({
    find: async () => [stranger],
    get: async (kind, id) =>
      known.find(({ record }) => record.kind === kind && record.id === id) ?? null,
  });

  it('knows which words point back, for which kind of record', () => {
    for (const word of ['him', 'Her', 'them', 'that person', 'the same person']) {
      expect(pointsBack('person', word)).toBe(true);
      expect(pointsBack('channel', word)).toBe(false);
      expect(isOnScreen(word)).toBe(false);
    }
    for (const word of ['there', 'That channel', 'the same channel']) {
      expect(pointsBack('channel', word)).toBe(true);
      expect(pointsBack('person', word)).toBe(false);
      expect(isOnScreen(word)).toBe(false);
    }
    expect(pointsBack('person', 'Daniel')).toBe(false);
    expect(pointsBack('thread', 'him')).toBe(false);
  });

  it('tells a word that points from a name', () => {
    for (const word of ['here', 'this channel', 'him', 'there']) {
      expect(isNotAName(word)).toBe(true);
    }
    expect(isNotAName('Daniel')).toBe(false);
  });

  it('takes "him" to be the person of the last actions, read again for access', async () => {
    const recent = [android.record, daniel.record];

    const found = await withScreen(finderOf([android, daniel]), [], recent).find('person', 'him');
    const gone = await withScreen(finderOf([android]), [], recent).find('person', 'him');

    expect(found).toEqual([daniel]);
    expect(gone).toEqual([]);
  });

  it('takes "there" to be the channel of the last actions, and never a person', async () => {
    const finder = finderOf([android, daniel]);

    const both = withScreen(finder, [], [daniel.record, android.record]);
    const onlyPerson = withScreen(finder, [], [daniel.record]);

    expect(await both.find('channel', 'there')).toEqual([android]);
    expect(await onlyPerson.find('channel', 'there')).toEqual([]);
    // Asked for a person, "there" is only a name to search for.
    expect(await both.find('person', 'there')).toEqual([stranger]);
  });

  it('takes "him" to be the other person of the DM on screen', async () => {
    const shown: EntityRef[] = [{ kind: 'channel', id: 'c-dm', name: '' }];

    const found = await withScreen(finderOf([dm, daniel]), shown).find('person', 'him');
    const gone = await withScreen(finderOf([dm]), shown).find('person', 'him');

    expect(found).toEqual([daniel]);
    expect(gone).toEqual([]);
  });

  it('prefers the person of the last actions to the DM on screen', async () => {
    const priya: FoundRecord = { record: { kind: 'person', id: 'u-priya', name: 'Priya Shah' } };
    const shown: EntityRef[] = [{ kind: 'channel', id: 'c-dm', name: '' }];
    const finder = withScreen(finderOf([dm, daniel, priya]), shown, [priya.record]);

    expect(await finder.find('person', 'her')).toEqual([priya]);
  });

  it('finds no one for "him" with nobody talked about and no DM on screen', async () => {
    const notDirect: EntityRef[] = [{ kind: 'channel', id: 'c-android', name: '' }];

    expect(await withScreen(finderOf([daniel]), []).find('person', 'him')).toEqual([]);
    expect(await withScreen(finderOf([android]), notDirect).find('person', 'him')).toEqual([]);
  });

  it('still takes "here" to be the channel on screen, with its shown name', async () => {
    const shown: EntityRef[] = [{ kind: 'channel', id: 'c-android', name: 'Android team' }];
    const finder = withScreen(finderOf([android]), shown, [android.record]);

    expect(await finder.find('channel', 'here')).toEqual([
      { ...android, record: { ...android.record, name: 'Android team' } },
    ]);
  });

  it('is never certain about a word that points back, so the user sees the name first', () => {
    expect(matchFound('person', 'him', [daniel])).toEqual({
      kind: 'one',
      record: daniel.record,
      certain: false,
    });
    expect(matchFound('channel', 'there', [android])).toEqual({
      kind: 'one',
      record: android.record,
      certain: false,
    });
    expect(matchFound('person', 'him', [])).toEqual({ kind: 'none' });
    expect(matchFound('person', 'Daniel Okafor', [daniel])).toMatchObject({ certain: true });
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

  it('does not post the channel’s name as the message', () => {
    const reading = readingFor(ACTIONS.get('post_message')!, 'post in design');
    const design = optionFor(reading, 'channel', 'design');

    expect(
      reading.read({
        channel: picked(design),
        mentions: picked('none'),
        message: picked(optionFor(reading, 'message', 'design')),
      })
    ).toEqual({ channel: 'design' });
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

  it.each(['summarize this channel', 'review this message', 'explain who I should talk to'])(
    'preserves a message body ending in a framing word: %s',
    (message) => {
      const reading = readingFor(ACTIONS.get('reply_in_thread')!, message);
      const selected = optionFor(reading, 'message', message);

      expect(reading.read({ message: picked(selected) })).toEqual({ message });
    }
  );

  it('cuts a long sentence to 51 pieces, unless the details are read on their own', () => {
    const postMessage = ACTIONS.get('post_message')!;
    const names = 'Daniel Okafor and Priya Shah';

    expect(sentencePieces(LONG_SENTENCE)).toHaveLength(51);
    expect(isLongSentence(LONG_SENTENCE)).toBe(true);
    expect(optionFor(readingFor(postMessage, LONG_SENTENCE), 'mentions', names)).toBe('none');

    const everything = readingFor(postMessage, LONG_SENTENCE, { every: true });
    expect(optionFor(everything, 'mentions', names)).not.toBe('none');
    expect(Object.keys(criteriaOf(everything, 'message')).length).toBeLessThanOrEqual(255);
  });

  it('asks the same questions with or without every piece when none were cut', () => {
    const text = 'tell Priya hi';
    expect(isLongSentence(text)).toBe(false);

    for (const action of ACTIONS.values()) {
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
      recent: [person],
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

  it('loads a session saved before it remembered people, keeping the conversation', () => {
    const saved = {
      version: 1,
      conversation: { ...EMPTY_SESSION.conversation, seq: 3, active: emptyDraft('send_dm') },
      question: null,
      run: null,
    };

    expect(parseSession(JSON.stringify(saved))).toEqual({ ...saved, recent: [] });
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

describe('remembering who was just talked about', () => {
  const priya = { kind: 'person' as const, id: 'u-priya', name: 'Priya Shah' };
  const daniel = { kind: 'person' as const, id: 'u-daniel', name: 'Daniel Okafor' };
  const design = { kind: 'channel' as const, id: 'c-design', name: 'design' };
  const thread = {
    kind: 'thread' as const,
    id: 't-1',
    name: 'Release notes',
    channelId: 'c-design',
    channelName: 'design',
  };
  const message = {
    kind: 'message' as const,
    id: 'm-1',
    name: 'Ship it',
    channelId: 'c-design',
  };
  const people = (count: number): EntityRef[] =>
    Array.from({ length: count }, (_, index) => ({
      kind: 'person' as const,
      id: `u-${index}`,
      name: `Person ${index}`,
    }));

  it('puts the newest first, in the order given', () => {
    expect(remember([daniel], [priya, design])).toEqual([priya, design, daniel]);
    expect(remember([], [])).toEqual([]);
  });

  it('keeps a record once, as the newer one', () => {
    const renamed = { ...priya, name: 'Priya S.' };
    expect(remember([daniel, priya], [renamed])).toEqual([renamed, daniel]);
    // The same id under another kind is another record.
    expect(remember([{ ...design, id: 'x' }], [{ ...priya, id: 'x' }])).toHaveLength(2);
  });

  it('does not remember threads or messages', () => {
    expect(remember([], [thread, message, design])).toEqual([design]);
    expect(remember([thread], [message])).toEqual([]);
  });

  it('keeps only the newest six', () => {
    const older = people(6);
    expect(remember([], people(8))).toEqual(people(6));
    expect(remember(older, [priya])).toEqual([priya, ...older.slice(0, 5)]);
  });

  it('collects the people and channels a plan names, in order', () => {
    const plan: Plan = [
      { op: 'open_or_create_dm', user: daniel },
      { op: 'navigate', target: { fromStep: 0 } },
      { op: 'send_message', target: { fromStep: 0 }, text: 'hello' },
      { op: 'send_message', target: design, text: 'hi', mentions: [priya] },
      { op: 'send_message', target: thread, text: 'thanks' },
    ];
    expect(refsInPlan(plan)).toEqual([daniel, design, priya, thread]);
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
