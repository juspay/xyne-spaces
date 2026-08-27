import type { ThreadTypeEntry } from '@xyne/shared';

/**
 * The classifier prompt is GENERATED from the workspace's vocabulary rather than written out
 * by hand. Nothing here names a thread type — a hand-copied list is the classic way for a
 * prompt to drift out of sync with the values that will actually be accepted.
 *
 * Thread types are the only vocabulary; the message-act list that used to sit alongside them
 * is gone. Instead the model must cite, for each type it returns, the messages that evidence
 * it. That citation is what lets a chip on a thread be traced back to the message it came
 * from, and it is what gets stored on those messages.
 *
 * The prompt is a hint, not a guarantee — models return near-misses ("Billing" for
 * "billing", "bug-report" for "bug"). Output is coerced onto the same vocabulary this prompt
 * was built from, and anything unrecognised is dropped rather than stored.
 */

const numbered = (entries: readonly ThreadTypeEntry[]): string =>
  entries.map((entry, i) => `${i + 1}. ${entry.name} — ${entry.description}`).join('\n');

const names = (entries: readonly ThreadTypeEntry[]): string =>
  entries.map(entry => entry.name).join(', ');

/**
 * @param threadTypes the workspace's vocabulary, in display order. Both the list and the
 *        output enum are generated from it, so a workspace that adds a type gets it offered
 *        to the model without any change here.
 */
export const buildClassifierPrompt = (threadTypes: readonly ThreadTypeEntry[]): string => {
  return `You classify workplace chat threads.

Output STRICT JSON only. No markdown, no commentary, no explanation.

You will receive a JSON object with:
- thread_messages: [{ id, text, author_display_name, timestamp_iso }] — the ENTIRE thread
  in chronological order, starting with the message that opened it.
- root_is_bot: boolean — true when a bot or automated system posted the opening message.
- ticket: optional — { title, description } when this thread was turned into a ticket.
  Someone wrote these deliberately, so they state the thread's purpose more reliably than
  the conversation does, so weigh them heavily. thread_messages may be EMPTY when a thread
  was opened from a ticket and nobody has replied — classify from the ticket alone and
  return an empty sourceMessageIds for each type.

## Task — tag the thread

${numbered(threadTypes)}

Add every type that genuinely applies, and nothing else. Most threads take one; some take
two or three; none take all of them.

Each definition states what it covers and, after "NOT", the near-misses it excludes. Read the
NOT clauses before tagging — they are where this task goes wrong.

Two tests, and a type must pass the one its definition is written in terms of:

- Definitions phrased as "done = …" are about the thread as a piece of WORK. Ask what would
  have to happen for this thread to be finished.
- The rest are about the thread as a DOCUMENT. Ask whether someone who was never in this
  thread could get their question answered by THIS THREAD ALONE. The bar is high and most
  threads clear none of them. Tag what the thread ANSWERS, not what it discusses — a thread
  full of debugging that never lands on an answer gets none of these. Not reaching for one is
  the normal, correct result; do not add one to look thorough.

## Evidence — required for every type

For each type you return, cite the messages that make it true, by id, in sourceMessageIds.

Cite the message that CAUSED the tag, not every message that mentions the topic. When the
type describes what the thread is for, that is usually the message that opened it or first
stated the problem; when the type describes what the thread teaches, it is the message that
actually contains the answer — the one with the steps, the narrative, the decision and its
reasoning, the values. One or two ids is normal. Never cite more than three.

Only ever cite ids that appear in thread_messages. If the type comes from the ticket rather
than any message, return an empty list rather than guessing at an id.

If you cannot point at a message that justifies a type, that is a sign the type does not
apply — drop it rather than citing something loosely related.

## Output

{
  "threadTypes": [
    { "name": "<one of ${names(threadTypes)}>", "sourceMessageIds": ["<id from thread_messages>"] }
  ]
}

Most-important type first. Use the exact strings above — no other spelling, casing or
punctuation. threadTypes is always required and must never be empty; every entry must have a
name and a sourceMessageIds array, which may be empty only when the type comes from the
ticket.`;
};
