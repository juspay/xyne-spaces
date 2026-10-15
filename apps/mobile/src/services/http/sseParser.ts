export interface SseMessage {
  event: string;
  data: string;
}

export interface SseParser {
  push(chunk: string): void;
}

// A trailing `\r` is held back because the next chunk may start with its `\n`.
const LINE_BREAK = /\r\n|\r(?!$)|\n/;

/** Incremental Server-Sent Events parser; chunk boundaries may fall anywhere. */
export function createSseParser(onMessage: (message: SseMessage) => void): SseParser {
  let buffer = '';
  let event = '';
  let data: string[] = [];

  function processLine(line: string): void {
    if (line === '') {
      if (data.length > 0) onMessage({ event: event || 'message', data: data.join('\n') });
      event = '';
      data = [];
      return;
    }

    const colon = line.indexOf(':');
    if (colon === 0) return;

    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }

  return {
    push(chunk: string): void {
      const lines = (buffer + chunk).split(LINE_BREAK);
      buffer = lines.pop() ?? '';
      lines.forEach(processLine);
    },
  };
}
