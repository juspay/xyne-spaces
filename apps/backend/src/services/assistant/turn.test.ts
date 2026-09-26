import { ACTIONS, type TurnInput, type TurnResponse } from '@xyne/shared/assistant';
import type { JevAnswer } from '@/services/queryIntent/jevClient';
import type { ReadDetails } from './details';
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

const identity = { workspaceId: 'w1', userId: 'me', sessionId: 's1' };

/** Jev's answers as scripted by each test: which area, which action, and whether it continues. */
interface JevScript {
  area?: string;
  action?: string;
  continues?: number;
}

function choiceOf(chosen: string, labels: string[]): JevAnswer {
  const probabilities = Object.fromEntries(
    labels.map(label => [label, label === chosen ? 0.9 : 0.1 / (labels.length - 1)]),
  );
  return { type: 'choice', choice: chosen, confidence: 0.9, probabilities };
}

/** A conversation against fake services; `say` sends one turn and returns the response. */
function assistant(people: FoundRecord[] = [daniel]) {
  let session: AssistantSession = EMPTY_SESSION;
  let ids = 0;
  let jev: JevScript = {};
  let details: ReadDetails = { action: null, fields: {} };
  const detailCalls: string[][] = [];

  const services: TurnServices = {
    catalog: ACTIONS,
    sessions: {
      load: async () => session,
      save: async (_identity, next) => {
        session = next;
      },
    },
    records: {
      find: async (kind, mention) =>
        kind === 'person'
          ? people.filter(({ record }) => record.name.toLowerCase().includes(mention.toLowerCase()))
          : [],
    },
    askJev: async (_state, questions) => {
      const answers: Record<string, JevAnswer> = {};
      for (const [id, question] of Object.entries(questions)) {
        if (question.type === 'noul') {
          answers[id] = { type: 'noul', noul: jev.continues ?? 0 };
          continue;
        }
        const labels = Object.keys(question.criteria);
        const wanted = id === 'area' ? jev.area : jev.action;
        answers[id] = choiceOf(wanted && labels.includes(wanted) ? wanted : 'none', labels);
      }
      return answers;
    },
    readDetails: async (_text, candidates) => {
      detailCalls.push(candidates.map(action => action.id));
      return details;
    },
    newId: () => `id-${++ids}`,
  };

  const send = (input: TurnInput): Promise<TurnResponse> => handleTurn(input, identity, services);
  return {
    services,
    detailCalls,
    session: () => session,
    /** Scripts what Jev and LiteLLM will answer for the next sentence. */
    hears(script: JevScript, read: ReadDetails): void {
      jev = script;
      details = read;
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
    chat.hears(
      { area: 'messaging', action: 'send_dm' },
      { action: 'send_dm', fields: { recipient: 'Daniel Okafor', message: 'hello' } },
    );
    const planned = await chat.say('create a DM with Daniel Okafor and message hello');
    expect(planned.say).toBe('');
    expect(planned.run?.plan).toEqual([
      { op: 'open_or_create_dm', user: daniel.record },
      { op: 'send_message', target: { fromStep: 0 }, text: 'hello' },
      { op: 'navigate', target: { fromStep: 0 } },
    ]);
    // Details were read once, for every action, alongside Jev — not again afterwards.
    expect(chat.detailCalls).toEqual([['send_dm', 'create_channel']]);

    const done = await chat.ran(planned.run!.runId, [{ ok: true }, { ok: true }, { ok: true }]);
    expect(done.say).toBe('Sent to Daniel Okafor.');
    expect(chat.session().run).toBeNull();
  });

  it('previews when a name only partly matched, and runs on "yes" without a model', async () => {
    const chat = assistant();
    chat.hears(
      { area: 'messaging', action: 'send_dm' },
      { action: 'send_dm', fields: { recipient: 'Daniel', message: 'hi' } },
    );
    const preview = await chat.say('tell daniel hi');
    expect(preview.say).toBe('Send “hi” to Daniel Okafor?');
    expect(preview.display).toEqual({
      kind: 'preview',
      summary: 'Send “hi” to Daniel Okafor',
      confirmLabel: 'Yes',
      cancelLabel: 'Cancel',
    });
    chat.hears({}, { action: null, fields: {} });
    const yes = await chat.say('yes');
    expect(yes.run?.plan).toHaveLength(3);
    expect(chat.detailCalls).toHaveLength(1);
  });

  it('asks which Daniel, with buttons, and continues from the tap', async () => {
    const chat = assistant([daniel, danielPark]);
    chat.hears(
      { area: 'messaging', action: 'send_dm' },
      { action: 'send_dm', fields: { recipient: 'Daniel', message: 'hi' } },
    );
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
    chat.hears({ area: 'channels', action: 'create_channel' }, { action: 'create_channel', fields: {} });
    expect((await chat.say('create a channel')).say).toBe('What should I name the channel?');

    chat.hears({ continues: 0.95 }, { action: 'create_channel', fields: { name: 'ABC' } });
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

  it('asks "did you mean" when two actions are close, and uses the original words after the tap', async () => {
    const chat = assistant();
    const close: TurnServices['askJev'] = async (_state, questions) =>
      Object.fromEntries(
        Object.entries(questions).map(([id, question]) => {
          if (question.type === 'noul') return [id, { type: 'noul', noul: 0 }];
          const labels = Object.keys(question.criteria);
          const probabilities = Object.fromEntries(labels.map(label => [label, 1 / labels.length]));
          if (id === 'area') Object.assign(probabilities, { messaging: 0.45, channels: 0.45, none: 0.1 });
          if (id === 'action_in_messaging') Object.assign(probabilities, { send_dm: 0.95, none: 0.05 });
          if (id === 'action_in_channels') Object.assign(probabilities, { create_channel: 0.95, none: 0.05 });
          return [id, { type: 'choice', choice: labels[0], confidence: 0.5, probabilities }];
        }),
      );
    chat.services.askJev = close;
    chat.hears({}, { action: null, fields: {} });
    const which = await chat.say('ABC hello');
    expect(which.say).toBe('Did you mean to send a direct message, or create a channel?');

    chat.hears({}, { action: 'create_channel', fields: { name: 'ABC', firstMessage: 'hello' } });
    const next = await chat.tap('create_channel');
    expect(next.say).toBe('Should it be public or private?');
    expect(chat.session().conversation.active?.values).toEqual({ name: 'ABC', firstMessage: 'hello' });
  });

  it('says what it can do when nothing fits', async () => {
    const chat = assistant();
    chat.hears({ area: 'none' }, { action: null, fields: {} });
    const reply = await chat.say('what is the weather');
    expect(reply.say).toBe('I can’t do that yet. I can send a direct message, or create a channel.');
  });

  it('reports a name it could not find, and a plan that failed', async () => {
    const chat = assistant();
    chat.hears(
      { area: 'messaging', action: 'send_dm' },
      { action: 'send_dm', fields: { recipient: 'Zorro', message: 'hi' } },
    );
    expect((await chat.say('message Zorro hi')).say).toBe(
      "I couldn't find “Zorro”. Who should I message?",
    );

    chat.hears({ continues: 0.9 }, { action: 'send_dm', fields: { recipient: 'Daniel Okafor' } });
    const planned = await chat.say('Daniel Okafor');
    const failed = await chat.ran(planned.run!.runId, [{ ok: true }, { ok: false, error: 'the DM is closed' }]);
    expect(failed).toMatchObject({ say: 'That didn’t finish: the DM is closed', tone: 'error' });
  });

  it('refuses plan results that belong to no running plan', async () => {
    const chat = assistant();
    const reply = await chat.ran('someone-else', [{ ok: true }]);
    expect(reply).toMatchObject({ tone: 'error' });
  });

  it('cancels at any time without a model', async () => {
    const chat = assistant();
    chat.hears({ area: 'channels', action: 'create_channel' }, { action: 'create_channel', fields: {} });
    await chat.say('create a channel');
    const detailsBefore = chat.detailCalls.length;
    const cancelled = await chat.say('never mind');
    expect(cancelled.say).toBe('Okay, I’ve cancelled that.');
    expect(chat.detailCalls).toHaveLength(detailsBefore);
    expect(chat.session().conversation.active).toBeNull();
  });
});
