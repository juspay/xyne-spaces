interface SseParser {
  push(chunk: string): void;
}

// A trailing `\r` is held back because the next chunk may start with its `\n`.
const LINE_BREAK = /\r\n|\r(?!$)|\n/;

/** Incremental Server-Sent Events parser; chunk boundaries may fall anywhere. `event` is empty for unnamed events. */
export function createSseParser(onMessage: (data: string, event: string) => void): SseParser {
  let buffer = '';
  let event = '';
  let data: string[] = [];

  function processLine(line: string): void {
    if (line === '') {
      if (data.length > 0) onMessage(data.join('\n'), event);
      event = '';
      data = [];
      return;
    }

    const colon = line.indexOf(':');
    if (colon === 0) return;

    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'data') data.push(value);
    else if (field === 'event') event = value;
  }

  return {
    push(chunk: string): void {
      const lines = (buffer + chunk).split(LINE_BREAK);
      buffer = lines.pop() ?? '';
      lines.forEach(processLine);
    },
  };
}
