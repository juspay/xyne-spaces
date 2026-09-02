import type { BootstrapConfig } from '../config.js'
import type { SourceDocument, SourceMessage } from '../types.js'
import { cleanMessageText, humanizeChannelName } from '../lib/normalize.js'

export interface ChannelInput {
  id: string
  name: string
}

/**
 * One thread → one document (or a few, if it is very long).
 *
 * The caller fetches and builds one thread at a time, so only a single thread
 * is ever in memory. Messages are cleaned, ordered oldest-first (coreference
 * needs the naming message before the pronoun), concatenated, and split at
 * message boundaries only if the thread exceeds `maxThreadChars`.
 */
export function buildThreadDocument(
  threadId: string,
  messages: SourceMessage[],
  channel: ChannelInput,
  config: BootstrapConfig,
): SourceDocument[] {
  const cfg = config.fetchMessages
  const channelName = humanizeChannelName(channel.name)

  // The thread's ticket doc id, if this is a ticket thread (its header is a
  // synthetic `ticket:<id>` message). Stamped on every chunk so the write-back
  // can also tag the ticket doc, not just the chat messages.
  const ticketId = messages.find((m) => m.id.startsWith('ticket:'))?.id.slice('ticket:'.length)

  const cleaned = messages
    .map((m) => {
      const clean = cleanMessageText(m.text, cfg.minTextLength)
      return { id: m.id, text: clean.drop ? '' : clean.text, ts: m.ts }
    })
    .sort((a, b) => a.ts - b.ts)

  if (cleaned.length === 0) return []

  const docs: SourceDocument[] = []
  let part: string[] = []
  let partIds: string[] = []
  let chars = 0
  let partIndex = 0

  const flush = () => {
    if (part.length === 0) return
    docs.push({
      id: partIndex === 0 ? `thread:${threadId}` : `thread:${threadId}#${partIndex}`,
      kind: 'thread',
      channelId: channel.id,
      channelName,
      text: part.join('\n'),
      messageCount: part.length,
      // Real chat_message docIds only. The synthetic ticket-header (`ticket:<id>`)
      // and merged mails (`mail:<id>`) are not chat_message docs, so the entity
      // write-back must not target them.
      messageIds: partIds.filter((id) => !id.startsWith('ticket:') && !id.startsWith('mail:')),
      ...(ticketId ? { ticketId } : {}),
    })
    partIndex++
    part = []
    partIds = []
    chars = 0
  }

  for (const m of cleaned) {
    if (m.text && chars > 0 && chars + m.text.length > cfg.maxThreadChars) {
      flush()
    }
    if (m.text) {
      part.push(m.text)
      chars += m.text.length + 1
    }
    partIds.push(m.id)
  }
  flush()
  return docs
}
