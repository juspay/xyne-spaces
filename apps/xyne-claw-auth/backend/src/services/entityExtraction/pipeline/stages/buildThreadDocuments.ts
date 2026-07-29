import type { BootstrapConfig } from '../config.js'
import type { SourceDocument, SourceMessage } from '../types.js'
import { cleanMessageText, humanizeChannelName } from '../lib/normalize.js'

export interface ChannelInput {
  id: string
  name: string
  description?: string
}

/**
 * The channel's own name/description as one high-signal document — it is
 * human-authored, so near-zero extraction noise. Null when there's nothing.
 */
export function channelMetaDocument(
  channel: ChannelInput,
  config: BootstrapConfig,
): SourceDocument | null {
  const channelName = humanizeChannelName(channel.name)
  const text = [channelName, channel.description]
    .filter((p): p is string => Boolean(p && p.trim()))
    .join('. ')
  if (!text) return null
  return {
    id: `chan:${channel.id}`,
    kind: 'channel_meta',
    channelId: channel.id,
    channelName,
    text,
    ts: 0,
    weight: config.fetchMessages.channelMetaWeight,
  }
}

/**
 * One ticket → one document. Title and description are human-authored and name
 * entities explicitly, so a ticket is high-signal for type discovery — often
 * cleaner than chat. Returns null when there is no usable text.
 */
export function buildTicketDocument(
  ticket: { id: string; title: string; description: string },
  channel: ChannelInput,
  config: BootstrapConfig,
): SourceDocument | null {
  const title = (ticket.title ?? '').trim()
  // description_clean from Vespa is already normalized; a light trim is enough.
  const description = (ticket.description ?? '').trim()
  const text = [title, description].filter(Boolean).join('\n')
  if (!text) return null
  return {
    id: `ticket:${ticket.id}`,
    kind: 'ticket',
    channelId: channel.id,
    channelName: humanizeChannelName(channel.name),
    text,
    ts: 0,
    weight: config.fetchMessages.channelMetaWeight,
    messageCount: 1,
  }
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

  const cleaned = messages
    .map((m) => ({ text: cleanMessageText(m.text, cfg.minTextLength), ts: m.ts }))
    .filter((m) => !m.text.drop)
    .map((m) => ({ text: m.text.text, ts: m.ts }))
    .sort((a, b) => a.ts - b.ts)

  if (cleaned.length === 0) return []

  const docs: SourceDocument[] = []
  let part: string[] = []
  let chars = 0
  let partIndex = 0
  let partTs = cleaned[0]!.ts

  const flush = () => {
    if (part.length === 0) return
    docs.push({
      id: partIndex === 0 ? `thread:${threadId}` : `thread:${threadId}#${partIndex}`,
      kind: 'thread',
      channelId: channel.id,
      channelName,
      text: part.join('\n'),
      ts: partTs,
      weight: cfg.messageWeight,
      messageCount: part.length,
    })
    partIndex++
    part = []
    chars = 0
  }

  for (const m of cleaned) {
    if (chars > 0 && chars + m.text.length > cfg.maxThreadChars) {
      flush()
      partTs = m.ts
    }
    part.push(m.text)
    chars += m.text.length + 1
  }
  flush()
  return docs
}
