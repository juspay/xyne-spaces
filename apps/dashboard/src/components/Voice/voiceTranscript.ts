import type { Message } from '../Chat/XyneAISidebar/utils/XyneAITypes';

export interface TranscriptLine {
  id: string;
  speaker: 'you' | 'xyne';
  text: string;
  /** A reply still streaming in: shown as it grows, or as a pulse before its first words. */
  live: boolean;
}

/** As claw titles a chat it has not named yet (multi-agent-chat.ts TITLE_FALLBACK_CHARS). */
const TITLE_FALLBACK_CHARS = 80;
const NEW_CHAT = 'New chat';
const FAILED_REPLY = "Xyne AI couldn't answer this.";

/** A reply's markdown as plain text for a bubble: code, links, citations and marks reduced to words. */
export function toPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/\s*\[clf-[^\]]*\]/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The chat's lines in voice mode: what was asked and answered, in the order the chat shows them. */
export function transcriptOf(messages: readonly Message[]): TranscriptLine[] {
  return messages.flatMap((message): TranscriptLine[] => {
    if (message.type === 'user') {
      const text = message.content.trim();
      return text ? [{ id: message.id, speaker: 'you', text, live: false }] : [];
    }
    const live = !!message.isStreaming;
    const text = toPlainText(message.content || message.streamingContent || '');
    if (text || live) return [{ id: message.id, speaker: 'xyne', text, live }];
    return message.errorInfo
      ? [{ id: message.id, speaker: 'xyne', text: FAILED_REPLY, live: false }]
      : [];
  });
}

/** The chat's saved title, else its first request as claw would title it, else a new chat. */
export function chatTitleOf(
  saved: string | null | undefined,
  messages: readonly Message[],
): string {
  if (saved?.trim()) return saved.trim();
  const first = messages.find(message => message.type === 'user' && message.content.trim());
  return first ? first.content.trim().slice(0, TITLE_FALLBACK_CHARS) : NEW_CHAT;
}
