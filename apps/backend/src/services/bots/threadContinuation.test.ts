import {
  resolveThreadContinuation,
  isAcknowledgementText,
  DEFAULT_CONTINUATION_RECENCY_MS,
  type ContinuationConfig,
  type CurrentMessageForContinuation,
  type ThreadMessageForContinuation,
} from './threadContinuation';

// --- fixtures -------------------------------------------------------------

const H1 = 'human-1';
const H2 = 'human-2';
const BOT_A = 'bot-ask-ai';
const APP_B = 'app-architect';
const NON_CHAT_BOT = 'bot-varys';

const T0 = 1_000_000_000_000; // arbitrary epoch ms
const min = (n: number) => n * 60_000;

const eligible = new Set<string>([BOT_A, APP_B]);

function msg(
  over: Partial<ThreadMessageForContinuation> & Pick<ThreadMessageForContinuation, 'senderId' | 'senderType' | 'createdAtMs'>,
): ThreadMessageForContinuation {
  return {
    messageId: `m-${over.createdAtMs}`,
    mentionedAgentUserIds: [],
    ...over,
  };
}

function cfg(over: Partial<ContinuationConfig>): ContinuationConfig {
  return {
    nowMs: T0 + min(35),
    isThreadReply: true,
    chatEnabledAgentUserIds: eligible,
    recencyWindowMs: DEFAULT_CONTINUATION_RECENCY_MS,
    priorMessages: [],
    ...over,
  };
}

const humanReply: CurrentMessageForContinuation = {
  senderId: H1,
  senderType: 'USER',
  hasAnyMention: false,
  isAcknowledgement: false,
};

/** Canonical happy-path thread: H1 tags BOT_A, BOT_A replies, now H1 follows up. */
function happyThread(lastReplyMs = T0 + min(10)): ThreadMessageForContinuation[] {
  return [
    msg({ senderId: H1, senderType: 'USER', createdAtMs: T0, mentionedAgentUserIds: [BOT_A] }),
    msg({ senderId: BOT_A, senderType: 'BOT', createdAtMs: lastReplyMs }),
  ];
}

// --- resolveThreadContinuation -------------------------------------------

describe('resolveThreadContinuation', () => {
  it('invokes the anchored agent on a same-initiator no-mention follow-up (happy path)', () => {
    const d = resolveThreadContinuation(
      humanReply,
      cfg({ nowMs: T0 + min(12), priorMessages: happyThread(T0 + min(10)) }),
    );
    expect(d.invoke).toBe(true);
    expect(d.reason).toBe('ok');
    expect(d.agentUserIds).toEqual([BOT_A]);
  });

  it('skips when the message is not a thread reply', () => {
    const d = resolveThreadContinuation(humanReply, cfg({ isThreadReply: false, priorMessages: happyThread() }));
    expect(d).toEqual({ invoke: false, agentUserIds: [], reason: 'not_thread_reply' });
  });

  it('skips when the sender is an agent (loop safety)', () => {
    const d = resolveThreadContinuation(
      { ...humanReply, senderId: BOT_A, senderType: 'BOT' },
      cfg({ priorMessages: happyThread() }),
    );
    expect(d.reason).toBe('sender_not_human');
  });

  it('skips when the reply explicitly mentions someone', () => {
    const d = resolveThreadContinuation({ ...humanReply, hasAnyMention: true }, cfg({ priorMessages: happyThread() }));
    expect(d.reason).toBe('has_explicit_mention');
  });

  it('skips a bare acknowledgement', () => {
    const d = resolveThreadContinuation({ ...humanReply, isAcknowledgement: true }, cfg({ priorMessages: happyThread() }));
    expect(d.reason).toBe('acknowledgement');
  });

  it('skips when no prior human ever tagged an agent (e.g. bare bot-started thread)', () => {
    const prior = [
      msg({ senderId: BOT_A, senderType: 'BOT', createdAtMs: T0 }), // scheduled report, no human tag yet
    ];
    const d = resolveThreadContinuation(humanReply, cfg({ priorMessages: prior }));
    expect(d.reason).toBe('no_prior_agent_invocation');
  });

  it('skips when a DIFFERENT human is the current sender (only the invoker auto-continues)', () => {
    const d = resolveThreadContinuation(
      { ...humanReply, senderId: H2 },
      cfg({ nowMs: T0 + min(12), priorMessages: happyThread(T0 + min(10)) }),
    );
    expect(d.reason).toBe('sender_not_invoker');
  });

  it('re-anchors to the most recent invoker: H2 tags after H1, so H2 (not H1) continues', () => {
    const prior = [
      msg({ senderId: H1, senderType: 'USER', createdAtMs: T0, mentionedAgentUserIds: [BOT_A] }),
      msg({ senderId: BOT_A, senderType: 'BOT', createdAtMs: T0 + min(1) }),
      msg({ senderId: H2, senderType: 'USER', createdAtMs: T0 + min(2), mentionedAgentUserIds: [BOT_A] }),
      msg({ senderId: BOT_A, senderType: 'BOT', createdAtMs: T0 + min(3) }),
    ];
    const h2Follow = resolveThreadContinuation(
      { ...humanReply, senderId: H2 },
      cfg({ nowMs: T0 + min(5), priorMessages: prior }),
    );
    expect(h2Follow).toMatchObject({ invoke: true, reason: 'ok', agentUserIds: [BOT_A] });

    const h1Follow = resolveThreadContinuation(
      { ...humanReply, senderId: H1 },
      cfg({ nowMs: T0 + min(5), priorMessages: prior }),
    );
    expect(h1Follow.reason).toBe('sender_not_invoker');
  });

  it('skips when the agent has not replied since the anchor (run still pending)', () => {
    const prior = [
      msg({ senderId: H1, senderType: 'USER', createdAtMs: T0, mentionedAgentUserIds: [BOT_A] }),
      // no agent reply yet
    ];
    const d = resolveThreadContinuation(humanReply, cfg({ nowMs: T0 + min(1), priorMessages: prior }));
    expect(d.reason).toBe('agent_response_pending');
  });

  it('skips when another human posted AFTER the agent reply (no-human-between guard)', () => {
    const prior = [
      msg({ senderId: H1, senderType: 'USER', createdAtMs: T0, mentionedAgentUserIds: [BOT_A] }),
      msg({ senderId: BOT_A, senderType: 'BOT', createdAtMs: T0 + min(1) }),
      msg({ senderId: H2, senderType: 'USER', createdAtMs: T0 + min(2) }), // interjection
    ];
    const d = resolveThreadContinuation(humanReply, cfg({ nowMs: T0 + min(3), priorMessages: prior }));
    expect(d.reason).toBe('other_human_interjected');
  });

  it('allows the invoker to post multiple follow-ups (own messages after reply are fine)', () => {
    const prior = [
      msg({ senderId: H1, senderType: 'USER', createdAtMs: T0, mentionedAgentUserIds: [BOT_A] }),
      msg({ senderId: BOT_A, senderType: 'BOT', createdAtMs: T0 + min(1) }),
      msg({ senderId: H1, senderType: 'USER', createdAtMs: T0 + min(2) }), // invoker's own earlier follow-up
      msg({ senderId: BOT_A, senderType: 'BOT', createdAtMs: T0 + min(3) }),
    ];
    const d = resolveThreadContinuation(humanReply, cfg({ nowMs: T0 + min(4), priorMessages: prior }));
    expect(d).toMatchObject({ invoke: true, reason: 'ok' });
  });

  it('skips when the agent reply is older than the recency window', () => {
    const d = resolveThreadContinuation(
      humanReply,
      cfg({ nowMs: T0 + min(120), priorMessages: happyThread(T0 + min(10)) }),
    );
    expect(d.reason).toBe('stale_thread');
  });

  it('routes to BOTH agents when two eligible agents are active and none is explicitly tagged', () => {
    const prior = [
      msg({ senderId: H1, senderType: 'USER', createdAtMs: T0, mentionedAgentUserIds: [BOT_A, APP_B] }),
      msg({ senderId: BOT_A, senderType: 'BOT', createdAtMs: T0 + min(1) }),
      msg({ senderId: APP_B, senderType: 'APP', createdAtMs: T0 + min(2) }),
    ];
    const d = resolveThreadContinuation(humanReply, cfg({ nowMs: T0 + min(3), priorMessages: prior }));
    expect(d.invoke).toBe(true);
    expect(new Set(d.agentUserIds)).toEqual(new Set([BOT_A, APP_B]));
  });

  it('drops non-chat-eligible agents from the target set', () => {
    const prior = [
      msg({ senderId: H1, senderType: 'USER', createdAtMs: T0, mentionedAgentUserIds: [BOT_A, NON_CHAT_BOT] }),
      msg({ senderId: BOT_A, senderType: 'BOT', createdAtMs: T0 + min(1) }),
      msg({ senderId: NON_CHAT_BOT, senderType: 'BOT', createdAtMs: T0 + min(2) }),
    ];
    const d = resolveThreadContinuation(humanReply, cfg({ nowMs: T0 + min(3), priorMessages: prior }));
    expect(d).toMatchObject({ invoke: true, reason: 'ok' });
    expect(d.agentUserIds).toEqual([BOT_A]); // NON_CHAT_BOT excluded
  });

  it('skips when the only anchored agent is not chat-eligible', () => {
    const prior = [
      msg({ senderId: H1, senderType: 'USER', createdAtMs: T0, mentionedAgentUserIds: [NON_CHAT_BOT] }),
      msg({ senderId: NON_CHAT_BOT, senderType: 'BOT', createdAtMs: T0 + min(1) }),
    ];
    const d = resolveThreadContinuation(humanReply, cfg({ nowMs: T0 + min(2), priorMessages: prior }));
    expect(d.reason).toBe('no_eligible_agent');
  });

  it('continues an APP agent (claw) the same way as a BOT', () => {
    const prior = [
      msg({ senderId: H1, senderType: 'USER', createdAtMs: T0, mentionedAgentUserIds: [APP_B] }),
      msg({ senderId: APP_B, senderType: 'APP', createdAtMs: T0 + min(1) }),
    ];
    const d = resolveThreadContinuation(humanReply, cfg({ nowMs: T0 + min(2), priorMessages: prior }));
    expect(d).toMatchObject({ invoke: true, reason: 'ok', agentUserIds: [APP_B] });
  });
});

// --- isAcknowledgementText ------------------------------------------------

describe('isAcknowledgementText', () => {
  it.each([
    'thanks', 'Thanks!', 'thank you', 'ok', 'okay', 'k', 'got it', 'great, thanks',
    'noted thanks', 'perfect', 'cool', 'lgtm', '👍', '🙏🙏', '  ', '...', 'yes',
  ])('treats %p as an acknowledgement', (t) => {
    expect(isAcknowledgementText(t)).toBe(true);
  });

  it.each([
    'can you also add tests?',
    'what about the APP path',
    'now do the same for staging',
    'thanks — but why did it skip the second agent',
    'ok so what happens on retry',
    'summarize the thread',
  ])('treats %p as a real request', (t) => {
    expect(isAcknowledgementText(t)).toBe(false);
  });
});
