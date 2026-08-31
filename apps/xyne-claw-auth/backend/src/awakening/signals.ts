/**
 * Derives the counts the gate decides on and the agent reads.
 *
 * Pure: takes events, returns numbers. Everything expensive already happened
 * in the collector. Keeping this side-effect-free is what lets the gate be
 * table-tested exhaustively without a database.
 */

import type { WindowEvent, WindowSignals } from "./types.js";

export function computeSignals(events: WindowEvent[]): WindowSignals {
  const senders = new Set<string>();
  const threads = new Set<string>();
  const channels = new Set<string>();
  const unansweredThreads = new Set<string>();

  let humanEventCount = 0;
  let botEventCount = 0;
  let selfEventCount = 0;
  let newThreads = 0;
  let mentionsOfMe = 0;
  let questions = 0;
  let actionSignals = 0;

  for (const e of events) {
    threads.add(e.cv);
    if (e.ch) channels.add(e.ch);

    if (e.isMe) selfEventCount++;
    else if (e.isHuman) {
      humanEventCount++;
      senders.add(e.senderId);
    } else botEventCount++;

    if (e.root) newThreads++;
    if (e.mentionsMe) mentionsOfMe++;
    if (e.question && e.isHuman) questions++;
    if (e.actionSignals.length > 0 && e.isHuman) actionSignals++;
    if (e.unanswered) unansweredThreads.add(e.cv);
  }

  return {
    eventCount: events.length,
    humanEventCount,
    botEventCount,
    selfEventCount,
    distinctSenders: senders.size,
    distinctThreads: threads.size,
    newThreads,
    unansweredThreads: unansweredThreads.size,
    mentionsOfMe,
    questions,
    actionSignals,
    channelsWithActivity: channels.size,
  };
}
