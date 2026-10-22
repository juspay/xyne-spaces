/**
 * What Agent activity calls things. The backend's keys (`asks_feature`, `not_draft_answers`)
 * are for code; admins read these instead, and see the key only on hover.
 */

/** Why an agent did or didn't reply, finishing "Didn't reply: …" or "Didn't post: …". */
const REASONS = new Map<string, string>([
  // The gate: was the message for an agent at all.
  ['asks_nothing', 'not a question or a problem'],
  ['not_wants_answer', 'not looking for an answer'],
  ['sensitive', 'about someone’s personal matters'],
  ['already_answered', 'someone already answered'],
  ['someone_on_it', 'someone said they’re on it'],
  ['only_addressed_can_answer', 'only the person it’s addressed to can answer'],
  ['not_info_not_a_task', 'asks someone to do a task, not for information'],
  ['not_anyone_could_answer', 'only the person it’s about can answer'],
  ['personal_matter', 'about someone’s personal matters'],
  ['someone_took_it', 'someone said they’re on it'],
  ['just_a_nudge', 'a nudge like “anyone?”'],
  ['not_asked_to_room', 'asked to one person, not the room'],
  ['asks_opinion_or_decision', 'needs a person’s opinion or approval'],
  ['announcement_or_instruction', 'an announcement, not a question'],
  ['asks_feature', 'a feature request'],
  ['just_a_bump', 'a nudge like “anyone?”'],
  ['bump_nothing_earlier', 'a nudge, with no open question before it'],
  ['agent_on_it', 'an agent is already in the thread'],
  ['messages_gone', 'the message was deleted'],
  ['xor_unavailable', 'XOR didn’t respond'],
  // Routing.
  ['no_agent_fits', 'no agent knows this topic'],
  ['no_agents', 'no agents in this channel'],
  ['agent_busy', 'the agent was busy'],
  ['agent_gone', 'the agent was removed'],
  // The draft.
  ['empty_draft', 'the agent found nothing to say'],
  ['draft_timeout', 'the agent took too long'],
  ['timeout', 'the agent took too long'],
  ['draft_failed', 'the agent’s run failed'],
  ['failed', 'the agent’s run failed'],
  ['redraft_failed', 'the rewrite failed'],
  ['too_long', 'the reply was too long'],
  ['nothing_looked_up', 'the agent didn’t look anything up'],
  ['turned_off', 'replies were turned off meanwhile'],
  // The check before posting.
  ['not_draft_answers', 'the reply doesn’t answer the question'],
  ['not_helps_asker', 'the reply wouldn’t help'],
  ['not_sources_fit', 'its sources don’t fit the question'],
  ['not_lookup_can_answer', 'looking things up can’t answer this'],
  ['not_asks_for_info', 'it asks for a task, not information'],
  ['no_longer_open', 'no longer needed'],
  ['same_answer', 'it says the same as a reply already there'],
  ['contradicts', 'it contradicts a reply already there'],
  ['adds_to_answer', 'it adds to a reply already there'],
  // Follow-ups.
  ['not_asks_agent_more', 'the reply isn’t for the agent'],
  ['follow_up_limit', 'the agent already answered 3 follow-ups here'],
]);

export const reasonLabel = (reason: string | null): string =>
  reason ? (REASONS.get(reason) ?? reason.replace(/_/g, ' ')) : '';

/** Each XOR question as a short statement; a probability near 1 means "yes, this is so". */
const QUESTIONS = new Map<string, Map<string, string>>([
  [
    'gate',
    new Map<string, string>([
      ['needs_an_answer', 'Waiting for an answer or a look into a problem'],
      ['info_not_a_task', 'Wants information, not a task'],
      ['anyone_could_answer', 'Anyone who knows could answer'],
      ['personal_matter', 'About someone’s personal matters'],
      ['someone_took_it', 'Someone took it on'],
      ['just_a_nudge', 'A nudge like “anyone?”'],
      ['asks_something', 'Asks for something'],
      ['reports_problem', 'Reports a problem'],
      ['wants_answer', 'Wants an answer'],
      ['sensitive', 'About someone’s personal matters'],
      ['already_answered', 'Already answered'],
      ['someone_on_it', 'Someone is on it'],
      ['only_addressed_can_answer', 'Only the person addressed can answer'],
      ['asks_opinion_or_decision', 'Needs a person’s opinion or approval'],
      ['announcement_or_instruction', 'An announcement or instruction'],
      ['asks_feature', 'A feature request'],
      ['just_a_bump', 'A nudge like “anyone?”'],
      ['asked_to_room', 'Asked to the room'],
    ]),
  ],
  [
    'check',
    new Map<string, string>([
      ['already_answered', 'Someone answered meanwhile'],
      ['no_longer_open', 'No longer needed'],
      ['helps_asker', 'Would help the person who asked'],
      ['asks_for_info', 'Asks for information, not a task'],
      ['draft_answers', 'Actually answers the question'],
      ['sources_fit', 'Sources fit the question'],
      ['lookup_can_answer', 'Looking things up can answer it'],
      ['adds_to_answer', 'Adds something new'],
      ['same_answer', 'Says the same as a reply'],
      ['contradicts', 'Contradicts a reply'],
    ]),
  ],
  [
    'follow',
    new Map<string, string>([
      ['asks_agent_more', 'Asks the agent for more'],
      ['asks_for_info', 'Asks for information, not an action'],
      ['sensitive', 'About someone’s personal matters'],
    ]),
  ],
]);

export const questionLabel = (step: string, key: string): string =>
  QUESTIONS.get(step === 'bump' ? 'gate' : step)?.get(key) ?? key.replace(/_/g, ' ');

/** The steps of a decision, in the order they run. */
export const STEP_TITLES: Record<string, string> = {
  gate: 'Worth replying?',
  bump: 'Original question',
  route: 'Who knows this?',
  check: 'Check before posting',
  follow: 'Follow-up check',
};

/** What happened, in a word or two: the left half of "Didn't reply · a feature request". */
export const OUTCOMES = {
  posted: 'Replied',
  reacted: 'Agreed with a reply',
  held: 'Didn’t post',
  shadow: 'Would have replied',
  quiet: 'Didn’t reply',
  drafting: 'Drafting now',
} as const;

/** What a step needs to go on, in a line, shown when it is opened. */
export const STEP_RULES: Record<string, string> = {
  gate: 'Goes on when it asks for something or reports a problem, asks for information rather than a task, and anyone who knows could answer it; and nobody answered, took it on, or made it personal. A burst goes on if any one message does.',
  bump: 'The earlier question, judged again the same way.',
  route:
    'The agent that fits best of those here answers, if it fits well enough on its own. Up to two more join only on a near tie, when they fit almost surely.',
  check:
    'Posts when it actually answers the question and nobody answered meanwhile. If someone did: says the same, a 👍 instead; adds something new, rewritten to only that; contradicts it, posted as a sourced correction. Both of those need a real answer.',
  follow:
    'Answered when it asks the agent for more and asks for information, and isn’t about personal matters.',
};

/** Questions a message or draft should get a yes to; every other question should be a no. */
const NEEDS_YES = new Map<string, Set<string>>([
  [
    'gate',
    new Set([
      'needs_an_answer',
      'info_not_a_task',
      'anyone_could_answer',
      'asks_something',
      'reports_problem',
      'wants_answer',
      'asked_to_room',
    ]),
  ],
  ['check', new Set(['draft_answers'])],
  ['follow', new Set(['asks_agent_more', 'asks_for_info'])],
]);

/** "needs yes" or "needs no" for a question, or nothing where it doesn't apply (routing). */
export const needs = (step: string, key: string): 'yes' | 'no' | null => {
  const yes = NEEDS_YES.get(step === 'bump' ? 'gate' : step);
  return yes ? (yes.has(key) ? 'yes' : 'no') : null;
};
