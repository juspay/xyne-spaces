import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createSseParser, type SseMessage } from '@/src/services/http/sseParser';

function parse(...chunks: string[]): SseMessage[] {
  const messages: SseMessage[] = [];
  const parser = createSseParser(message => messages.push(message));
  chunks.forEach(chunk => parser.push(chunk));
  return messages;
}

describe('createSseParser', () => {
  it('dispatches an unnamed event as "message"', () => {
    assert.deepEqual(parse('data: hello\n\n'), [{ event: 'message', data: 'hello' }]);
  });

  it('reads named events without leaking the name into the next event', () => {
    assert.deepEqual(parse('event: snapshot\ndata: 1\n\ndata: 2\n\n'), [
      { event: 'snapshot', data: '1' },
      { event: 'message', data: '2' },
    ]);
  });

  it('joins multi-line data with newlines', () => {
    assert.deepEqual(parse('data: a\ndata:\ndata: b\n\n'), [{ event: 'message', data: 'a\n\nb' }]);
  });

  it('removes only one leading space and keeps colons in the value', () => {
    assert.deepEqual(parse('data:  {"a":"b: c"}\n\n'), [
      { event: 'message', data: ' {"a":"b: c"}' },
    ]);
  });

  it('ignores comments, unknown fields and events without data', () => {
    assert.deepEqual(parse(': ping\n\nevent: lonely\n\nid: 1\nretry: 5\ndata: x\n\n'), [
      { event: 'message', data: 'x' },
    ]);
  });

  it('waits for the blank line before dispatching', () => {
    assert.deepEqual(parse('data: a\n\ndata: partial\n'), [{ event: 'message', data: 'a' }]);
  });

  for (const [name, eol] of [
    ['LF', '\n'],
    ['CRLF', '\r\n'],
    ['CR', '\r'],
  ]) {
    it(`handles ${name} line endings`, () => {
      assert.deepEqual(parse(`event: x${eol}data: 1${eol}${eol}data: 2${eol}${eol}\n`), [
        { event: 'x', data: '1' },
        { event: 'message', data: '2' },
      ]);
    });
  }

  it('gives the same result wherever the stream is split', () => {
    const stream = 'event: delta\r\ndata: {"t":"a"}\r\n\r\n: ping\n\ndata: x\rdata: y\r\r\n';
    const expected = parse(stream);
    assert.deepEqual(expected, [
      { event: 'delta', data: '{"t":"a"}' },
      { event: 'message', data: 'x\ny' },
    ]);

    for (let i = 0; i <= stream.length; i += 1) {
      assert.deepEqual(parse(stream.slice(0, i), stream.slice(i)), expected, `split at ${i}`);
    }
    assert.deepEqual(parse(...stream), expected);
  });
});
