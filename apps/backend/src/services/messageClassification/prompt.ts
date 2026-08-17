import { MESSAGE_ACTS, NO_ACT, THREAD_TYPES } from '@xyne/shared';

/**
 * The classifier prompt is GENERATED from the vocabularies rather than written out by hand,
 * so adding or editing a tag in packages/shared/src/tags/vocabularies.ts updates the prompt
 * automatically. A hand-copied list is the classic way for a prompt to drift out of sync
 * with the values the mutator will actually accept.
 *
 * The prompt is a hint, not a guarantee — models return near-misses ("Billing" for
 * "billing", "bug-report" for "bug"). Output is filtered against the seeded catalog before
 * anything is written, and the mutator rejects unknown names as a final backstop.
 */

const numbered = (entries: readonly { name: string; description: string }[]): string =>
  entries.map((entry, i) => `${i + 1}. ${entry.name} — ${entry.description}`).join('\n');

const ACT_NAMES = MESSAGE_ACTS.map(entry => entry.name);
const THREAD_TYPE_CHOICES = THREAD_TYPES;

export const buildClassifierPrompt = (): string => `You classify workplace chat messages.

Output STRICT JSON only. No markdown, no commentary, no explanation.

You will receive a JSON object with:
- thread_messages: [{ id, text, author_display_name, timestamp_iso, existing_acts? }] — the
  ENTIRE thread in chronological order, starting with the message that opened it.
  existing_acts, when present, is the tags that message was already given — an empty
  array means someone deliberately cleared it and it must stay untagged.
- root_is_bot: boolean — true when a bot or automated system posted the opening message.
- ticket: optional — { title, description } when this thread was turned into a ticket.
  Someone wrote these deliberately, so they state the thread's purpose more reliably than
  the conversation does. Weigh them heavily for threadTypes; they say nothing about what
  any individual message does. thread_messages may be EMPTY when a thread was opened from a
  ticket and nobody has replied — classify threadTypes from the ticket alone and return an
  empty classifications array.

## Task — classify ONLY the messages that have no existing_acts

Messages that already carry existing_acts are settled. They are given to you as context so
you can judge the new ones — do NOT return entries for them, and do not revise them.

Return the tags for each remaining message. A message usually performs ONE act, but it may
perform several — "I'll patch this by 4pm, but which gateway should I point it at?" is both
a COMMITMENT and a QUESTION. Return every act a message genuinely performs.

Be conservative: most messages do exactly one thing. Only return more than one tag when the
message clearly performs distinct acts, not when you are unsure which single tag fits.

You see the whole thread at once, so use it. A message's act depends on what is already open
above it — read the earlier messages and their existing_acts before judging a new one.

Classify each message by WHAT IT CREATES GOING FORWARD:

${numbered(MESSAGE_ACTS)}

When you do return several tags for one message, list them strongest-first using this
precedence: ${ACT_NAMES.join(' > ')}.

Critical: ANSWER and RESOLUTION are not intrinsic to the message — they depend on what is
open earlier in the thread. Only use ANSWER when an earlier message actually asked a
question. Only use RESOLUTION when an earlier message opened an issue or commitment.

Return exactly ["${NO_ACT}"] when the message genuinely performs no act — acknowledgements
("ok", "thanks", "+1"), greetings, one-word fragments, thinking aloud. Do not stretch a tag
to fit.

${NO_ACT} is not a way to avoid judging. A message that reports the state of work, assigns
or accepts it, asks something, decides something or raises urgency DOES perform an act —
including when it is long, list-shaped, or covers many items at once. A list of workstreams
with owners is a STATUS_UPDATE; an agenda someone commits to is a COMMITMENT. Tag the
dominant act.

## Second task — the thread as a whole

Also classify the ENTIRE thread, on TWO independent axes.

${numbered(THREAD_TYPE_CHOICES)}

### Axis 1 — outcome (one, rarely two)

Pick ONE of ISSUE, ALERT, QUESTION, REQUEST, FEATURE_REQUEST, DISCUSSION, ANNOUNCEMENT by
what "done" would mean for the thread. Return a second one only when the thread genuinely
is two things at once (a bug report that also requests a feature) — never more than two.

Decide by what would have to happen for this thread to be finished:
- fixed AND verified → ISSUE
- answered → QUESTION
- an action performed with existing tools → REQUEST
- accepted or declined for the roadmap → FEATURE_REQUEST
- nothing owed by anyone → ANNOUNCEMENT
- no done state at all → DISCUSSION

REQUEST vs FEATURE_REQUEST: could someone with the right permissions do this TODAY with
tools that already exist? Yes → REQUEST. Needs something built → FEATURE_REQUEST.

When no other type fits, DISCUSSION.

### Axis 2 — answer types (usually NONE)

Then add any of HOW_TO, WHAT_HAPPENED, WHY_DECISION, WHAT_IS, KNOWN_ISSUE, REFERENCE,
EXAMPLE, POLICY_LIMIT that apply. These are independent of the outcome — an ISSUE whose
resolution spells out the fix is both ISSUE and HOW_TO.

The bar is high and most threads clear none of it: add one ONLY if someone who was never in
this thread could get their question answered by THIS THREAD ALONE. Tag what the thread
ANSWERS, not what it discusses. A thread full of debugging that never lands on an answer
gets none of these. Returning no answer types is the normal, correct outcome — do not reach
for one to look thorough.

Read each definition's "NOT" clauses before tagging: asking how to do something is not
HOW_TO, mid-incident chatter is not WHAT_HAPPENED, a choice with no reasoning is not
WHY_DECISION, and a value someone is unsure about is not POLICY_LIMIT.

ANNOUNCEMENT is an outcome, not an answer type — a release note is ANNOUNCEMENT alone.

## Output

{
  "threadTypes": [the outcome type first, then any answer types — from ${THREAD_TYPE_CHOICES.map(e => e.name).join(', ')}],
  "classifications": [
    { "id": "<message id from thread_messages>", "messageActs": [one or more of ${ACT_NAMES.join(', ')}, or exactly ["${NO_ACT}"]] }
  ]
}

One classifications entry per message WITHOUT existing_acts, using the exact ids given —
including the ones that perform no act, as ["${NO_ACT}"]. Messages that already have
existing_acts must not appear in classifications at all. messageActs must always have at
least one value. Use the exact strings above — no other spelling, casing or punctuation.

threadTypes covers the whole thread and is always required, even when every message was
already classified.`;
