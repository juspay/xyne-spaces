/**
 * One message at a time per chat.
 *
 * Each inbound message is handled in its own task, so on a busy chat a photo
 * that takes a moment to download can be overtaken by the text sent straight
 * after it, and the agent answers them in the wrong order.
 *
 * Serialising per chat fixes the ordering and costs nothing anywhere else:
 * different chats, and different accounts, still run fully in parallel.
 *
 * What it does NOT do is serialise the runs themselves. The chain releases
 * when a message has been dispatched, not when the agent has answered, so two
 * messages sent seconds apart still produce two overlapping runs on one
 * conversation. Holding the chain until the result arrives would mean waiting
 * on /webhook/result from inside the inbound path, which is a different and
 * much larger change.
 */
const chains = new Map<string, Promise<unknown>>();

export function runSerialized<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();
  // A failed message must not poison the chat: the next one still runs.
  const next = previous.catch(() => undefined).then(task);
  chains.set(key, next);
  // Drop the entry once nothing is queued behind it, so a busy account does
  // not accumulate a promise per chat it has ever seen.
  void next
    .catch(() => undefined)
    .finally(() => {
      if (chains.get(key) === next) chains.delete(key);
    });
  return next;
}
