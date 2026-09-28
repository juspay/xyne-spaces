const SENTENCE_END = /[.!?]+["')\]]*(?=\s)|\n+/g;
const MAX_TTS_CHARS = 1800;

export interface SentenceSplit {
  sentences: string[];
  rest: string;
}

function hardWrap(sentence: string): string[] {
  if (sentence.length <= MAX_TTS_CHARS) return [sentence];
  const parts: string[] = [];
  let remaining = sentence;
  while (remaining.length > MAX_TTS_CHARS) {
    let cut = remaining.lastIndexOf(' ', MAX_TTS_CHARS);
    if (cut <= 0) cut = MAX_TTS_CHARS;
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

export function splitSentences(text: string): SentenceSplit {
  const sentences: string[] = [];
  let lastIndex = 0;
  SENTENCE_END.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SENTENCE_END.exec(text)) !== null) {
    const end = match.index + match[0].length;
    const chunk = text.slice(lastIndex, end).trim();
    if (chunk) {
      for (const part of hardWrap(chunk)) sentences.push(part);
    }
    lastIndex = end;
  }
  return { sentences, rest: text.slice(lastIndex) };
}

export function flushRemainder(rest: string): string[] {
  const trimmed = rest.trim();
  if (!trimmed) return [];
  return hardWrap(trimmed);
}
