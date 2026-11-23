/**
 * Splits the activity stream body into messages. X sends one JSON object per line and a bare
 * `\r\n` keep-alive at least every ~20 s; a JSON object may arrive split across chunks.
 */
export class XStreamLineParser {
  private buffer = '';
  private readonly decoder = new TextDecoder();

  /** Feeds a chunk; returns the complete non-empty lines it completed. */
  push(chunk: Uint8Array | string): string[] {
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true });
    const lines: string[] = [];
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (line) lines.push(line);
    }
    return lines;
  }

  /** Bytes of an unfinished line still buffered (guards against an unbounded line). */
  get pendingLength(): number {
    return this.buffer.length;
  }
}

/**
 * X's documented reconnect backoff:
 * - network errors (TCP/TLS reset, stall): linear, +250 ms per attempt, capped at 16 s;
 * - HTTP errors: exponential from 5 s, capped at 320 s;
 * - 429: exponential from 1 min.
 * Credits exhausted is not retryable on a short timer; it waits a fixed long interval.
 */
export type XStreamFailure = 'network' | 'http' | 'rate_limited' | 'credits';

export const X_CREDITS_RETRY_MS = 15 * 60 * 1000;

export function xReconnectDelayMs(kind: XStreamFailure, attempt: number): number {
  const n = Math.max(1, attempt);
  switch (kind) {
    case 'network':
      return Math.min(250 * n, 16_000);
    case 'http':
      return Math.min(5_000 * 2 ** (n - 1), 320_000);
    case 'rate_limited':
      return Math.min(60_000 * 2 ** (n - 1), 15 * 60_000);
    case 'credits':
      return X_CREDITS_RETRY_MS;
  }
}
