import type { DecisionAnswer, DecisionQuestion } from '@/services/decision/types';
import type { ProactivityConfig, QuestionText } from './config';
import type {
  AgentCard,
  Deadline,
  Draft,
  Episode,
  Exchange,
  FollowUp,
  Gate,
  NewMessage,
  Probabilities,
  ProactivityMode,
  Room,
  Route,
  Send,
  Snapshot,
  SnapshotMessage,
  Watch,
} from './types';

/** The XOR call the policy makes; `askDecision` in production, a fake in tests and replay. */
export type XorClient = (
  state: string | Record<string, unknown>,
  questions: Record<string, DecisionQuestion>,
  timeoutMs: number
) => Promise<Record<string, DecisionAnswer> | null>;

export type Clock = () => number;

/** One message's text as XOR reads it; longer ones are mostly logs and bot reports. */
const MAX_TEXT = 1500;
/** A routing card is up to 2000 characters, plus the agent's name. */
const CARD_MAX = 2100;

/**
 * Every "should we" of agent proactivity, in one place. The message hook, the episode
 * worker, the draft callback and delivery only carry out what this returns.
 *
 * Apart from asking XOR it touches nothing: no database, no Redis, no network. The
 * config, the XOR client and the clock come in through the constructor, so replay runs
 * exactly this code against recorded channels.
 */
export class ProactivityPolicy {
  constructor(
    private readonly config: ProactivityConfig,
    private readonly xor: XorClient,
    private readonly clock: Clock = Date.now
  ) {}

  get configVersion(): string {
    return this.config.version;
  }

  /**
   * Whether anything runs now: the kill switch and the channel's mode. Asked again at
   * every later step, not only when a message arrives, so turning it off stops what is
   * already in flight.
   */
  runs(mode: ProactivityMode): boolean {
    return this.config.enabled && mode !== 'OFF';
  }

  /** Whether what it decided is shown to people, or only recorded. */
  shows(mode: ProactivityMode): boolean {
    return mode !== 'SHADOW';
  }

  /**
   * Whether anything runs for this message at all. Runs on every message, so it only
   * reads what it is given.
   */
  watch(message: NewMessage, room: Room): Watch {
    if (!this.config.enabled) return { kind: 'ignore', reason: 'disabled' };
    if (!message.fromPerson) return { kind: 'ignore', reason: 'not_a_person' };
    if (room.isDirect) return { kind: 'ignore', reason: 'direct_message' };
    if (room.customerFacing) return { kind: 'ignore', reason: 'customer_facing' };
    if (room.mode === 'OFF') return { kind: 'ignore', reason: 'channel_off' };
    if (message.tagsAgent) return { kind: 'ignore', reason: 'tags_agent' };
    if (!message.text.trim()) return { kind: 'ignore', reason: 'empty' };
    if (message.isReply && room.exchange) return { kind: 'followUp', reason: 'reply_to_agent' };
    // A reply in a conversation between people is first theirs: it waits until the
    // thread goes quiet, and the gate asks whether it was meant for the room at all.
    if (message.isReply && !room.ownQuietThread) {
      return { kind: 'episode', reason: 'watching_reply' };
    }
    return { kind: 'episode', reason: 'watching' };
  }

  /**
   * When an episode's wait is over. Each new message from the asker restarts the quiet
   * period, up to maxResets times and never past maxWait from the first. Once it is
   * over, someone else typing gets one extra grace period.
   */
  timer(episode: Episode, othersTyping = false): Deadline {
    const e = this.config.episode;
    const [quietSeconds, maxWaitSeconds] = episode.inConversation
      ? [e.replyQuietSeconds, e.replyMaxWaitSeconds]
      : episode.mentionsPeople
        ? [e.mentionQuietSeconds, e.mentionMaxWaitSeconds]
        : [e.quietSeconds, e.maxWaitSeconds];
    const { maxResets, typingGraceSeconds } = e;
    const cap = episode.firstAt + maxWaitSeconds * 1000;
    const quiet =
      episode.resets > maxResets
        ? episode.deadline
        : Math.min(episode.lastAt + quietSeconds * 1000, cap);
    const now = this.clock();
    if (quiet <= now && othersTyping && !episode.graceUsed) {
      return { at: now + typingGraceSeconds * 1000, grace: true };
    }
    return { at: quiet, grace: false };
  }

  /**
   * Does a new top-level message belong with the asker's burst already waiting? A
   * different question starts its own, so it's routed, answered and checked on its own.
   * Joins when XOR can't say, as before this check.
   */
  async sameTopic(earlier: string[], next: string): Promise<boolean> {
    if (earlier.length === 0) return true;
    const state = [
      'Earlier messages:',
      ...earlier.map((text) => clean(text)),
      '',
      'New message:',
      clean(next),
    ].join('\n');
    const probabilities = await this.ask(state, {
      same_topic: noul(this.config.questions.same_topic, {}),
    });
    return !probabilities || probabilities.same_topic >= this.config.episode.sameTopic;
  }

  /**
   * XOR's first pass: is any of the asker's messages still open for an agent? A question,
   * or a report that something is broken, which the agent can look into.
   */
  async gate(snapshot: Snapshot): Promise<Gate> {
    const asked = snapshot.asked.slice(-this.config.context.askedMessages);
    if (asked.length === 0)
      return { outcome: 'quiet', reason: 'asks_nothing', passed: [], probabilities: {} };
    // Someone tagged an agent in the thread, or one is already working or has replied:
    // its question now, and it needs no XOR to see that.
    if (snapshot.agentEngaged)
      return { outcome: 'quiet', reason: 'agent_on_it', passed: [], probabilities: {} };

    const gateQuestions = this.config.questions.gate;
    // Nobody has said anything since: it can't have been answered or taken.
    const nothingSince = snapshot.after.length === 0;
    const names = (Object.keys(gateQuestions) as Array<keyof typeof gateQuestions>).filter(
      (name) => !nothingSince || (name !== 'already_answered' && name !== 'someone_took_it')
    );
    const questions: Record<string, DecisionQuestion> = {};
    for (const message of asked) {
      for (const name of names) {
        questions[`${message.label}_${name}`] = noul(gateQuestions[name], {
          m: quoteMessage(message),
        });
      }
    }

    const probabilities = await this.ask(render(snapshot), questions);
    if (!probabilities)
      return { outcome: 'quiet', reason: 'xor_unavailable', passed: [], probabilities: {} };

    const t = this.config.gate;
    const yes = (label: string, name: keyof typeof t) =>
      (probabilities[`${label}_${name}`] ?? 0) >= t[name];
    // Null when the message is open; otherwise the first question that keeps it quiet.
    const quietBecause = (label: string): string | null => {
      const is = (name: keyof typeof t) => yes(label, name);
      if (!is('needs_an_answer')) return 'asks_nothing';
      if (is('personal_matter')) return 'personal_matter';
      if (is('already_answered')) return 'already_answered';
      if (is('someone_took_it')) return 'someone_took_it';
      if (!is('info_not_a_task')) return 'not_info_not_a_task';
      if (!is('anyone_could_answer')) return 'not_anyone_could_answer';
      return null;
    };

    // "anyone?" looks like a question on its own; it bumps an earlier one.
    // "anyone?" or "bump", but not "@Dana ^": a ping to someone is theirs to answer.
    const bump = (label: string) => yes(label, 'just_a_nudge') && yes(label, 'anyone_could_answer');
    const passed = asked
      .filter((m) => !bump(m.label) && quietBecause(m.label) === null)
      .map((m) => m.label);
    if (passed.length > 0) return { outcome: 'open', reason: 'open', passed, probabilities };

    const bumps = asked.filter((m) => bump(m.label));
    if (bumps.length > 0) {
      return {
        outcome: 'bump',
        reason: 'just_a_nudge',
        score: Math.max(...bumps.map((m) => probabilities[`${m.label}_just_a_nudge`] ?? 0)),
        passed: [],
        probabilities,
      };
    }
    // The reason of the message that looked most like a question or a report.
    const score = (label: string) => probabilities[`${label}_needs_an_answer`] ?? 0;
    const likeliest = [...asked].sort((a, b) => score(b.label) - score(a.label))[0];
    const reason = quietBecause(likeliest.label) ?? 'asks_nothing';
    return {
      outcome: 'quiet',
      reason,
      score:
        reason === 'asks_nothing'
          ? score(likeliest.label)
          : scoreOf(reason, probabilities, `${likeliest.label}_`),
      passed: [],
      probabilities,
    };
  }

  /**
   * Which agents answer. In one call: a choice between the agents says which fits best, and
   * a yes/no per agent says how well each fits on its own. The best pick answers when it is
   * relevant enough; a close second or third joins only when it fits almost surely.
   */
  async route(snapshot: Snapshot, agents: AgentCard[]): Promise<Route> {
    if (agents.length === 0) return { kind: 'none', reason: 'no_agents', probabilities: {} };

    const questions: Record<string, DecisionQuestion> = {};
    agents.forEach((agent, i) => {
      questions[`agent_${i}`] = noul(this.config.questions.route, {
        agent: cardOf(agent),
        asker: snapshot.askerName,
      });
    });
    if (agents.length > 1) {
      questions.best = {
        type: 'choice',
        instructions: fill(this.config.questions.best_agent.instructions, {
          asker: snapshot.askerName,
        }),
        criteria: Object.fromEntries(agents.map((agent, i) => [`agent_${i}`, cardOf(agent)])),
      };
    }
    // Only what was asked: the gate has already judged everything said after it.
    const answers = await this.ask(renderAsked(snapshot), questions);
    if (!answers) return { kind: 'none', reason: 'xor_unavailable', probabilities: {} };

    const probabilities: Probabilities = {};
    agents.forEach((agent, i) => {
      probabilities[agent.slug] = answers[`agent_${i}`] ?? 0;
      if (agents.length > 1) probabilities[`best_${agent.slug}`] = answers[`best_agent_${i}`] ?? 0;
    });
    const share = (agent: AgentCard): number =>
      agents.length > 1 ? probabilities[`best_${agent.slug}`] : 1;
    const { relevant, secondAgent, maxAgents, closeChoice } = this.config.route;
    // The best pick of the choice, if it is relevant enough on its own.
    const [best, ...rest] = [...agents].sort(
      (a, b) => share(b) - share(a) || probabilities[b.slug] - probabilities[a.slug]
    );
    if (probabilities[best.slug] < relevant) {
      return {
        kind: 'none',
        reason: 'no_agent_fits',
        score: probabilities[best.slug],
        probabilities,
      };
    }
    const picked = [
      best,
      ...rest.filter(
        (a) => probabilities[a.slug] >= secondAgent && share(a) >= closeChoice * share(best)
      ),
    ].slice(0, Math.max(1, maxAgents));
    return { kind: 'agents', agents: picked, score: probabilities[best.slug], probabilities };
  }

  /**
   * The check before posting, against the conversation as it is now. A draft that
   * says what a person already said becomes a 👍 on their message; one that
   * contradicts them only posts as a correction with a source and high confidence.
   */
  async beforePosting(draft: Draft, latest: Snapshot): Promise<Send> {
    if (!visible(draft.text)) return { action: 'hold', reason: 'empty_draft', probabilities: {} };
    // Too long to read as a chat reply: asked once for a shorter one, then held.
    if (draft.text.length > this.config.limits.maxDraftChars) {
      return draft.redrafts < 1
        ? { action: 'redraft', reason: 'too_long', probabilities: {} }
        : { action: 'hold', reason: 'too_long', probabilities: {} };
    }
    if (latest.agentEngaged) return { action: 'hold', reason: 'agent_on_it', probabilities: {} };
    // A rewrite builds on the first draft's lookups, so only a first draft must show its own.
    if (draft.toolsUsed.length === 0 && draft.redrafts === 0) {
      return { action: 'hold', reason: 'nothing_looked_up', probabilities: {} };
    }

    const answered = new Set(draft.answers);
    if (latest.asked.some((m) => !answered.has(m.messageId)) && draft.redrafts < 1) {
      return { action: 'redraft', reason: 'asker_added_to_question', probabilities: {} };
    }
    if (latest.othersTyping && !draft.waitedForTyping) {
      const until = this.clock() + this.config.episode.typingGraceSeconds * 1000;
      return { action: 'wait', until, reason: 'someone_typing', probabilities: {} };
    }

    const compared = comparedReplies(latest, this.config.context.comparedReplies);
    const q = this.config.questions;
    const questions: Record<string, DecisionQuestion> = {};
    // With nothing said since the question, nobody can have answered or taken it; asking
    // anyway only lets XOR mistake the draft itself for an answer.
    const nothingSince = latest.after.length === 0;
    for (const [name, text] of Object.entries(q.beforePosting)) {
      if (nothingSince && ['already_answered', 'no_longer_open', 'adds_to_answer'].includes(name))
        continue;
      questions[name] = noul(text, {});
    }
    for (const message of compared) {
      questions[`same_answer_${message.label}`] = noul(q.same_answer, {
        reply: clean(message.text),
        draft: clean(draft.text),
      });
      questions[`contradicts_${message.label}`] = noul(q.contradicts, {
        m: quoteMessage(message),
      });
    }

    const probabilities = await this.ask(
      { conversation: render(latest), draft: clip(draft.text) },
      questions
    );
    if (!probabilities) return { action: 'hold', reason: 'xor_unavailable', probabilities: {} };

    const t = this.config.beforePosting;
    const p = (key: string) => probabilities[key] ?? 0;
    const is = (name: keyof typeof t) => p(name) >= t[name];
    const hold = (reason: string): Send => ({
      action: 'hold',
      reason,
      score: scoreOf(reason, probabilities),
      probabilities,
    });
    // Someone answered already: a person, or another agent that posted first.
    if (is('already_answered')) {
      const contradicts = Math.max(0, ...compared.map((m) => p(`contradicts_${m.label}`)));
      // Agreeing, correcting or adding needs an answer of its own: "I couldn't verify
      // that" also reads as contradicting a reply.
      const answers = is('draft_answers');
      // A correction only from something it looked up.
      if (answers && contradicts >= t.contradicts && draft.toolsUsed.length > 0) {
        return {
          action: 'post',
          correction: true,
          reason: 'contradicts',
          score: contradicts,
          probabilities,
        };
      }
      // Something they left out: redrafted once to only what is new, which then posts.
      if (answers && is('adds_to_answer')) {
        return draft.redrafts < 1
          ? {
              action: 'redraft',
              reason: 'adds_to_answer',
              score: p('adds_to_answer'),
              probabilities,
            }
          : {
              action: 'post',
              correction: false,
              reason: 'adds_to_answer',
              score: p('adds_to_answer'),
              probabilities,
            };
      }
      const same = compared
        .map((m) => ({ message: m, p: p(`same_answer_${m.label}`) }))
        .sort((a, b) => b.p - a.p)[0];
      if (answers && same && same.p >= t.same_answer) {
        return {
          action: 'react',
          messageId: same.message.messageId,
          reason: 'same_answer',
          score: same.p,
          probabilities,
        };
      }
      return hold('already_answered');
    }
    if (is('no_longer_open')) return hold('no_longer_open');
    if (!is('draft_answers')) return hold('not_draft_answers');
    return { action: 'post', correction: false, reason: 'post', probabilities };
  }

  /** A reply in a thread an agent answered: does the agent answer it straight away? */
  async followUp(
    reply: SnapshotMessage,
    thread: SnapshotMessage[],
    exchange: Exchange
  ): Promise<FollowUp> {
    const t = this.config.followUps;
    if (exchange.followUps >= t.max)
      return { answer: false, reason: 'follow_up_limit', probabilities: {} };

    const questions: Record<string, DecisionQuestion> = {};
    for (const [name, text] of Object.entries(this.config.questions.followUp))
      questions[name] = noul(text, {});
    const probabilities = await this.ask(
      { conversation: renderMessages(thread), reply: `${reply.senderName}: ${clip(reply.text)}` },
      questions
    );
    if (!probabilities) return { answer: false, reason: 'xor_unavailable', probabilities: {} };

    const is = (name: Exclude<keyof typeof t, 'max'>) => (probabilities[name] ?? 0) >= t[name];
    const no = (reason: string): FollowUp => ({
      answer: false,
      reason,
      score: scoreOf(reason, probabilities),
      probabilities,
    });
    if (!is('asks_agent_more')) return no('not_asks_agent_more');
    if (!is('asks_for_info')) return no('not_asks_for_info');
    if (is('sensitive')) return no('sensitive');
    return { answer: true, reason: 'asks_agent_more', probabilities };
  }

  /** Yes/no answers by key, or null when XOR can't answer them all. */
  private async ask(
    state: string | Record<string, unknown>,
    questions: Record<string, DecisionQuestion>
  ): Promise<Probabilities | null> {
    const answers = await this.xor(state, questions, this.config.limits.xorTimeoutMs);
    if (!answers) return null;
    const probabilities: Probabilities = {};
    for (const key of Object.keys(questions)) {
      const answer = answers[key];
      if (answer?.type === 'noul') probabilities[key] = answer.noul;
      // A choice as one probability per option: `best_agent_0` for option `agent_0` of `best`.
      else if (answer?.type === 'choice' && questions[key].type === 'choice') {
        for (const option of Object.keys(questions[key].criteria)) {
          probabilities[`${key}_${option}`] = answer.probabilities[option] ?? 0;
        }
      } else return null;
    }
    return probabilities;
  }
}

/**
 * XOR's probability for the question a reason names: `sensitive` is the yes to
 * `sensitive`, `not_draft_answers` the (too low) yes to `draft_answers`.
 */
const scoreOf = (reason: string, probabilities: Probabilities, prefix = ''): number | undefined =>
  probabilities[`${prefix}${reason.replace(/^not_/, '')}`];

/**
 * What a draft is compared with: replies in the asker's own threads first, where the
 * answer to them is, then the newest elsewhere. Newest-only missed the answer for 1
 * question in 10 in busy prod channels.
 */
function comparedReplies(latest: Snapshot, max: number): SnapshotMessage[] {
  const threads = new Set(latest.asked.map((m) => m.conversationId));
  const others = latest.after.filter((m) => m.senderId !== latest.askerId);
  const own = others.filter((m) => threads.has(m.conversationId)).slice(-max);
  const room = max - own.length;
  const rest = room > 0 ? others.filter((m) => !threads.has(m.conversationId)).slice(-room) : [];
  return [...own, ...rest].sort((a, b) => a.at - b.at);
}

const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);

const noul = (text: QuestionText, values: Record<string, string>): DecisionQuestion => ({
  type: 'noul',
  instructions: fill(text.instructions, values),
  ...(text.criteria ? { criteria: text.criteria } : {}),
});

/** Text with something to read: an agent told to return nothing may send a zero-width space. */
const visible = (text: string): boolean =>
  text.replace(/[\s\u200b-\u200d\u2060\ufeff]/g, '').length > 0;

const clip = (text: string, max = MAX_TEXT): string =>
  text.length > max ? `${text.slice(0, max)}…` : text;

/**
 * Other people's text going into a question. Runs of quote marks can't close the fence
 * early, and backticks become quotes, because in XOR's instructions they point into
 * the state.
 */
const clean = (text: string, max = MAX_TEXT): string =>
  clip(text, max).replace(/"{3,}/g, '"').replace(/`/g, "'");

/** An agent's routing card, whole: claw-auth already caps it. */
const cardOf = (agent: AgentCard): string => clean(`${agent.name}: ${agent.description}`, CARD_MAX);

const quoteMessage = (m: SnapshotMessage): string =>
  `Message [${m.label}] from ${clean(m.senderName)}:\n"""\n${clean(m.text)}\n"""`;

const time = (at: number): string => new Date(at).toISOString().slice(11, 19);

const line = (m: SnapshotMessage): string =>
  `[${m.label}] ${time(m.at)} ${m.senderName}${m.fromAgent ? ' (agent)' : ''}: ${clip(m.text)}`;

const renderMessages = (messages: SnapshotMessage[]): string => messages.map(line).join('\n');

/** The question for routing: what was asked, and for a reply the thread it's in. */
const renderAsked = (snapshot: Snapshot): string => render({ ...snapshot, after: [] });

/** The conversation as XOR reads it: what was asked, and what came after. */
export function render(snapshot: Snapshot): string {
  const parts = snapshot.before.length
    ? [
        `Channel #${snapshot.channelName}. Earlier in the thread:`,
        renderMessages(snapshot.before),
        '',
        `Then ${snapshot.askerName} wrote:`,
        renderMessages(snapshot.asked),
      ]
    : [
        `Channel #${snapshot.channelName}. ${snapshot.askerName} wrote:`,
        renderMessages(snapshot.asked),
      ];
  if (snapshot.after.length > 0) parts.push('', 'After that:', renderMessages(snapshot.after));
  return parts.join('\n');
}
