import net from 'node:net';
import type { Readable } from 'node:stream';

/** Outcome of one scan: clean, a named detection, or the scanner could not answer. */
export type ClamavVerdict =
  | { status: 'clean' }
  | { status: 'infected'; signature: string }
  | { status: 'error'; reason: string };

export interface ClamavOptions {
  host: string;
  port: number;
  timeoutMs: number;
}

/** clamd's INSTREAM chunks carry a 4-byte length prefix; keep each well under StreamMaxLength. */
const CHUNK_BYTES = 64 * 1024;

/**
 * Scan a stream with clamd over its INSTREAM command (no file on disk needed).
 * Never throws: connection failures, timeouts and clamd errors come back as
 * `{ status: 'error' }` so the caller decides whether to fail open or closed.
 */
export function scanStream(source: Readable, opts: ClamavOptions): Promise<ClamavVerdict> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: opts.host, port: opts.port });
    let settled = false;
    let response = '';

    const finish = (verdict: ClamavVerdict) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      source.off('data', onData);
      source.off('end', onEnd);
      source.off('error', onSourceError);
      resolve(verdict);
    };

    socket.setTimeout(opts.timeoutMs, () => finish({ status: 'error', reason: 'clamd timed out' }));
    socket.once('error', (err) => finish({ status: 'error', reason: err.message }));

    socket.on('data', (data) => {
      response += data.toString('utf8');
    });
    socket.once('close', () => {
      // clamd terminates its reply with NUL (we asked for the z-prefixed command).
      const reply = response.replace(/\0/g, '').trim();
      if (reply.endsWith('OK')) return finish({ status: 'clean' });
      const found = /^stream:\s*(.+?)\s+FOUND$/.exec(reply);
      if (found) return finish({ status: 'infected', signature: found[1] });
      finish({ status: 'error', reason: reply || 'clamd closed the connection without a reply' });
    });

    const onData = (chunk: Buffer) => {
      for (let offset = 0; offset < chunk.length; offset += CHUNK_BYTES) {
        const part = chunk.subarray(offset, offset + CHUNK_BYTES);
        const header = Buffer.alloc(4);
        header.writeUInt32BE(part.length, 0);
        socket.write(header);
        if (!socket.write(part)) {
          source.pause();
          socket.once('drain', () => source.resume());
        }
      }
    };
    const onEnd = () => {
      // A zero-length chunk tells clamd the stream is complete.
      socket.write(Buffer.alloc(4));
    };
    const onSourceError = (err: Error) => finish({ status: 'error', reason: err.message });

    socket.once('connect', () => {
      socket.write('zINSTREAM\0');
      source.on('data', onData);
      source.once('end', onEnd);
      source.once('error', onSourceError);
    });
  });
}
