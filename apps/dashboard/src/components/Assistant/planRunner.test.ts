import { describe, expect, it } from 'vitest';
import type { MutatorResultDetails } from '@rocicorp/zero';
import type { ChannelRef, MessageRef, PersonRef, Plan, ThreadRef } from '@xyne/shared/assistant';
import { runPlan, type AppActions, type PlanStep } from './planRunner';
import { requireServerMutation } from './serverMutation';

const daniel: PersonRef = { kind: 'person', id: 'u-daniel', name: 'Daniel Okafor' };
const dm: ChannelRef = { kind: 'channel', id: 'c-dm', name: 'Daniel Okafor', isDirect: true };
const thread: ThreadRef = {
  kind: 'thread',
  id: 't-1',
  name: 'Release notes',
  channelId: 'c-release',
  channelName: 'release',
};
const message: MessageRef = {
  kind: 'message',
  id: 'm-1',
  name: 'The build is green',
  channelId: 'c-release',
};

/** App actions that record every call, in order. */
function recordingActions(overrides: Partial<AppActions> = {}): {
  actions: AppActions;
  calls: string[];
} {
  const calls: string[] = [];
  const actions: AppActions = {
    openOrCreateDm: user => {
      calls.push(`dm ${user.id}`);
      return Promise.resolve(dm);
    },
    createChannel: channel => {
      const members = channel.members.map(member => member.id).join(',');
      calls.push(`create ${channel.name} ${channel.visibility} [${members}]`);
      return Promise.resolve({ kind: 'channel', id: 'c-new', name: channel.name });
    },
    sendMessage: (channelId, text, mentions) => {
      const tagged = mentions.map(person => ` @${person.id}`).join('');
      calls.push(`send ${channelId} ${text}${tagged}`);
      return Promise.resolve();
    },
    replyInThread: (threadId, text, mentions) => {
      const tagged = mentions.map(person => ` @${person.id}`).join('');
      calls.push(`reply ${threadId} ${text}${tagged}`);
      return Promise.resolve();
    },
    forwardMessage: (messageId, channelId) => {
      calls.push(`forward ${messageId} ${channelId}`);
      return Promise.resolve();
    },
    navigate: ({ channelId, threadId }) => {
      calls.push(`go ${channelId}${threadId ? `/${threadId}` : ''}`);
    },
    ...overrides,
  };
  return { actions, calls };
}

describe('running a plan', () => {
  it('finds the DM, opens it, then sends, so the message lands in view', async () => {
    const { actions, calls } = recordingActions();
    const plan: Plan = [
      { op: 'open_or_create_dm', user: daniel },
      { op: 'navigate', target: { fromStep: 0 } },
      { op: 'send_message', target: { fromStep: 0 }, text: 'hello' },
    ];
    const results = await runPlan(plan, actions);
    expect(calls).toEqual(['dm u-daniel', 'go c-dm', 'send c-dm hello']);
    expect(results).toEqual([{ ok: true, produced: dm }, { ok: true }, { ok: true }]);
  });

  it('creates a channel with its members, posts, and goes there', async () => {
    const { actions, calls } = recordingActions();
    const plan: Plan = [
      { op: 'create_channel', name: 'ABC', visibility: 'private', members: [daniel] },
      { op: 'send_message', target: { fromStep: 0 }, text: 'welcome' },
      { op: 'navigate', target: { fromStep: 0 } },
    ];
    await runPlan(plan, actions);
    expect(calls).toEqual(['create ABC private [u-daniel]', 'send c-new welcome', 'go c-new']);
  });

  it('stops at the first failure and reports the server’s reason', async () => {
    const refused = Object.assign(new Error('Request failed with status code 403'), {
      response: { data: { error: 'You cannot message this user' } },
    });
    const { actions, calls } = recordingActions({
      sendMessage: () => Promise.reject(refused),
    });
    const results = await runPlan(
      [
        { op: 'open_or_create_dm', user: daniel },
        { op: 'send_message', target: { fromStep: 0 }, text: 'hello' },
        { op: 'navigate', target: { fromStep: 0 } },
      ],
      actions,
    );
    expect(calls).toEqual(['dm u-daniel']);
    expect(results).toEqual([
      { ok: true, produced: dm },
      { ok: false, error: 'You cannot message this user' },
    ]);
  });

  it('does not continue after Zero reports a server-side mutation error', async () => {
    const { actions, calls } = recordingActions({
      openOrCreateDm: async user => {
        calls.push(`dm ${user.id}`);
        const server: Promise<MutatorResultDetails> = Promise.resolve({
          type: 'error',
          error: { type: 'app', message: 'The conversation is unavailable.', details: undefined },
        });
        await requireServerMutation({ server }, 'Could not reopen the direct message.');
        return dm;
      },
    });

    const results = await runPlan(
      [
        { op: 'open_or_create_dm', user: daniel },
        { op: 'navigate', target: { fromStep: 0 } },
      ],
      actions,
    );

    expect(calls).toEqual(['dm u-daniel']);
    expect(results).toEqual([
      { ok: false, error: 'Could not reopen the direct message. The conversation is unavailable.' },
    ]);
  });

  it('opens a channel that was found', async () => {
    const { actions, calls } = recordingActions();
    const android: ChannelRef = { kind: 'channel', id: 'c-android', name: 'android' };
    const results = await runPlan([{ op: 'navigate', target: android }], actions);
    expect(calls).toEqual(['go c-android']);
    expect(results).toEqual([{ ok: true }]);
  });

  it('posts with mentions, and opens a thread that was found', async () => {
    const { actions, calls } = recordingActions();
    const general: ChannelRef = { kind: 'channel', id: 'c-general', name: 'general' };
    await runPlan(
      [
        { op: 'send_message', target: general, text: 'do the RCA', mentions: [daniel] },
        {
          op: 'navigate',
          target: {
            kind: 'thread',
            id: 't-1',
            name: 'Reduce startup work',
            channelId: 'c-perf',
            channelName: 'releases',
          },
        },
      ],
      actions,
    );
    expect(calls).toEqual(['send c-general do the RCA @u-daniel', 'go c-perf/t-1']);
  });

  it('replies to the thread conversation id and waits for it before finishing', async () => {
    const { actions, calls } = recordingActions();
    const results = await runPlan(
      [
        { op: 'navigate', target: thread },
        { op: 'send_message', target: thread, text: 'looks good', mentions: [daniel] },
      ],
      actions,
    );
    expect(calls).toEqual(['go c-release/t-1', 'reply t-1 looks good @u-daniel']);
    expect(results).toEqual([{ ok: true }, { ok: true }]);
  });

  it('sends a requested agent mention as a reply in the selected thread', async () => {
    const doctor: PersonRef = { kind: 'person', id: 'u-xyne-doctor', name: 'Xyne Doctor' };
    const { actions, calls } = recordingActions();

    await runPlan(
      [
        { op: 'navigate', target: thread },
        { op: 'send_message', target: thread, text: 'do an RCA', mentions: [doctor] },
      ],
      actions,
    );

    expect(calls).toEqual(['go c-release/t-1', 'reply t-1 do an RCA @u-xyne-doctor']);
  });

  it('forwards the selected message to an existing channel', async () => {
    const { actions, calls } = recordingActions();
    const target: ChannelRef = { kind: 'channel', id: 'c-design', name: 'design' };
    const results = await runPlan([{ op: 'forward_message', message, target }], actions);
    expect(calls).toEqual(['forward m-1 c-design']);
    expect(results).toEqual([{ ok: true }]);
  });

  it('forwards to the DM opened earlier in the plan', async () => {
    const { actions, calls } = recordingActions();
    await runPlan(
      [
        { op: 'open_or_create_dm', user: daniel },
        { op: 'navigate', target: { fromStep: 0 } },
        { op: 'forward_message', message, target: { fromStep: 0 } },
      ],
      actions,
    );
    expect(calls).toEqual(['dm u-daniel', 'go c-dm', 'forward m-1 c-dm']);
  });

  it('stops the plan when the server rejects a forward', async () => {
    const { actions, calls } = recordingActions({
      forwardMessage: (messageId, channelId) => {
        calls.push(`forward ${messageId} ${channelId}`);
        return Promise.reject(new Error('You are not a participant of the target channel'));
      },
    });
    const results = await runPlan(
      [
        { op: 'forward_message', message, target: dm },
        { op: 'navigate', target: dm },
      ],
      actions,
    );
    expect(calls).toEqual(['forward m-1 c-dm']);
    expect(results).toEqual([
      { ok: false, error: 'You are not a participant of the target channel' },
    ]);
  });

  it('marks replies and forwards with distinct progress labels', async () => {
    const { actions } = recordingActions();
    const updates: PlanStep[][] = [];
    await runPlan(
      [
        { op: 'send_message', target: thread, text: 'looks good' },
        { op: 'forward_message', message, target: dm },
      ],
      actions,
      steps => updates.push(steps),
    );
    expect(updates.at(-1)).toEqual([
      { label: 'Replied “looks good” in the thread', status: 'done' },
      { label: 'Forwarded the message to your DM with Daniel Okafor', status: 'done' },
    ]);
  });

  it('fails a step that points at a step which opened nothing', async () => {
    const { actions } = recordingActions();
    const results = await runPlan([{ op: 'navigate', target: { fromStep: 0 } }], actions);
    expect(results).toEqual([{ ok: false, error: 'step 0 did not open a conversation' }]);
  });

  it('reports each step as it runs, in words, and marks the one that failed', async () => {
    const { actions } = recordingActions({
      sendMessage: () => Promise.reject(new Error('offline')),
    });
    const updates: PlanStep[][] = [];
    await runPlan(
      [
        { op: 'create_channel', name: 'ops', visibility: 'public', members: [daniel] },
        { op: 'navigate', target: { fromStep: 0 } },
        { op: 'send_message', target: { fromStep: 0 }, text: 'hello' },
      ],
      actions,
      steps => updates.push(steps),
    );
    expect(updates[0]?.map(step => step.status)).toEqual(['waiting', 'waiting', 'waiting']);
    expect(updates.at(-1)).toEqual([
      { label: 'Created “ops” with Daniel Okafor', status: 'done' },
      { label: 'Opened “ops”', status: 'done' },
      { label: 'Sending “hello”', status: 'failed' },
    ]);
  });
});
