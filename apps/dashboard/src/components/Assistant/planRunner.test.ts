import { describe, expect, it } from 'vitest';
import type { ChannelRef, PersonRef, Plan } from '@xyne/shared/assistant';
import { runPlan, type AppActions } from './planRunner';

const daniel: PersonRef = { kind: 'person', id: 'u-daniel', name: 'Daniel Okafor' };
const dm: ChannelRef = { kind: 'channel', id: 'c-dm', name: 'Daniel Okafor', isDirect: true };

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
    navigate: ({ channelId, threadId }) => {
      calls.push(`go ${channelId}${threadId ? `/${threadId}` : ''}`);
    },
    ...overrides,
  };
  return { actions, calls };
}

describe('running a plan', () => {
  it('opens the DM, sends in it, and goes there', async () => {
    const { actions, calls } = recordingActions();
    const plan: Plan = [
      { op: 'open_or_create_dm', user: daniel },
      { op: 'send_message', target: { fromStep: 0 }, text: 'hello' },
      { op: 'navigate', target: { fromStep: 0 } },
    ];
    const results = await runPlan(plan, actions);
    expect(calls).toEqual(['dm u-daniel', 'send c-dm hello', 'go c-dm']);
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
            channelName: 'mobile-perf',
          },
        },
      ],
      actions,
    );
    expect(calls).toEqual(['send c-general do the RCA @u-daniel', 'go c-perf/t-1']);
  });

  it('fails a step that points at a step which opened nothing', async () => {
    const { actions } = recordingActions();
    const results = await runPlan([{ op: 'navigate', target: { fromStep: 0 } }], actions);
    expect(results).toEqual([{ ok: false, error: 'step 0 did not open a conversation' }]);
  });
});
