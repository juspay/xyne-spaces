import type { DecisionAnswer, DecisionQuestion } from '@/services/decision/types';
import { DEFAULT_PROACTIVITY_CONFIG, mergeConfig, type ProactivityConfig } from './config';
import { ProactivityPolicy, type XorClient } from './policy';
import type {
  AgentCard,
  Draft,
  Episode,
  NewMessage,
  Room,
  Snapshot,
  SnapshotMessage,
} from './types';

const config: ProactivityConfig = { ...DEFAULT_PROACTIVITY_CONFIG, enabled: true };
const NOW = 1_700_000_000_000;

/** A fake XOR: every yes/no gets `fallback`, unless its key or its question is overridden. */
type FakeXor = XorClient & { calls: Array<Record<string, DecisionQuestion>> };

/** A fake XOR: every yes/no gets `fallback`, unless its key or its question is overridden. */
function fakeXor(overrides: Record<string, number> = {}, fallback = 0.1): FakeXor {
  const calls: Array<Record<string, DecisionQuestion>> = [];
  const ask: XorClient = async (_state, questions) => {
    calls.push(questions);
    const answers: Record<string, DecisionAnswer> = {};
    for (const [key, asked] of Object.entries(questions)) {
      if (asked.type === 'choice') {
        // An even split unless an override names an option: `best_agent_0`.
        const options = Object.keys(asked.criteria);
        const probabilities = Object.fromEntries(
          options.map((o) => [o, overrides[`${key}_${o}`] ?? 1 / options.length])
        );
        answers[key] = { type: 'choice', choice: options[0], probabilities };
        continue;
      }
      // `m1_needs_an_answer` is message m1's `needs_an_answer`; an override names either the whole key or the question.
      const question = key.slice(key.indexOf('_') + 1);
      // The gate questions a message must pass with a yes default to passing them.
      const p =
        overrides[key] ??
        overrides[question] ??
        (question === 'info_not_a_task' || question === 'anyone_could_answer' ? 0.95 : fallback);
      answers[key] = { type: 'noul', noul: p };
    }
    return answers;
  };
  return Object.assign(ask, { calls });
}

const msg = (
  label: string,
  text: string,
  senderId = 'alice',
  fromAgent = false
): SnapshotMessage => ({
  label,
  messageId: `id-${label}`,
  conversationId: `conv-${label}`,
  senderId,
  senderName: senderId,
  fromAgent,
  text,
  at: NOW,
});

const snapshot = (over: Partial<Snapshot> = {}): Snapshot => ({
  channelName: 'payments',
  mode: 'ANSWER',
  askerId: 'alice',
  askerName: 'Alice',
  asked: [msg('m1', 'what is the payouts API rate limit?')],
  before: [],
  after: [],
  othersTyping: false,
  agentEngaged: false,
  now: NOW,
  ...over,
});

const message = (over: Partial<NewMessage> = {}): NewMessage => ({
  messageId: 'id-m1',
  conversationId: 'conv-m1',
  channelId: 'c1',
  workspaceId: 'w1',
  senderId: 'alice',
  fromPerson: true,
  isReply: false,
  tagsAgent: false,
  mentionsPeople: false,
  text: 'what is the payouts API rate limit?',
  createdAt: NOW,
  ...over,
});

const room = (over: Partial<Room> = {}): Room => ({
  channelId: 'c1',
  mode: 'ANSWER',
  isDirect: false,
  customerFacing: false,
  exchange: null,
  ownQuietThread: false,
  ...over,
});

const OPEN = { needs_an_answer: 0.9 };

describe('ProactivityPolicy.watch', () => {
  const policy = new ProactivityPolicy(config, fakeXor());

  it('starts an episode for a person in an Answer channel', () => {
    expect(policy.watch(message(), room()).kind).toBe('episode');
  });

  it.each([
    [
      'disabled',
      new ProactivityPolicy({ ...config, enabled: false }, fakeXor()),
      message(),
      room(),
    ],
    ['not_a_person', policy, message({ fromPerson: false }), room()],
    ['direct_message', policy, message(), room({ isDirect: true })],
    ['customer_facing', policy, message(), room({ customerFacing: true })],
    ['channel_off', policy, message(), room({ mode: 'OFF' })],
    ['tags_agent', policy, message({ tagsAgent: true }), room()],
  ])('ignores: %s', (reason, p, m, r) => {
    expect(p.watch(m, r)).toEqual({ kind: 'ignore', reason });
  });

  it('watches a reply in a conversation separately from adding to your own question', () => {
    expect(policy.watch(message({ isReply: true }), room())).toEqual({
      kind: 'episode',
      reason: 'watching_reply',
    });
    expect(policy.watch(message({ isReply: true }), room({ ownQuietThread: true }))).toEqual({
      kind: 'episode',
      reason: 'watching',
    });
  });

  it('treats a reply in a thread an agent answered as a follow-up', () => {
    const exchange = {
      episodeId: 'e',
      agentSlug: 'triage',
      agentUserId: 'bot',
      replyMessageId: 'r',
      followUps: 0,
    };
    expect(policy.watch(message({ isReply: true }), room({ exchange })).kind).toBe('followUp');
  });
});

describe('ProactivityPolicy.timer', () => {
  let now = NOW;
  const policy = new ProactivityPolicy(config, fakeXor(), () => now);
  const episode = (over: Partial<Episode> = {}): Episode => ({
    id: 'e',
    workspaceId: 'w',
    channelId: 'c',
    senderId: 'alice',
    messageIds: ['a'],
    firstAt: NOW,
    lastAt: NOW,
    resets: 0,
    deadline: 0,
    graceUsed: false,
    inConversation: false,
    scope: 'alice',
    mentionsPeople: false,
    ...over,
  });

  it('waits 60s after the last message', () => {
    expect(policy.timer(episode({ lastAt: NOW + 30_000, resets: 1 })).at).toBe(NOW + 90_000);
  });

  it('never waits past three minutes from the first', () => {
    expect(policy.timer(episode({ lastAt: NOW + 170_000, resets: 3 })).at).toBe(NOW + 180_000);
  });

  it('stops restarting after five resets', () => {
    expect(
      policy.timer(episode({ lastAt: NOW + 100_000, resets: 6, deadline: NOW + 95_000 })).at
    ).toBe(NOW + 95_000);
  });

  it('gives people who were tagged five minutes to answer first', () => {
    expect(policy.timer(episode({ mentionsPeople: true, lastAt: NOW })).at).toBe(NOW + 300_000);
  });

  it('lets the people in a conversation go first: a reply waits ten minutes', () => {
    expect(policy.timer(episode({ inConversation: true, lastAt: NOW })).at).toBe(NOW + 600_000);
  });

  it('gives someone typing one grace period', () => {
    now = NOW + 61_000;
    expect(policy.timer(episode(), true)).toEqual({ at: now + 20_000, grace: true });
    expect(policy.timer(episode({ graceUsed: true }), true)).toEqual({
      at: NOW + 60_000,
      grace: false,
    });
  });
});

describe('ProactivityPolicy.gate', () => {
  it('passes an open question, asking every question in one request', async () => {
    const xor = fakeXor(OPEN);
    const gate = await new ProactivityPolicy(config, xor).gate(snapshot());
    expect(gate).toMatchObject({ outcome: 'open', passed: ['m1'] });
    expect(xor.calls).toHaveLength(1);
    // already_answered and someone_took_it only once someone has said something since
    expect(Object.keys(xor.calls[0])).toHaveLength(5);
  });

  it.each([
    ['asks_nothing', { needs_an_answer: 0.3 }],
    ['personal_matter', { ...OPEN, personal_matter: 0.8 }],
    ['already_answered', { ...OPEN, already_answered: 0.7 }, [msg('r1', 'go/runbook', 'dana')]],
    ['someone_took_it', { ...OPEN, someone_took_it: 0.7 }, [msg('r1', 'on it', 'dana')]],
    ['not_info_not_a_task', { ...OPEN, info_not_a_task: 0.3 }],
    ['not_anyone_could_answer', { ...OPEN, anyone_could_answer: 0.3 }],
  ])('stays quiet: %s', async (reason, probabilities, after: SnapshotMessage[] = []) => {
    const gate = await new ProactivityPolicy(config, fakeXor(probabilities)).gate(
      snapshot({ after })
    );
    expect(gate).toMatchObject({ outcome: 'quiet', reason });
  });

  it('keeps the probability of the question that kept it quiet', async () => {
    const quiet = (probabilities: Record<string, number>) =>
      new ProactivityPolicy(config, fakeXor(probabilities)).gate(snapshot());
    expect(await quiet({ ...OPEN, personal_matter: 0.8 })).toMatchObject({
      reason: 'personal_matter',
      score: 0.8,
    });
    expect(await quiet({ needs_an_answer: 0.3 })).toMatchObject({
      reason: 'asks_nothing',
      score: 0.3,
    });
  });

  it('passes when one of several messages clears every question', async () => {
    const asked = [msg('m1', 'quick q'), msg('m2', 'what is the rollback runbook link?')];
    const gate = await new ProactivityPolicy(config, fakeXor({ m2_needs_an_answer: 0.9 })).gate(
      snapshot({ asked })
    );
    expect(gate).toMatchObject({ outcome: 'open', passed: ['m2'] });
  });

  it('spots a bump of an earlier question, even one that reads as a question', async () => {
    const gate = await new ProactivityPolicy(config, fakeXor({ ...OPEN, just_a_nudge: 0.9 })).gate(
      snapshot({ asked: [msg('m1', 'anyone?')] })
    );
    expect(gate.outcome).toBe('bump');
  });

  it('treats a ping to a named person as theirs, not as a bump', async () => {
    const gate = await new ProactivityPolicy(
      config,
      fakeXor({ ...OPEN, just_a_nudge: 0.9, anyone_could_answer: 0.3 })
    ).gate(snapshot({ asked: [msg('m1', '@Dana were you able to check this?')] }));
    expect(gate).toMatchObject({ outcome: 'quiet', reason: 'not_anyone_could_answer' });
  });

  it('leaves a reply meant for the person they are talking with to them', async () => {
    const before = [msg('b1', 'we only see it on the mobile app', 'dana')];
    const ask = (forAnyone: number) =>
      new ProactivityPolicy(config, fakeXor({ ...OPEN, anyone_could_answer: forAnyone })).gate(
        snapshot({ before, asked: [msg('m1', 'is this for your mobile app?')] })
      );
    expect(await ask(0.2)).toMatchObject({ outcome: 'quiet', reason: 'not_anyone_could_answer' });
    expect((await ask(0.95)).outcome).toBe('open');
  });

  it('stays out of a thread an agent is already on, without asking XOR', async () => {
    const xor = fakeXor(OPEN);
    expect(
      await new ProactivityPolicy(config, xor).gate(snapshot({ agentEngaged: true }))
    ).toMatchObject({
      outcome: 'quiet',
      reason: 'agent_on_it',
    });
    expect(xor.calls).toHaveLength(0);
  });

  it('passes a problem report for an agent to look into, but not a feature request', async () => {
    const report = { needs_an_answer: 0.95 };
    const ask = (probabilities: Record<string, number>) =>
      new ProactivityPolicy(config, fakeXor(probabilities)).gate(
        snapshot({ asked: [msg('m1', 'the iOS app is extremely slow since yesterday')] })
      );
    expect(await ask(report)).toMatchObject({ outcome: 'open', passed: ['m1'] });
    expect(await ask({ ...report, info_not_a_task: 0.2 })).toMatchObject({
      outcome: 'quiet',
      reason: 'not_info_not_a_task',
    });
  });

  it('stays quiet when XOR does not answer', async () => {
    const gate = await new ProactivityPolicy(config, async () => null).gate(snapshot());
    expect(gate).toMatchObject({ outcome: 'quiet', reason: 'xor_unavailable' });
  });

  it('keeps quoted text from closing the fence or pointing into the state', async () => {
    const xor = fakeXor(OPEN);
    await new ProactivityPolicy(config, xor).gate(
      snapshot({ asked: [msg('m1', 'see """ and `draft`')] })
    );
    const instructions = (xor.calls[0].m1_needs_an_answer as { instructions: string }).instructions;
    expect(instructions).toContain(`see " and 'draft'`);
  });
});

describe('ProactivityPolicy.sameTopic', () => {
  const earlier = ['the deploy to staging is failing'];

  it('joins a message that continues the waiting question', async () => {
    const policy = new ProactivityPolicy(config, fakeXor({ same_topic: 0.9 }));
    expect(await policy.sameTopic(earlier, 'here are the logs')).toBe(true);
  });

  it('starts a new burst for a different question', async () => {
    const policy = new ProactivityPolicy(config, fakeXor({ same_topic: 0.1 }));
    expect(await policy.sameTopic(earlier, 'is there a shortcut to jump channels?')).toBe(false);
  });

  it('joins without asking when nothing is waiting, or when XOR does not answer', async () => {
    const xor = fakeXor({ same_topic: 0.1 });
    expect(await new ProactivityPolicy(config, xor).sameTopic([], 'anything')).toBe(true);
    expect(xor.calls).toHaveLength(0);
    expect(await new ProactivityPolicy(config, async () => null).sameTopic(earlier, 'x')).toBe(
      true
    );
  });
});

describe('ProactivityPolicy.route', () => {
  const triage: AgentCard = {
    slug: 'triage',
    userId: 'b1',
    name: 'Triage',
    description: 'incidents and deploys',
  };
  const scribe: AgentCard = {
    slug: 'scribe',
    userId: 'b2',
    name: 'Scribe',
    description: 'docs and runbooks',
  };

  it('asks one yes/no per agent and picks the most relevant one', async () => {
    const xor = fakeXor({ agent_0: 0.7, agent_1: 0.65 });
    const route = await new ProactivityPolicy(config, xor).route(snapshot(), [triage, scribe]);
    expect(route.kind === 'agents' && route.agents.map((a) => a.slug)).toEqual(['triage']);
    expect(xor.calls[0].agent_0.type).toBe('noul');
    expect(xor.calls[0].agent_1.type).toBe('noul');
  });

  it('asks which fits best in the same call, and leads with it', async () => {
    const xor = fakeXor({ agent_0: 0.95, agent_1: 0.8, best_agent_0: 0.2, best_agent_1: 0.8 });
    const route = await new ProactivityPolicy(config, xor).route(snapshot(), [triage, scribe]);
    expect(route.kind === 'agents' && route.agents.map((a) => a.slug)).toEqual(['scribe']);
    expect(xor.calls).toHaveLength(1);
    expect(xor.calls[0].best.type).toBe('choice');
    const one = fakeXor({ agent_0: 0.7 });
    await new ProactivityPolicy(config, one).route(snapshot(), [triage]);
    expect(one.calls[0].best).toBeUndefined();
  });

  it('answers with the best pick when it is relevant enough on its own', async () => {
    const relevant = await new ProactivityPolicy(
      config,
      fakeXor({ agent_0: 0.5, agent_1: 0.2, best_agent_0: 0.95, best_agent_1: 0.05 })
    ).route(snapshot(), [triage, scribe]);
    expect(relevant.kind === 'agents' && relevant.agents.map((a) => a.slug)).toEqual(['triage']);
    const notRelevant = await new ProactivityPolicy(
      config,
      fakeXor({ agent_0: 0.3, agent_1: 0.2, best_agent_0: 0.95, best_agent_1: 0.05 })
    ).route(snapshot(), [triage, scribe]);
    expect(notRelevant).toMatchObject({ kind: 'none', reason: 'no_agent_fits' });
  });

  it('runs a second agent only when the choice is close', async () => {
    const close = await new ProactivityPolicy(
      config,
      fakeXor({ agent_0: 0.95, agent_1: 0.95, best_agent_0: 0.55, best_agent_1: 0.45 })
    ).route(snapshot(), [triage, scribe]);
    expect(close.kind === 'agents' && close.agents.map((a) => a.slug)).toEqual([
      'triage',
      'scribe',
    ]);
    const clear = await new ProactivityPolicy(
      config,
      fakeXor({ agent_0: 0.95, agent_1: 0.95, best_agent_0: 0.85, best_agent_1: 0.15 })
    ).route(snapshot(), [triage, scribe]);
    expect(clear.kind === 'agents' && clear.agents.map((a) => a.slug)).toEqual(['triage']);
  });

  it('lets more agents draft only on a near-certain fit, three at most', async () => {
    const route = await new ProactivityPolicy(
      config,
      fakeXor({ agent_0: 0.92, agent_1: 0.95 })
    ).route(snapshot(), [triage, scribe]);
    expect(route.kind === 'agents' && route.agents.map((a) => a.slug)).toEqual([
      'scribe',
      'triage',
    ]);
    const one = await new ProactivityPolicy(
      config,
      fakeXor({ agent_0: 0.85, agent_1: 0.95 })
    ).route(snapshot(), [triage, scribe]);
    expect(one.kind === 'agents' && one.agents.map((a) => a.slug)).toEqual(['scribe']);
    const agents = ['a', 'b', 'c', 'd'].map((slug, i) => ({ ...triage, slug, userId: `b${i}` }));
    const many = await new ProactivityPolicy(
      config,
      fakeXor({ agent_0: 0.95, agent_1: 0.94, agent_2: 0.93, agent_3: 0.92 })
    ).route(snapshot(), agents);
    expect(many.kind === 'agents' && many.agents.map((a) => a.slug)).toEqual(['a', 'b', 'c']);
  });

  it('picks nobody when the only agent is not relevant, and asks nothing with no agents', async () => {
    expect(
      (await new ProactivityPolicy(config, fakeXor({ agent_0: 0.3 })).route(snapshot(), [triage]))
        .kind
    ).toBe('none');
    const xor = fakeXor();
    expect(await new ProactivityPolicy(config, xor).route(snapshot(), [])).toMatchObject({
      kind: 'none',
      reason: 'no_agents',
    });
    expect(xor.calls).toHaveLength(0);
  });
});

describe('ProactivityPolicy.beforePosting', () => {
  const draft = (over: Partial<Draft> = {}): Draft => ({
    agentSlug: 'triage',
    text: 'It is 1,000 a minute since the March contract.',
    toolsUsed: ['kb-search'],
    answers: ['id-m1'],
    redrafts: 0,
    waitedForTyping: false,
    ...over,
  });
  const GOOD = { draft_answers: 0.9 };

  it('posts a useful answer to a still-open question', async () => {
    const send = await new ProactivityPolicy(config, fakeXor(GOOD)).beforePosting(
      draft(),
      snapshot()
    );
    expect(send).toMatchObject({ action: 'post', correction: false });
  });

  it('asks once for a shorter draft, then holds; and holds a thread another agent is on', async () => {
    const policy = new ProactivityPolicy(config, fakeXor(GOOD));
    const long = 'x'.repeat(config.limits.maxDraftChars + 1);
    expect(await policy.beforePosting(draft({ text: long }), snapshot())).toMatchObject({
      action: 'redraft',
      reason: 'too_long',
    });
    expect(
      await policy.beforePosting(draft({ text: long, redrafts: 1 }), snapshot())
    ).toMatchObject({ action: 'hold', reason: 'too_long' });
    expect(await policy.beforePosting(draft(), snapshot({ agentEngaged: true }))).toMatchObject({
      action: 'hold',
      reason: 'agent_on_it',
    });
  });

  it('holds an empty draft without asking XOR', async () => {
    const xor = fakeXor(GOOD);
    expect(
      await new ProactivityPolicy(config, xor).beforePosting(draft({ text: ' ' }), snapshot())
    ).toMatchObject({ action: 'hold', reason: 'empty_draft' });
    expect(
      await new ProactivityPolicy(config, xor).beforePosting(draft({ text: '\u200b' }), snapshot())
    ).toMatchObject({ action: 'hold', reason: 'empty_draft' });
    expect(xor.calls).toHaveLength(0);
  });

  it('redrafts to only what is new when the draft adds to an answer, then posts it', async () => {
    const after = [msg('r1', 'the limit is 1000 a minute', 'claw', true)];
    const xor = () => fakeXor({ ...GOOD, already_answered: 0.9, adds_to_answer: 0.8 });
    expect(
      await new ProactivityPolicy(config, xor()).beforePosting(draft(), snapshot({ after }))
    ).toMatchObject({ action: 'redraft', reason: 'adds_to_answer', score: 0.8 });
    expect(
      await new ProactivityPolicy(config, xor()).beforePosting(
        draft({ redrafts: 1 }),
        snapshot({ after })
      )
    ).toMatchObject({ action: 'post', correction: false, reason: 'adds_to_answer' });
  });

  it('compares the draft with the answer in its own thread, however busy the channel', async () => {
    // Dana answers in Alice's thread, then twenty messages elsewhere bury it.
    const answer = {
      ...msg('r1', 'it is 1000 a minute', 'dana'),
      conversationId: 'conv-m1',
      at: NOW + 1,
    };
    const noise = Array.from({ length: 20 }, (_, i) => ({
      ...msg(`n${i}`, 'deploying now', 'bob'),
      at: NOW + 2 + i,
    }));
    const xor = fakeXor({ ...GOOD, already_answered: 0.9, same_answer_r1: 0.9 });
    const send = await new ProactivityPolicy(config, xor).beforePosting(
      draft(),
      snapshot({ after: [answer, ...noise] })
    );
    expect(send).toMatchObject({ action: 'react', messageId: 'id-r1' });
    expect(Object.keys(xor.calls[0]).filter((k) => k.startsWith('same_answer_'))).toHaveLength(
      config.context.comparedReplies
    );
  });

  it('reacts instead when a person already gave the same answer', async () => {
    const after = [msg('r1', '1000 a minute now', 'dana')];
    const send = await new ProactivityPolicy(
      config,
      fakeXor({ ...GOOD, already_answered: 0.9, same_answer_r1: 0.8 })
    ).beforePosting(draft(), snapshot({ after }));
    expect(send).toMatchObject({ action: 'react', messageId: 'id-r1' });
  });

  it('posts a correction above 0.85, from something it looked up', async () => {
    const after = [msg('r1', 'it is 100 a minute', 'bob')];
    const xor = () =>
      fakeXor({ ...GOOD, already_answered: 0.9, same_answer_r1: 0.1, contradicts_r1: 0.9 });
    expect(
      await new ProactivityPolicy(config, xor()).beforePosting(draft(), snapshot({ after }))
    ).toMatchObject({ action: 'post', correction: true });
  });

  it('re-drafts once when the asker added to the question', async () => {
    const asked = [msg('m1', 'rate limit?'), msg('m2', 'for staging I mean')];
    const policy = new ProactivityPolicy(config, fakeXor(GOOD));
    expect((await policy.beforePosting(draft(), snapshot({ asked }))).action).toBe('redraft');
    expect((await policy.beforePosting(draft({ redrafts: 1 }), snapshot({ asked }))).action).toBe(
      'post'
    );
  });

  it('waits once for someone typing', async () => {
    const policy = new ProactivityPolicy(config, fakeXor(GOOD), () => NOW);
    expect(await policy.beforePosting(draft(), snapshot({ othersTyping: true }))).toMatchObject({
      action: 'wait',
      until: NOW + 20_000,
    });
    expect(
      (
        await policy.beforePosting(
          draft({ waitedForTyping: true }),
          snapshot({ othersTyping: true })
        )
      ).action
    ).toBe('post');
  });

  it('does not ask whether someone answered it when nobody has said anything since', async () => {
    const xor = fakeXor({ ...GOOD, already_answered: 0.9, no_longer_open: 0.9 });
    expect(
      (await new ProactivityPolicy(config, xor).beforePosting(draft(), snapshot())).action
    ).toBe('post');
    expect(Object.keys(xor.calls[0])).not.toContain('already_answered');
  });

  it('keeps the probability of the check that held it', async () => {
    const send = await new ProactivityPolicy(
      config,
      fakeXor({ ...GOOD, draft_answers: 0.3 })
    ).beforePosting(draft(), snapshot());
    expect(send).toMatchObject({ action: 'hold', reason: 'not_draft_answers', score: 0.3 });
  });

  it('never posts a non-answer as a correction', async () => {
    const after = [msg('r1', 'It is 1,000 a minute.', 'dana')];
    const send = await new ProactivityPolicy(
      config,
      fakeXor({ already_answered: 0.97, contradicts_r1: 0.94, draft_answers: 0.19 })
    ).beforePosting(draft({ text: 'I could not verify the limit.' }), snapshot({ after }));
    expect(send).toMatchObject({ action: 'hold', reason: 'already_answered' });
  });

  it.each([
    ['no_longer_open', { ...GOOD, no_longer_open: 0.7 }],
    ['not_draft_answers', { ...GOOD, draft_answers: 0.2 }],
  ])('holds: %s', async (reason, probabilities) => {
    const after = [msg('r1', 'let me check', 'dana')];
    expect(
      await new ProactivityPolicy(config, fakeXor(probabilities)).beforePosting(
        draft(),
        snapshot({ after })
      )
    ).toMatchObject({ action: 'hold', reason });
  });
});

describe('ProactivityPolicy.followUp', () => {
  const exchange = {
    episodeId: 'e',
    agentSlug: 'triage',
    agentUserId: 'b',
    replyMessageId: 'r',
    followUps: 0,
  };
  const reply = msg('t2', 'and for staging?');

  it('answers a follow-up asking for more information', async () => {
    const decision = await new ProactivityPolicy(
      config,
      fakeXor({ asks_agent_more: 0.9, asks_for_info: 0.9 })
    ).followUp(reply, [], exchange);
    expect(decision.answer).toBe(true);
  });

  it('leaves an action request to a mention, and stops after three', async () => {
    const policy = new ProactivityPolicy(
      config,
      fakeXor({ asks_agent_more: 0.9, asks_for_info: 0.2 })
    );
    expect(await policy.followUp(reply, [], exchange)).toMatchObject({
      answer: false,
      reason: 'not_asks_for_info',
    });
    expect(await policy.followUp(reply, [], { ...exchange, followUps: 3 })).toMatchObject({
      answer: false,
      reason: 'follow_up_limit',
    });
  });
});

describe('mergeConfig', () => {
  it('keeps defaults for missing, unknown and mistyped keys', () => {
    const merged = mergeConfig(DEFAULT_PROACTIVITY_CONFIG, {
      enabled: true,
      gate: { needs_an_answer: 0.7, personal_matter: 'high' },
      nope: 1,
    });
    expect(merged.enabled).toBe(true);
    expect(merged.gate.needs_an_answer).toBe(0.7);
    expect(merged.gate.personal_matter).toBe(0.5);
    expect(merged.episode).toEqual(DEFAULT_PROACTIVITY_CONFIG.episode);
    expect('nope' in merged).toBe(false);
  });
});

describe('ProactivityPolicy modes', () => {
  const policy = new ProactivityPolicy(config, fakeXor());

  it('runs and shows by mode, and the kill switch stops everything', () => {
    expect([policy.runs('OFF'), policy.runs('ANSWER'), policy.runs('SHADOW')]).toEqual([
      false,
      true,
      true,
    ]);
    expect([policy.shows('SHADOW'), policy.shows('ANSWER')]).toEqual([false, true]);
    expect(new ProactivityPolicy({ ...config, enabled: false }, fakeXor()).runs('ANSWER')).toBe(
      false
    );
  });
});
