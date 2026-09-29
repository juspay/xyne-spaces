import { ACTIONS, type EntityRef, type TurnInput, type TurnResponse } from '@xyne/shared/assistant';
import type { JevAnswer } from '@/services/queryIntent/jevClient';
import type { FoundRecord, SearchHints } from './records';
import { EMPTY_SESSION, parseSession, serializeSession, type AssistantSession } from './session';
import { handleTurn, type TurnServices } from './turn';

const daniel: FoundRecord = {
  record: { kind: 'person', id: 'u-daniel', name: 'Daniel Okafor' },
  detail: 'daniel@x.io',
};
const danielPark: FoundRecord = {
  record: { kind: 'person', id: 'u-park', name: 'Daniel Park' },
  detail: 'park@x.io',
};
const priyaShah: FoundRecord = {
  record: { kind: 'person', id: 'u-priya-shah', name: 'Priya Shah' },
  detail: 'priya.shah@x.io',
};
const priyaNair: FoundRecord = {
  record: { kind: 'person', id: 'u-priya-nair', name: 'Priya Nair' },
  detail: 'priya.nair@x.io',
};

const android: FoundRecord = {
  record: { kind: 'channel', id: 'c-android', name: 'android' },
  detail: '#android',
};

const openThread = {
  kind: 'thread' as const,
  id: 't-open',
  name: 'this thread',
  channelId: 'c-general',
  channelName: 'general',
};
const openMessage = {
  kind: 'message' as const,
  id: 'm-open',
  name: 'this message',
  channelId: 'c-general',
};

const general: FoundRecord = {
  record: { kind: 'channel', id: 'c-general', name: 'general' },
  detail: '#general',
};
/** What a search for the topic finds, best first. */
const perfThreads: FoundRecord[] = [
  {
    record: {
      kind: 'thread',
      id: 't-1',
      name: 'Reduce startup work',
      channelId: 'c-perf',
      channelName: 'releases',
    },
    detail: '#releases · Preeti Sharma',
  },
  {
    record: {
      kind: 'thread',
      id: 't-2',
      name: 'Cold start regression',
      channelId: 'c-perf',
      channelName: 'releases',
    },
    detail: '#releases · Vinit',
  },
];

const meera: FoundRecord = {
  record: { kind: 'person', id: 'u-meera', name: 'Meera Mehta' },
  detail: 'meera@x.io',
};

const identity = { workspaceId: 'w1', userId: 'me', sessionId: 's1' };

/** Jev's answers as scripted by each test: what the sentence is, and the words of each field. */
interface JevScript {
  kind?: string;
  action?: string;
  continues?: number;
  /** The words Jev picks for each field, as they appear in the sentence. */
  fields?: Record<string, string>;
}

const INTENT_QUESTIONS = /^(kind|action)$/;

function choiceOf(chosen: string, labels: string[]): JevAnswer {
  const probabilities = Object.fromEntries(
    labels.map((label) => [label, label === chosen ? 0.9 : 0.1 / (labels.length - 1)])
  );
  return { type: 'choice', choice: chosen, confidence: 0.9, probabilities };
}

/** A conversation against fake services; `say` sends one turn and returns the response. */
function assistant(people: FoundRecord[] = [daniel]) {
  let session: AssistantSession = EMPTY_SESSION;
  let ids = 0;
  let jev: JevScript = {};
  let jevCalls = 0;
  let onScreen: EntityRef[] = [];

  const services: TurnServices = {
    catalog: ACTIONS,
    sessions: {
      // Exercise the same JSON boundary as Redis on every turn.
      load: async () => parseSession(serializeSession(session)),
      save: async (_identity, next) => {
        session = parseSession(serializeSession(next));
      },
    },
    records: {
      // Like the real lookup: everyone in the workspace; `matchName` does the matching.
      // A search narrowed to Meera finds only the thread she was in.
      find: async (kind, _mention, hints) => {
        if (kind === 'person') return people;
        if (kind === 'channel') return [android];
        if (kind === 'message') return [];
        return hints?.people.includes('u-meera') ? [perfThreads[1]!] : perfThreads;
      },
      get: async (kind, id) => {
        if (kind === 'channel' && id === general.record.id) return general;
        if (kind === 'thread' && id === openThread.id) return { record: openThread };
        if (kind === 'message' && id === openMessage.id) return { record: openMessage };
        return null;
      },
    },
    askJev: async (_state, questions) => {
      jevCalls += 1;
      const answers: Record<string, JevAnswer> = {};
      for (const [id, question] of Object.entries(questions)) {
        if (question.type === 'noul') {
          answers[id] = { type: 'noul', noul: jev.continues ?? 0 };
          continue;
        }
        const labels = Object.keys(question.criteria);
        if (INTENT_QUESTIONS.test(id)) {
          const wanted = id === 'kind' ? (jev.kind ?? 'action') : jev.action;
          answers[id] = choiceOf(wanted && labels.includes(wanted) ? wanted : 'none', labels);
          continue;
        }
        // A detail ("send_dm.message"): pick the option that is the scripted words, for the
        // scripted action, or for any action when the sentence answers a question.
        const [action, field] = id.includes('.') ? id.split('.') : [undefined, id];
        const wanted =
          !jev.action || !action || action === jev.action
            ? jev.fields?.[field ?? '']?.toLowerCase()
            : undefined;
        const picked = Object.entries(question.criteria).find(
          ([label, text]) => label === wanted || String(text).toLowerCase() === `“${wanted}”`
        );
        answers[id] = choiceOf(picked?.[0] ?? 'none', labels);
      }
      return answers;
    },
    newId: () => `id-${++ids}`,
    debug: false,
  };

  const send = (input: TurnInput): Promise<TurnResponse> =>
    handleTurn(input, identity, services, { onScreen });
  return {
    services,
    jevCalls: () => jevCalls,
    session: () => session,
    /** Scripts what Jev will answer for the next sentence. */
    hears(script: JevScript): void {
      jev = script;
    },
    /** What the user has open on the left. */
    lookingAt(refs: EntityRef[]): void {
      onScreen = refs;
    },
    say: (text: string, via: 'typed' | 'voice' = 'voice') => send({ kind: 'text', text, via }),
    tap: (optionId: string) => send({ kind: 'choose', optionId }),
    ran: (runId: string, results: Array<{ ok: boolean; error?: string }>) =>
      send({ kind: 'planResult', runId, results }),
  };
}

describe('a turn', () => {
  it('sends a DM said in one sentence: one plan, then "Sent to …" once it ran', async () => {
    const chat = assistant();
    chat.hears({
      action: 'send_dm',
      fields: { recipient: 'Daniel Okafor', message: 'hello' },
    });
    const planned = await chat.say('create a DM with Daniel Okafor and message hello');
    expect(planned.say).toBe('');
    expect(planned.run?.plan).toEqual([
      { op: 'open_or_create_dm', user: daniel.record },
      { op: 'navigate', target: { fromStep: 0 } },
      { op: 'send_message', target: { fromStep: 0 }, text: 'hello' },
    ]);
    // One Jev request reads both the action and the words that are its details.
    expect(chat.jevCalls()).toBe(1);

    const done = await chat.ran(planned.run!.runId, [{ ok: true }, { ok: true }, { ok: true }]);
    expect(done.say).toBe('Sent to Daniel Okafor.');
    expect(chat.session().run).toBeNull();
  });

  it('does not report success when an all-success result list is incomplete', async () => {
    const chat = assistant();
    chat.hears({
      action: 'send_dm',
      fields: { recipient: 'Daniel Okafor', message: 'hello' },
    });
    const planned = await chat.say('create a DM with Daniel Okafor and message hello');
    expect(planned.run?.plan).toHaveLength(3);

    const incomplete = await chat.ran(planned.run!.runId, [{ ok: true }]);

    expect(incomplete).toMatchObject({
      tone: 'error',
      say: 'I can’t confirm this finished because some action results are missing.',
    });
    expect(chat.session().run).toBeNull();
  });

  it('previews when a name only partly matched, and runs on "yes" without a model', async () => {
    const chat = assistant();
    chat.hears({
      action: 'send_dm',
      fields: { recipient: 'Daniel', message: 'hi' },
    });
    const preview = await chat.say('tell daniel hi');
    expect(preview.say).toBe('Send “hi” to Daniel Okafor?');
    expect(preview.display).toEqual({
      kind: 'preview',
      summary: 'Send “hi” to Daniel Okafor',
      confirmLabel: 'Yes',
      cancelLabel: 'Cancel',
    });
    const before = chat.jevCalls();
    const yes = await chat.say('yes');
    expect(yes.run?.plan).toHaveLength(3);
    expect(chat.jevCalls()).toBe(before);
  });

  it('offers long message text whole and requires a preview before sending', async () => {
    const chat = assistant();
    const message =
      'the deploy is blocked because the migration failed on staging and we need to roll back tonight';
    const request = `tell Daniel Okafor ${message}`;
    chat.hears({
      action: 'send_dm',
      fields: { recipient: 'Daniel Okafor', message },
    });

    const preview = await chat.say(request);

    expect(preview.say).toBe(`Send “${message}” to Daniel Okafor?`);
    expect(preview.display).toMatchObject({
      kind: 'preview',
      summary: `Send “${message}” to Daniel Okafor`,
      confirmLabel: 'Yes',
      cancelLabel: 'Cancel',
    });
    expect(preview.run).toBeUndefined();
  });

  it('opens a channel said by name, without a preview', async () => {
    const chat = assistant();
    chat.hears({ action: 'open_channel', fields: { channel: 'Android' } });
    const planned = await chat.say('open the Android channel');
    expect(planned.run?.plan).toEqual([{ op: 'navigate', target: android.record }]);
    const done = await chat.ran(planned.run!.runId, [{ ok: true }]);
    expect(done.say).toBe('Opened android.');
  });

  it('finds a conversation by its topic: the matches are buttons, and a tap opens one', async () => {
    const chat = assistant();
    chat.hears({
      action: 'find_conversation',
      fields: { conversation: 'release nots' },
    });
    const which = await chat.say('find the messages about release nots');
    expect(which.display).toMatchObject({
      kind: 'choices',
      options: [
        { id: 't-1', label: 'Reduce startup work', detail: '#releases · Preeti Sharma' },
        { id: 't-2', label: 'Cold start regression', detail: '#releases · Vinit' },
      ],
    });
    const opened = await chat.tap('t-2');
    expect(opened.run?.plan).toEqual([{ op: 'navigate', target: perfThreads[1]!.record }]);
  });

  it('narrows a search to the people named with it', async () => {
    const chat = assistant([daniel, meera]);
    chat.hears({
      action: 'find_conversation',
      fields: { conversation: 'release notes', with: 'Meera' },
    });
    const opened = await chat.say('find the thread where Meera and I discussed release notes');
    expect(opened.run?.plan).toEqual([{ op: 'navigate', target: perfThreads[1]!.record }]);
  });

  it('asks which one, and searches again when told who was in it', async () => {
    const chat = assistant([daniel, meera]);
    chat.hears({
      action: 'find_conversation',
      fields: { conversation: 'release notes' },
    });
    const which = await chat.say('find the messages about release notes');
    expect(which.say).toBe(
      'Here are the closest matches for “release notes”. Tap one, or tell me who was in it or which channel.'
    );

    chat.hears({ continues: 0.9, fields: { with: 'Meera' } });
    const opened = await chat.say('the one with Meera');
    expect(opened.run?.plan).toEqual([{ op: 'navigate', target: perfThreads[1]!.record }]);
  });

  it('keeps the original topic when a filter answer repeats it as filler', async () => {
    const chat = assistant();
    const androidThread: FoundRecord = {
      record: {
        kind: 'thread',
        id: 't-android-release',
        name: 'Release notes in Android',
        channelId: android.record.id,
        channelName: android.record.name,
      },
    };
    chat.services.records.find = async (kind, _mention, hints) => {
      if (kind === 'channel') return [android];
      if (kind === 'thread' && hints?.channels.includes(android.record.id)) {
        return [androidThread];
      }
      return kind === 'thread' ? perfThreads : [];
    };
    chat.hears({ action: 'find_conversation', fields: { conversation: 'release notes' } });

    const choices = await chat.say('find the messages about release notes');
    expect(choices.display?.kind).toBe('choices');

    chat.hears({
      continues: 0.9,
      fields: { conversation: 'the one in android', in: 'android' },
    });
    const opened = await chat.say('the one in android');

    expect(opened.run?.plan).toEqual([{ op: 'navigate', target: androidThread.record }]);
  });

  it.each([
    {
      name: 'unknown participant',
      field: 'with' as const,
      mention: 'Unknown Person',
      matches: [] as FoundRecord[],
      resolved: daniel,
      expectedHints: { people: ['u-daniel'], channels: [] },
      answer: 'Daniel Okafor',
    },
    {
      name: 'ambiguous participant',
      field: 'with' as const,
      mention: 'Daniel',
      matches: [daniel, danielPark],
      resolved: daniel,
      expectedHints: { people: ['u-daniel'], channels: [] },
      answer: 'u-daniel',
    },
    {
      name: 'unknown channel',
      field: 'in' as const,
      mention: 'Unknown Room',
      matches: [] as FoundRecord[],
      resolved: android,
      expectedHints: { people: [], channels: ['c-android'] },
      answer: 'android',
    },
    {
      name: 'ambiguous channel',
      field: 'in' as const,
      mention: 'Ops',
      matches: [
        { record: { kind: 'channel' as const, id: 'c-ops-north', name: 'Ops North' } },
        { record: { kind: 'channel' as const, id: 'c-ops-south', name: 'Ops South' } },
      ],
      resolved: { record: { kind: 'channel' as const, id: 'c-ops-north', name: 'Ops North' } },
      expectedHints: { people: [], channels: ['c-ops-north'] },
      answer: 'c-ops-north',
    },
  ])('waits for the $name before searching messages', async (scenario) => {
    const chat = assistant();
    const threadSearches: Array<{ topic: string; hints: SearchHints | undefined }> = [];
    chat.services.records.find = async (kind, mention, hints) => {
      if (kind === 'thread') {
        threadSearches.push({ topic: mention, hints });
        return [perfThreads[0]!];
      }
      if (kind === (scenario.field === 'with' ? 'person' : 'channel')) {
        return mention === scenario.mention ? scenario.matches : [scenario.resolved];
      }
      return [];
    };
    chat.hears({
      action: 'find_conversation',
      fields: { conversation: 'release notes', [scenario.field]: scenario.mention },
    });

    const clarification = await chat.say(
      `find release notes ${scenario.field} ${scenario.mention}`
    );
    expect(threadSearches).toEqual([]);

    let opened: TurnResponse;
    if (scenario.matches.length === 0) {
      expect(clarification.say).toContain("I couldn't find");
      chat.hears({ continues: 0.9, fields: { [scenario.field]: scenario.resolved.record.name } });
      opened = await chat.say(scenario.answer);
    } else {
      expect(clarification.display?.kind).toBe('choices');
      opened = await chat.tap(scenario.answer);
    }

    expect(threadSearches).toEqual([{ topic: 'release notes', hints: scenario.expectedHints }]);
    expect(opened.run?.plan).toEqual([{ op: 'navigate', target: perfThreads[0]!.record }]);
  });

  it('resolves multiple message filters in order before searching', async () => {
    const chat = assistant();
    const threadSearches: SearchHints[] = [];
    chat.services.records.find = async (kind, mention, hints) => {
      if (kind === 'thread') {
        threadSearches.push(hints ?? { people: [], channels: [] });
        return [perfThreads[0]!];
      }
      if (kind === 'person') return mention === 'Missing Person' ? [] : [daniel];
      if (kind === 'channel') return mention === 'Missing Room' ? [] : [android];
      return [];
    };
    chat.hears({
      action: 'find_conversation',
      fields: {
        conversation: 'release notes',
        with: 'Missing Person',
        in: 'Missing Room',
      },
    });

    const first = await chat.say('find release notes with Missing Person in Missing Room');
    expect(first.say).toContain('Missing Person');
    expect(threadSearches).toEqual([]);

    chat.hears({ continues: 0.9, fields: { with: 'Daniel Okafor' } });
    const second = await chat.say('Daniel Okafor');
    expect(second.say).toContain('Missing Room');
    expect(threadSearches).toEqual([]);

    chat.hears({ continues: 0.9, fields: { in: 'android' } });
    const opened = await chat.say('android');

    expect(threadSearches).toEqual([{ people: ['u-daniel'], channels: ['c-android'] }]);
    expect(opened.run?.plan).toEqual([{ op: 'navigate', target: perfThreads[0]!.record }]);
  });

  it('keeps an unknown participant filter pending through a help aside', async () => {
    const chat = assistant();
    const threadSearches: Array<{ topic: string; hints: SearchHints | undefined }> = [];
    chat.services.records.find = async (kind, mention, hints) => {
      if (kind === 'thread') {
        threadSearches.push({ topic: mention, hints });
        return [perfThreads[0]!];
      }
      if (kind === 'person') return mention === 'Missing Person' ? [] : [daniel];
      return [];
    };
    chat.hears({
      action: 'find_conversation',
      fields: { conversation: 'release notes', with: 'Missing Person' },
    });

    const clarification = await chat.say('find release notes with Missing Person');
    expect(clarification.say).toContain('Missing Person');
    expect(threadSearches).toEqual([]);

    chat.hears({ kind: 'help', continues: 0.1 });
    const help = await chat.say('what can you do?');
    expect(help.say).toContain('Who was in it?');
    expect(chat.session().conversation.active?.open[0]).toMatchObject({
      field: 'with',
      said: 'Missing Person',
    });
    expect(threadSearches).toEqual([]);

    chat.hears({ continues: 0.9, fields: { with: 'Daniel Okafor' } });
    const opened = await chat.say('Daniel Okafor');

    expect(threadSearches).toEqual([
      { topic: 'release notes', hints: { people: ['u-daniel'], channels: [] } },
    ]);
    expect(opened.run?.plan).toEqual([{ op: 'navigate', target: perfThreads[0]!.record }]);
  });

  it('keeps other unresolved participants when one correction is ambiguous', async () => {
    const chat = assistant([daniel, danielPark, meera]);
    const threadSearches: SearchHints[] = [];
    chat.services.records.find = async (kind, mention, hints) => {
      if (kind === 'thread') {
        threadSearches.push(hints ?? { people: [], channels: [] });
        return [perfThreads[0]!];
      }
      if (kind === 'person') {
        if (mention === 'Daneel' || mention === 'Missing Meera') return [];
        if (mention === 'Daniel') return [daniel, danielPark];
        return [meera];
      }
      return [];
    };
    chat.hears({
      action: 'find_conversation',
      fields: { conversation: 'release notes', with: 'Daneel and Missing Meera' },
    });

    const notFound = await chat.say('find release notes with Daneel and Missing Meera');
    expect(notFound.say).toContain('Daneel');
    expect(threadSearches).toEqual([]);

    chat.hears({ continues: 0.9, fields: { with: 'Daniel' } });
    const corrected = await chat.say('I meant Daniel');
    expect(corrected.display).toMatchObject({
      kind: 'choices',
      options: [
        { id: 'u-daniel', label: 'Daniel Okafor' },
        { id: 'u-park', label: 'Daniel Park' },
      ],
    });

    const nextFilter = await chat.tap('u-park');
    expect(nextFilter.say).toContain('Missing Meera');
    expect(threadSearches).toEqual([]);

    chat.hears({ continues: 0.9, fields: { with: 'Meera Mehta' } });
    const opened = await chat.say('Meera Mehta');
    expect(threadSearches).toEqual([{ people: ['u-park', 'u-meera'], channels: [] }]);
    expect(opened.run?.plan).toEqual([{ op: 'navigate', target: perfThreads[0]!.record }]);
  });

  it('replaces an ambiguous channel filter when the user corrects it', async () => {
    const chat = assistant();
    const ops: FoundRecord[] = [
      { record: { kind: 'channel', id: 'c-ops-north', name: 'Ops North' } },
      { record: { kind: 'channel', id: 'c-ops-south', name: 'Ops South' } },
    ];
    const engineering: FoundRecord[] = [
      { record: { kind: 'channel', id: 'c-eng-platform', name: 'Engineering Platform' } },
      { record: { kind: 'channel', id: 'c-eng-mobile', name: 'Engineering Mobile' } },
    ];
    const threadSearches: SearchHints[] = [];
    chat.services.records.find = async (kind, mention, hints) => {
      if (kind === 'thread') {
        threadSearches.push(hints ?? { people: [], channels: [] });
        return [perfThreads[0]!];
      }
      if (kind === 'channel') return mention === 'Ops' ? ops : engineering;
      return [];
    };
    chat.hears({
      action: 'find_conversation',
      fields: { conversation: 'release notes', in: 'Ops' },
    });

    const firstChoice = await chat.say('find release notes in Ops');
    expect(firstChoice.display).toMatchObject({
      kind: 'choices',
      options: [
        { id: 'c-ops-north', label: 'Ops North' },
        { id: 'c-ops-south', label: 'Ops South' },
      ],
    });
    expect(threadSearches).toEqual([]);

    chat.hears({ continues: 0.9, fields: { in: 'Engineering' } });
    const corrected = await chat.say('I meant Engineering');
    expect(corrected.display).toMatchObject({
      kind: 'choices',
      options: [
        { id: 'c-eng-platform', label: 'Engineering Platform' },
        { id: 'c-eng-mobile', label: 'Engineering Mobile' },
      ],
    });

    const opened = await chat.tap('c-eng-mobile');
    expect(threadSearches).toEqual([{ people: [], channels: ['c-eng-mobile'] }]);
    expect(opened.run?.plan).toEqual([{ op: 'navigate', target: perfThreads[0]!.record }]);
  });

  it('posts "here" in the channel open on screen, mentioning people', async () => {
    const chat = assistant();
    chat.lookingAt([{ kind: 'channel', id: 'c-general', name: '' }]);
    chat.hears({
      action: 'post_message',
      fields: { channel: 'here', mentions: 'Daniel Okafor', message: 'hello' },
    });
    const preview = await chat.say('post hello here and mention Daniel Okafor');
    expect(preview.say).toBe('Post “hello” in general mentioning Daniel Okafor?');
    const posted = await chat.tap('yes');
    expect(posted.run?.plan).toEqual([
      { op: 'navigate', target: general.record },
      { op: 'send_message', target: general.record, text: 'hello', mentions: [daniel.record] },
    ]);
  });

  it('replies in the thread open on screen', async () => {
    const chat = assistant();
    chat.lookingAt([{ ...openThread, name: '', channelName: '' }]);
    chat.hears({ action: 'reply_in_thread', fields: { thread: 'here', message: 'looks good' } });
    const preview = await chat.say('reply here saying looks good');
    expect(preview.say).toBe('Reply “looks good” in this thread?');
    const replied = await chat.tap('yes');
    expect(replied.run?.plan).toEqual([
      { op: 'navigate', target: openThread },
      { op: 'send_message', target: openThread, text: 'looks good', mentions: [] },
    ]);
  });

  it('finds a thread by topic and replies there from typed input', async () => {
    const chat = assistant();
    const releaseThread: FoundRecord = {
      record: {
        kind: 'thread',
        id: 't-release',
        name: 'Release notes draft',
        channelId: 'c-release',
        channelName: 'release-planning',
      },
      detail: '#release-planning · Meera Iyer',
    };
    const searched: string[] = [];
    chat.services.records.find = async (kind, mention) => {
      if (kind === 'thread') {
        searched.push(mention);
        return [releaseThread];
      }
      return kind === 'person' ? [daniel] : [];
    };
    chat.hears({
      action: 'reply_in_thread',
      fields: { thread: 'release notes draft', message: 'looks good' },
    });

    const preview = await chat.say(
      'Reply to the thread about the release notes draft saying looks good',
      'typed',
    );

    expect(searched).toEqual(['release notes draft']);
    expect(preview.say).toBe('Reply “looks good” in Release notes draft?');
    const confirmed = await chat.tap('yes');
    expect(confirmed.run?.plan).toEqual([
      { op: 'navigate', target: releaseThread.record },
      { op: 'send_message', target: releaseThread.record, text: 'looks good', mentions: [] },
    ]);
  });

  it('forwards the message on screen to a person, always after a preview', async () => {
    const chat = assistant();
    chat.lookingAt([{ ...openMessage, name: '“Ship it today”' }]);
    chat.hears({
      action: 'forward_message',
      fields: { message: 'this', recipient: 'Daniel Okafor' },
    });
    const preview = await chat.say('forward this message to Daniel Okafor');
    expect(preview.say).toBe('Forward “Ship it today” to Daniel Okafor?');
    const forwarded = await chat.tap('yes');
    expect(forwarded.run?.plan).toEqual([
      { op: 'open_or_create_dm', user: daniel.record },
      { op: 'navigate', target: { fromStep: 0 } },
      {
        op: 'forward_message',
        message: { ...openMessage, name: '“Ship it today”' },
        target: { fromStep: 0 },
      },
    ]);
  });

  it('asks which Priya, then confirms before forwarding', async () => {
    const chat = assistant([priyaShah, priyaNair]);
    chat.lookingAt([{ ...openMessage, name: '“Ship it today”' }]);
    chat.hears({
      action: 'forward_message',
      fields: { message: 'this', recipient: 'Priya' },
    });

    const ambiguous = await chat.say('forward this message to Priya');
    expect(ambiguous.display).toMatchObject({
      kind: 'choices',
      options: [
        { id: 'u-priya-shah', label: 'Priya Shah' },
        { id: 'u-priya-nair', label: 'Priya Nair' },
      ],
    });

    const selected = await chat.tap('u-priya-shah');
    expect(selected.say).toBe('Forward “Ship it today” to Priya Shah?');
    const confirmed = await chat.tap('yes');
    expect(confirmed.run?.plan).toEqual([
      { op: 'open_or_create_dm', user: priyaShah.record },
      { op: 'navigate', target: { fromStep: 0 } },
      {
        op: 'forward_message',
        message: { ...openMessage, name: '“Ship it today”' },
        target: { fromStep: 0 },
      },
    ]);
  });

  it('asks the user to pick a message when none is on screen', async () => {
    const chat = assistant();
    chat.hears({
      action: 'forward_message',
      fields: { message: 'this', recipient: 'Daniel Okafor' },
    });
    const ask = await chat.say('forward this message to Daniel Okafor');
    expect(ask.say).toBe('Which message? Use Ask AI on it, or open its thread, then ask me again.');
  });

  it('asks which Daniel, with buttons, and continues from the tap', async () => {
    const chat = assistant([daniel, danielPark]);
    chat.hears({
      action: 'send_dm',
      fields: { recipient: 'Daniel', message: 'hi' },
    });
    const which = await chat.say('message Daniel hi');
    expect(which.say).toBe('Which one do you mean by “Daniel”?');
    expect(which.display).toEqual({
      kind: 'choices',
      prompt: 'Which one do you mean by “Daniel”?',
      options: [
        { id: 'u-daniel', label: 'Daniel Okafor', detail: 'daniel@x.io' },
        { id: 'u-park', label: 'Daniel Park', detail: 'park@x.io' },
      ],
    });
    const run = await chat.tap('u-park');
    expect(run.run?.plan[0]).toEqual({ op: 'open_or_create_dm', user: danielPark.record });
  });

  it('collects a channel step by step, answering each question from the next sentence', async () => {
    const chat = assistant();
    chat.hears({ action: 'create_channel' });
    expect((await chat.say('create a channel')).say).toBe('What should I name the channel?');

    chat.hears({ continues: 0.95, fields: { name: 'ABC' } });
    const visibility = await chat.say('call it ABC');
    expect(visibility.say).toBe('Should it be public or private?');

    const members = await chat.say('private'); // a button label: no model
    expect(members.say).toBe('Want to add anyone? Say their names, or say no.');

    const preview = await chat.say('no');
    expect(preview.say).toBe('Create a private channel named “ABC”?');
    const confirmed = await chat.tap('yes'); // the preview's Yes button
    expect(confirmed.run?.plan[0]).toEqual({
      op: 'create_channel',
      name: 'ABC',
      visibility: 'private',
      members: [],
    });
  });

  it('takes a bare reply as the answer to the open question', async () => {
    const chat = assistant();
    chat.hears({ action: 'create_channel' });
    await chat.say('create a channel');

    // Jev sees no action in "Random." and doubts it continues; the reader finds no fields.
    chat.hears({ continues: 0.1 });
    const next = await chat.say('Random.');
    expect(next.say).toBe('Should it be public or private?');
    expect(chat.session().conversation.active?.values).toEqual({ name: 'Random' });
  });

  it('still starts a clear new request while a question is open', async () => {
    const chat = assistant();
    chat.hears({ action: 'create_channel', fields: { name: 'Ops' } });
    expect((await chat.say('create a channel called Ops')).say).toBe(
      'Should it be public or private?'
    );

    chat.hears({
      action: 'send_dm',
      continues: 0.1,
      fields: { recipient: 'Daniel Okafor', message: 'hi' },
    });
    const sent = await chat.say('tell Daniel Okafor hi');
    expect(sent.run?.plan[0]).toEqual({ op: 'open_or_create_dm', user: daniel.record });
    expect(chat.session().conversation.active).toBeNull();
  });

  it('re-reads a new same-action request when its pending-context read misses required text', async () => {
    const chat = assistant();
    chat.hears({ action: 'send_dm', fields: { recipient: 'Daniel Okafor' } });
    expect((await chat.say('message Daniel Okafor')).say).toBe(
      'What should I say to Daniel Okafor?'
    );
    const beforeNewRequest = chat.jevCalls();

    chat.hears({
      action: 'send_dm',
      continues: 0.1,
      fields: { recipient: 'Daniel Okafor' },
    });
    const reply = await chat.say('tell Daniel Okafor the build is green');

    expect(reply.say).toBe('What should I say to Daniel Okafor?');
    expect(reply.run).toBeUndefined();
    // One read distinguishes a new request from the pending one; the second reads its fields
    // without that pending context. Missing message text is still requested, never invented.
    expect(chat.jevCalls() - beforeNewRequest).toBe(2);
  });

  it('re-reads a missing post body after recognizing the channel, then asks instead of sending', async () => {
    const chat = assistant();
    chat.hears({ action: 'post_message', fields: { channel: 'android' } });

    const reply = await chat.say('go to android and mention Arjun Mehta to check the crash');

    expect(reply.say).toBe('What should I post in android?');
    expect(reply.run).toBeUndefined();
    expect(chat.jevCalls()).toBe(2);
  });

  it('finds a person whose name was spelled the way it sounds', async () => {
    const preeti: FoundRecord = {
      record: { kind: 'person', id: 'u-deep', name: 'Preeti Sharma' },
      detail: 'preeti@x.io',
    };
    const chat = assistant([daniel, preeti]);
    chat.hears({ action: 'send_dm', fields: { recipient: 'Priti' } });
    const next = await chat.say('Send a direct message to Priti.');
    expect(next.say).toBe('What should I say to Preeti Sharma?');
  });

  it('previews a close agent-name match before sending', async () => {
    const xyneAgent: FoundRecord = {
      record: { kind: 'person', id: 'app-xyne', name: 'Xyne Doctor' },
      detail: 'Agent',
    };
    const chat = assistant([xyneAgent]);
    chat.hears({
      action: 'send_dm',
      fields: { recipient: 'Zahn Doctor', message: 'hello' },
    });

    const preview = await chat.say('send a direct message to Zahn Doctor and say hello');

    expect(preview).toMatchObject({
      say: 'Send “hello” to Xyne Doctor?',
      display: { kind: 'preview' },
    });
    expect(preview.run).toBeUndefined();
  });

  it('answers "what can you do?", greetings, and thanks instead of "I can’t do that"', async () => {
    const chat = assistant();
    chat.hears({ kind: 'help' });
    const help = await chat.say('What can you do?');
    expect(help.say).toBe(
      'I can send a direct message, or create a channel. Tap one, or just tell me what you need.'
    );
    expect(help.display).toMatchObject({ kind: 'choices' });

    chat.hears({ kind: 'greeting' });
    expect((await chat.say('hi')).say).toBe('Hi! What can I do for you?');

    chat.hears({ kind: 'thanks' });
    expect(await chat.say('thanks')).toMatchObject({ say: 'You’re welcome.', expectsReply: false });
  });

  it('offers to ask Xyne AI a question', async () => {
    const chat = assistant();
    chat.hears({ kind: 'question' });
    const reply = await chat.say('what did we decide about the launch?');
    expect(reply).toMatchObject({
      say: 'That’s one for Xyne AI. Want me to ask it?',
      handoff: { to: 'ask_ai', text: 'what did we decide about the launch?' },
    });
  });

  it('answers help in the middle of a request, then asks its question again', async () => {
    const chat = assistant();
    chat.hears({ action: 'create_channel' });
    await chat.say('create a channel');

    chat.hears({ kind: 'help', continues: 0.1 });
    const reply = await chat.say('what can you do?');
    expect(reply.say).toBe(
      'I can send a direct message, or create a channel. Now, what should I name the channel?'
    );
    expect(chat.session().conversation.active?.awaiting).toEqual({ kind: 'field', field: 'name' });
  });

  it('takes a greeting as the message when asked what to say', async () => {
    const chat = assistant();
    chat.hears({ action: 'send_dm', fields: { recipient: 'Daniel Okafor' } });
    expect((await chat.say('message Daniel Okafor')).say).toBe(
      'What should I say to Daniel Okafor?'
    );

    chat.hears({ kind: 'greeting', continues: 0.2 });
    const sent = await chat.say('hello');
    expect(sent.run?.plan[2]).toMatchObject({ op: 'send_message', text: 'hello' });
  });

  it('asks "did you mean" when two actions are close, and uses the original words after the tap', async () => {
    const chat = assistant();
    const scripted = chat.services.askJev;
    // Two actions equally likely; the later request for the words is answered as scripted.
    const close: TurnServices['askJev'] = async (state, questions) => {
      const answers = await scripted(state, questions);
      if (!answers || !('action' in questions)) return answers;
      const probabilities = { send_dm: 0.45, create_channel: 0.45, none: 0.1 };
      return {
        ...answers,
        action: { type: 'choice', choice: 'send_dm', confidence: 0.45, probabilities },
      };
    };
    chat.services.askJev = close;
    chat.hears({});
    const which = await chat.say('ABC hello');
    expect(which.say).toBe('Did you mean to send a direct message, or create a channel?');

    chat.hears({ fields: { name: 'ABC', firstMessage: 'hello' } });
    const next = await chat.tap('create_channel');
    expect(next.say).toBe('Should it be public or private?');
    expect(chat.session().conversation.active?.values).toEqual({
      name: 'ABC',
      firstMessage: 'hello',
    });
  });

  it('offers what it can do when nothing fits, and a tap starts that action', async () => {
    const chat = assistant();
    chat.hears({});
    const reply = await chat.say('what is the weather');
    expect(reply.say).toMatch(/^I can’t do that yet\. I can /);
    // Nothing was even slightly likely: one way to start per area, as buttons.
    expect(
      reply.display?.kind === 'choices' && reply.display.options.map((option) => option.id)
    ).toEqual(['send_dm', 'create_channel']);
    const started = await chat.tap('create_channel');
    expect(started.say).toBe('What should I name the channel?');
  });

  it('reports a name it could not find, and a plan that failed', async () => {
    const chat = assistant();
    chat.hears({
      action: 'send_dm',
      fields: { recipient: 'Zorro', message: 'hi' },
    });
    expect((await chat.say('message Zorro hi')).say).toBe(
      "I couldn't find “Zorro”. Who should I message?"
    );

    chat.hears({ continues: 0.9, fields: { recipient: 'Daniel Okafor' } });
    const planned = await chat.say('Daniel Okafor');
    const failed = await chat.ran(planned.run!.runId, [
      { ok: true },
      { ok: false, error: 'the DM is closed' },
    ]);
    expect(failed).toMatchObject({ say: 'That didn’t finish: the DM is closed', tone: 'error' });
  });

  it('refuses plan results that belong to no running plan', async () => {
    const chat = assistant();
    const reply = await chat.ran('someone-else', [{ ok: true }]);
    expect(reply).toMatchObject({ tone: 'error' });
  });

  it('asks again, gently, when told "no" for a detail it needs', async () => {
    const chat = assistant();
    chat.hears({ action: 'create_channel' });
    await chat.say('create a channel');
    const again = await chat.say('no');
    expect(again.say).toBe('No problem. What should I name the channel? Or say “cancel” to stop.');
    expect(chat.session().conversation.active?.action).toBe('create_channel');
  });

  it('cancels at any time without a model', async () => {
    const chat = assistant();
    chat.hears({ action: 'create_channel' });
    await chat.say('create a channel');
    const before = chat.jevCalls();
    const cancelled = await chat.say('never mind');
    expect(cancelled.say).toBe('Okay, I’ve cancelled that.');
    expect(chat.jevCalls()).toBe(before);
    expect(chat.session().conversation.active).toBeNull();
  });
});
