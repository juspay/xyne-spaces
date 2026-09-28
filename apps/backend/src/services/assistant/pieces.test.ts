import { ACTIONS } from '@xyne/shared/assistant';
import type { JevAnswer } from '@/services/queryIntent/jevClient';
import { createBreaker } from './breaker';
import { readingFor, sentencePieces, type FieldReading } from './fields';
import { buildIntentQuestions, decideIntent, rankActions } from './intent';
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

  it('cancels or resumes at any time, even with no question on screen', () => {
    expect(quickText('never mind', null)).toEqual({ kind: 'event', event: { type: 'cancel' } });
    expect(quickText('Continue', null)).toEqual({ kind: 'event', event: { type: 'resume' } });
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
    const team = [person('4', 'Deepanshu Sharma', 'deepanshu@x.io'), person('5', 'Prisha Rao')];
    expect(matchName('Dipanshu', team)).toMatchObject({
      kind: 'one',
      record: { id: '4' },
      certain: false,
    });
    expect(matchName('dipanshu sharma', team)).toMatchObject({ kind: 'one', record: { id: '4' } });
    expect(matchName('Deepanshu Sharma', team)).toMatchObject({ kind: 'one', certain: true });
    expect(matchName('Priya', team)).toEqual({ kind: 'none' });
    expect(matchName('Alistair', team)).toEqual({ kind: 'none' });
  });

  it('asks which one when two names sound alike', () => {
    const team = [person('4', 'Deepanshu Sharma'), person('6', 'Dipanshu Verma')];
    expect(matchName('Deepanshoo', team)).toMatchObject({ kind: 'several' });
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

  it('asks what kind of sentence it is and one question per area, all in one request', () => {
    const { questions, state } = buildIntentQuestions('tell Priya hi', ACTIONS, null);
    expect(Object.keys(questions).sort()).toEqual([
      'action_in_channels',
      'action_in_messaging',
      'area',
      'kind',
    ]);
    expect(questions.kind?.type === 'choice' && Object.keys(questions.kind.criteria)).toEqual([
      'action',
      'help',
      'greeting',
      'thanks',
      'question',
      'unclear',
    ]);
    expect(state).toEqual({ request: 'tell Priya hi' });
    expect(questions.area?.type === 'choice' && Object.keys(questions.area.criteria)).toEqual([
      'messaging',
      'channels',
      'none',
    ]);
  });

  it('asks whether a sentence continues the request in progress', () => {
    const { questions } = buildIntentQuestions('ABC', ACTIONS, {
      id: 'd1',
      action: 'create_channel',
      values: {},
      certain: {},
      offered: [],
      skipped: [],
      asking: 'name',
      choosing: null,
      notFound: null,
      previewFingerprint: null,
    });
    expect(questions.continues?.type).toBe('noul');
  });

  it('scores area × action and acts on a clear winner', () => {
    const ranked = rankActions(
      {
        area: choice({ messaging: 0.9, channels: 0.08, none: 0.02 }),
        action_in_messaging: choice({ send_dm: 0.95, none: 0.05 }),
        action_in_channels: choice({ create_channel: 0.7, none: 0.3 }),
      },
      ACTIONS
    );
    expect(ranked[0]).toEqual({ action: 'send_dm', probability: 0.9 * 0.95 });
    expect(decideIntent(ranked)).toEqual({ kind: 'act', action: 'send_dm' });
  });

  it('asks "did you mean" when two actions are close, and says none when nothing fits', () => {
    const close = [
      { action: 'send_dm', probability: 0.45 },
      { action: 'create_channel', probability: 0.4 },
    ];
    expect(decideIntent(close)).toEqual({ kind: 'ask', actions: ['send_dm', 'create_channel'] });
    expect(decideIntent([{ action: 'send_dm', probability: 0.1 }])).toEqual({ kind: 'none' });
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
});

describe('the stored session', () => {
  it('round-trips, and starts fresh from anything unreadable or from another version', () => {
    expect(parseSession(serializeSession(EMPTY_SESSION))).toEqual(EMPTY_SESSION);
    expect(parseSession(null)).toBe(EMPTY_SESSION);
    expect(parseSession('not json')).toBe(EMPTY_SESSION);
    expect(parseSession(JSON.stringify({ ...EMPTY_SESSION, version: 2 }))).toBe(EMPTY_SESSION);
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
