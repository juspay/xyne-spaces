import { ACTIONS, type EntityRef, type TurnInput, type TurnResponse } from '@xyne/shared/assistant';
import type { JevAnswer } from '@/services/queryIntent/jevClient';
import type { FoundRecord } from './records';
import { EMPTY_SESSION, type AssistantSession } from './session';
import { handleTurn, type TurnServices } from './turn';

const daniel: FoundRecord = {
  record: { kind: 'person', id: 'u-daniel', name: 'Daniel Okafor' },
  detail: 'daniel@x.io',
};
const danielPark: FoundRecord = {
  record: { kind: 'person', id: 'u-park', name: 'Daniel Park' },
  detail: 'park@x.io',
};

const android: FoundRecord = {
  record: { kind: 'channel', id: 'c-android', name: 'android' },
  detail: '#android',
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
  area?: string;
  action?: string;
  continues?: number;
  /** The words Jev picks for each field, as they appear in the sentence. */
  fields?: Record<string, string>;
}

const INTENT_QUESTIONS = /^(kind|area|action_in_.+)$/;

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
      load: async () => session,
      save: async (_identity, next) => {
        session = next;
      },
    },
    records: {
      // Like the real lookup: everyone in the workspace; `matchName` does the matching.
      // A search narrowed to Meera finds only the thread she was in.
      find: async (kind, _mention, hints) =>
        kind === 'person'
          ? people
          : kind === 'channel'
            ? [android]
            : hints?.people.includes('u-meera')
              ? [perfThreads[1]!]
              : perfThreads,
      get: async (kind, id) => (kind === 'channel' && id === general.record.id ? general : null),
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
          const wanted =
            id === 'area' ? jev.area : id === 'kind' ? (jev.kind ?? 'action') : jev.action;
          answers[id] = choiceOf(wanted && labels.includes(wanted) ? wanted : 'none', labels);
          continue;
        }
        // A field: pick the option that is the scripted words (a piece, or a choice's id).
        const wanted = jev.fields?.[id]?.toLowerCase();
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
    say: (text: string) => send({ kind: 'text', text, via: 'voice' }),
    tap: (optionId: string) => send({ kind: 'choose', optionId }),
    ran: (runId: string, results: Array<{ ok: boolean; error?: string }>) =>
      send({ kind: 'planResult', runId, results }),
  };
}

describe('a turn', () => {
  it('sends a DM said in one sentence: one plan, then "Sent to …" once it ran', async () => {
    const chat = assistant();
    chat.hears({
      area: 'messaging',
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
    // Two Jev requests and no other model: which action, then which words are its details.
    expect(chat.jevCalls()).toBe(2);

    const done = await chat.ran(planned.run!.runId, [{ ok: true }, { ok: true }, { ok: true }]);
    expect(done.say).toBe('Sent to Daniel Okafor.');
    expect(chat.session().run).toBeNull();
  });

  it('previews when a name only partly matched, and runs on "yes" without a model', async () => {
    const chat = assistant();
    chat.hears({
      area: 'messaging',
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
      area: 'messaging',
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
    chat.hears({ area: 'channels', action: 'open_channel', fields: { channel: 'Android' } });
    const planned = await chat.say('open the Android channel');
    expect(planned.run?.plan).toEqual([{ op: 'navigate', target: android.record }]);
    const done = await chat.ran(planned.run!.runId, [{ ok: true }]);
    expect(done.say).toBe('Opened android.');
  });

  it('finds a conversation by its topic: the matches are buttons, and a tap opens one', async () => {
    const chat = assistant();
    chat.hears({
      area: 'messaging',
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
      area: 'messaging',
      action: 'find_conversation',
      fields: { conversation: 'release notes', with: 'Meera' },
    });
    const opened = await chat.say('find the thread where Meera and I discussed release notes');
    expect(opened.run?.plan).toEqual([{ op: 'navigate', target: perfThreads[1]!.record }]);
  });

  it('asks which one, and searches again when told who was in it', async () => {
    const chat = assistant([daniel, meera]);
    chat.hears({
      area: 'messaging',
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

  it('posts "here" in the channel open on screen, mentioning people', async () => {
    const chat = assistant();
    chat.lookingAt([{ kind: 'channel', id: 'c-general', name: '' }]);
    chat.hears({
      area: 'messaging',
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

  it('asks which Daniel, with buttons, and continues from the tap', async () => {
    const chat = assistant([daniel, danielPark]);
    chat.hears({
      area: 'messaging',
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
    chat.hears({ area: 'channels', action: 'create_channel' });
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
    chat.hears({ area: 'channels', action: 'create_channel' });
    await chat.say('create a channel');

    // Jev sees no action in "Random." and doubts it continues; the reader finds no fields.
    chat.hears({ area: 'none', continues: 0.1 });
    const next = await chat.say('Random.');
    expect(next.say).toBe('Should it be public or private?');
    expect(chat.session().conversation.active?.values).toEqual({ name: 'Random' });
  });

  it('still starts a clear new request while a question is open', async () => {
    const chat = assistant();
    chat.hears({ area: 'channels', action: 'create_channel', fields: { name: 'Ops' } });
    expect((await chat.say('create a channel called Ops')).say).toBe(
      'Should it be public or private?'
    );

    chat.hears({
      area: 'messaging',
      action: 'send_dm',
      continues: 0.1,
      fields: { recipient: 'Daniel Okafor', message: 'hi' },
    });
    const sent = await chat.say('tell Daniel Okafor hi');
    expect(sent.run?.plan[0]).toEqual({ op: 'open_or_create_dm', user: daniel.record });
    expect(chat.session().conversation.parked).toHaveLength(1);
  });

  it('finds a person whose name was spelled the way it sounds', async () => {
    const preeti: FoundRecord = {
      record: { kind: 'person', id: 'u-deep', name: 'Preeti Sharma' },
      detail: 'preeti@x.io',
    };
    const chat = assistant([daniel, preeti]);
    chat.hears({ area: 'messaging', action: 'send_dm', fields: { recipient: 'Priti' } });
    const next = await chat.say('Send a direct message to Priti.');
    expect(next.say).toBe('What should I say to Preeti Sharma?');
  });

  it('answers "what can you do?", greetings, and thanks instead of "I can’t do that"', async () => {
    const chat = assistant();
    chat.hears({ kind: 'help', area: 'none' });
    const help = await chat.say('What can you do?');
    expect(help.say).toBe(
      'I can send a direct message, or create a channel. Tap one, or just tell me what you need.'
    );
    expect(help.display).toMatchObject({ kind: 'choices' });

    chat.hears({ kind: 'greeting', area: 'none' });
    expect((await chat.say('hi')).say).toBe('Hi! What can I do for you?');

    chat.hears({ kind: 'thanks', area: 'none' });
    expect(await chat.say('thanks')).toMatchObject({ say: 'You’re welcome.', expectsReply: false });
  });

  it('offers to ask Xyne AI a question', async () => {
    const chat = assistant();
    chat.hears({ kind: 'question', area: 'none' });
    const reply = await chat.say('what did we decide about the launch?');
    expect(reply).toMatchObject({
      say: 'That’s one for Xyne AI. Want me to ask it?',
      handoff: { to: 'ask_ai', text: 'what did we decide about the launch?' },
    });
  });

  it('answers help in the middle of a request, then asks its question again', async () => {
    const chat = assistant();
    chat.hears({ area: 'channels', action: 'create_channel' });
    await chat.say('create a channel');

    chat.hears({ kind: 'help', area: 'none', continues: 0.1 });
    const reply = await chat.say('what can you do?');
    expect(reply.say).toBe(
      'I can send a direct message, or create a channel. Now, what should I name the channel?'
    );
    expect(chat.session().conversation.active?.asking).toBe('name');
  });

  it('takes a greeting as the message when asked what to say', async () => {
    const chat = assistant();
    chat.hears({ area: 'messaging', action: 'send_dm', fields: { recipient: 'Daniel Okafor' } });
    expect((await chat.say('message Daniel Okafor')).say).toBe(
      'What should I say to Daniel Okafor?'
    );

    chat.hears({ kind: 'greeting', area: 'none', continues: 0.2 });
    const sent = await chat.say('hello');
    expect(sent.run?.plan[2]).toMatchObject({ op: 'send_message', text: 'hello' });
  });

  it('asks "did you mean" when two actions are close, and uses the original words after the tap', async () => {
    const chat = assistant();
    const scripted = chat.services.askJev;
    // Two actions equally likely; the later request for the words is answered as scripted.
    const close: TurnServices['askJev'] = async (state, questions) =>
      !('area' in questions)
        ? scripted(state, questions)
        : Object.fromEntries(
            Object.entries(questions).map(([id, question]) => {
              if (question.type === 'noul') return [id, { type: 'noul', noul: 0 }];
              const labels = Object.keys(question.criteria);
              const probabilities = Object.fromEntries(
                labels.map((label) => [label, 1 / labels.length])
              );
              if (id === 'area')
                Object.assign(probabilities, { messaging: 0.45, channels: 0.45, none: 0.1 });
              if (id === 'action_in_messaging')
                Object.assign(probabilities, { send_dm: 0.95, none: 0.05 });
              if (id === 'action_in_channels')
                Object.assign(probabilities, { create_channel: 0.95, none: 0.05 });
              return [id, { type: 'choice', choice: labels[0], confidence: 0.5, probabilities }];
            })
          );
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
    chat.hears({ area: 'none' });
    const reply = await chat.say('what is the weather');
    expect(reply.say).toMatch(/^I can’t do that yet\. I can /);
    // The closest actions, at most four, as buttons that start them.
    expect(
      reply.display?.kind === 'choices' && reply.display.options.map((option) => option.id)
    ).toEqual(expect.arrayContaining(['create_channel', 'send_dm']));
    expect(reply.display?.kind === 'choices' && reply.display.options).toHaveLength(4);
    const started = await chat.tap('create_channel');
    expect(started.say).toBe('What should I name the channel?');
  });

  it('reports a name it could not find, and a plan that failed', async () => {
    const chat = assistant();
    chat.hears({
      area: 'messaging',
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
    chat.hears({ area: 'channels', action: 'create_channel' });
    await chat.say('create a channel');
    const again = await chat.say('no');
    expect(again.say).toBe('No problem. What should I name the channel? Or say “cancel” to stop.');
    expect(chat.session().conversation.active?.action).toBe('create_channel');
  });

  it('cancels at any time without a model', async () => {
    const chat = assistant();
    chat.hears({ area: 'channels', action: 'create_channel' });
    await chat.say('create a channel');
    const before = chat.jevCalls();
    const cancelled = await chat.say('never mind');
    expect(cancelled.say).toBe('Okay, I’ve cancelled that.');
    expect(chat.jevCalls()).toBe(before);
    expect(chat.session().conversation.active).toBeNull();
  });
});
