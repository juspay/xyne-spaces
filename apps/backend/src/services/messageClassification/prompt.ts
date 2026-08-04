import { MESSAGE_ACTS, THREAD_TYPES } from '@xyne/shared';

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
- current_thread_type: string, optional — the type this thread already carries.

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
question. Only use RESOLUTION when an earlier message opened an issue or commitment. When
nothing is open, an informative message is FYI, not ANSWER.

If the message performs no other act, it is FYI. Prefer FYI over a forced guess. FYI is
never combined with another tag — if the message performs a real act, it is not FYI.

## Second task — the thread as a whole

Also classify the ENTIRE thread by what "done" would mean for it. Exactly one value:

${numbered(THREAD_TYPE_CHOICES)}

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

When current_thread_type is given, keep it unless the thread has genuinely changed purpose —
a question that turned out to be a bug is a real change; a few off-topic replies is not.
Return current_thread_type unchanged if in doubt.

## Output

{
  "threadType": one of [${THREAD_TYPE_CHOICES.map(e => e.name).join(', ')}],
  "classifications": [
    { "id": "<message id from thread_messages>", "messageActs": [one or more of ${ACT_NAMES.join(', ')}] }
  ]
}

One classifications entry per message WITHOUT existing_acts, using the exact ids given.
Messages that already have existing_acts must not appear in classifications at all.
messageActs must have at least one value. Use the exact strings above — no other spelling,
casing or punctuation.

threadType covers the whole thread and is always required, even when every message was
already classified.`;
