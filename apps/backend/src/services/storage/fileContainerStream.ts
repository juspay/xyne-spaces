import { PassThrough, type Readable } from 'stream';
import { FILE_CHUNK_OVERHEAD, hasFileContainerMagic, parseFileHeader, type FileContainerHeader } from '@xyne/shared';
import { getEncryptionProvider, type FileChunk, type TransitCaller } from '@/services/encryption';

/** Input bytes per encryption-service call: base64 of it stays well under its 10 MB limit. */
const BATCH_BYTES = 4 * 1024 * 1024;
/** magic (4) + key id length (1) + key id (≤255) + chunk size (4) + file id (16). */
export const MAX_HEADER_LENGTH = 280;

type Source = AsyncIterable<Buffer | string | Uint8Array>;

class ByteQueue {
  private parts: Buffer[] = [];
  length = 0;

  push(piece: Buffer | string | Uint8Array): void {
    const buf = Buffer.isBuffer(piece) ? piece : Buffer.from(piece);
    if (buf.length === 0) return;
    this.parts.push(buf);
    this.length += buf.length;
  }

  peek(n: number): Buffer {
    return Buffer.concat(this.parts, Math.min(n, this.length)).subarray(0, Math.min(n, this.length));
  }

  take(n: number): Buffer {
    const out = Buffer.allocUnsafe(n);
    let at = 0;
    while (at < n) {
      const head = this.parts[0];
      const used = Math.min(head.length, n - at);
      head.copy(out, at, 0, used);
      at += used;
      if (used === head.length) this.parts.shift();
      else this.parts[0] = head.subarray(used);
    }
    this.length -= n;
    return out;
  }
}

/**
 * `source` cut into records of `size` bytes, each yielded once the next one has started, so
 * the final record is known as such (`last`). `empty` decides what an input with no record
 * at all yields.
 */
async function* records(
  queue: ByteQueue,
  rest: AsyncIterator<Buffer | string | Uint8Array>,
  size: number,
  onEmpty: () => FileChunk,
): AsyncGenerator<FileChunk> {
  let index = 0;
  let held: Buffer | null = null;
  for (;;) {
    while (queue.length >= size) {
      const next = queue.take(size);
      if (held) yield { index: index++, last: false, data: held };
      held = next;
    }
    const piece = await rest.next();
    if (piece.done) break;
    queue.push(piece.value);
  }
  if (queue.length > 0) {
    if (held) yield { index: index++, last: false, data: held };
    yield { index, last: true, data: queue.take(queue.length) };
  } else if (held) {
    yield { index, last: true, data: held };
  } else {
    yield onEmpty();
  }
}

/** A container's header, then its chunks (iv | ciphertext | tag each). */
async function readContainer(source: Source): Promise<{ header: FileContainerHeader; chunks: AsyncGenerator<FileChunk> }> {
  const queue = new ByteQueue();
  const it = source[Symbol.asyncIterator]();
  let header: FileContainerHeader | null = null;
  while (!header) {
    const piece = await it.next();
    if (piece.done) throw new Error('Encrypted file is truncated');
    queue.push(piece.value);
    header = parseFileHeader(queue.peek(MAX_HEADER_LENGTH));
  }
  queue.take(header.bytes.length);
  const chunks = records(queue, it, header.chunkSize + FILE_CHUNK_OVERHEAD, () => {
    throw new Error('Encrypted file has no chunks');
  });
  return { header, chunks };
}

/**
 * Plaintext cut into `chunkSize` pieces; an empty input is one empty last chunk. Bytes that are
 * already a container were sent encrypted to a route that does not take client-encrypted
 * files: encrypting them again would store a file nobody can read, so they are refused.
 */
async function* plaintextChunks(source: Source, chunkSize: number): AsyncGenerator<FileChunk> {
  const chunks = records(new ByteQueue(), source[Symbol.asyncIterator](), chunkSize, () => ({
    index: 0,
    last: true,
    data: Buffer.alloc(0),
  }));
  for await (const chunk of chunks) {
    if (chunk.index === 0 && hasFileContainerMagic(chunk.data)) {
      throw new Error('Upload is an encrypted file container on a route that does not take one');
    }
    yield chunk;
  }
}

async function* batches(chunks: AsyncIterable<FileChunk>): AsyncGenerator<FileChunk[]> {
  let batch: FileChunk[] = [];
  let bytes = 0;
  for await (const chunk of chunks) {
    if (batch.length > 0 && bytes + chunk.data.length > BATCH_BYTES) {
      yield batch;
      batch = [];
      bytes = 0;
    }
    batch.push(chunk);
    bytes += chunk.data.length;
  }
  if (batch.length > 0) yield batch;
}

/**
 * A stream fed by `work`, which writes with backpressure. A failure of `work` destroys the
 * stream with its error, so whoever consumes it (the upload, the response) fails with it.
 */
function produce(work: (write: (bytes: Buffer) => Promise<void>) => Promise<void>, onError: (err: Error) => void): Readable {
  const out = new PassThrough();
  const write = (bytes: Buffer): Promise<void> =>
    new Promise((resolve, reject) => {
      if (out.destroyed) {
        reject(new Error('Encrypted file stream closed'));
        return;
      }
      if (out.write(bytes)) {
        resolve();
        return;
      }
      const onDrain = (): void => {
        out.off('close', onClose);
        resolve();
      };
      const onClose = (): void => {
        out.off('drain', onDrain);
        reject(new Error('Encrypted file stream closed'));
      };
      out.once('drain', onDrain);
      out.once('close', onClose);
    });
  work(write).then(
    () => out.end(),
    (err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      onError(error);
      out.destroy(error);
    },
  );
  return out;
}

function destroySource(source: unknown, err: Error): void {
  const stream = source as { destroy?: (e?: Error) => void };
  if (typeof stream.destroy === 'function') stream.destroy(err);
}

export type SealOptions = {
  workspaceId: string;
  /** Set when `source` is the caller's transit container; plaintext otherwise. */
  caller: TransitCaller | null;
  /** Plaintext bytes per chunk, for plaintext sources. */
  chunkSize: number;
};

/**
 * `source` as a workspace storage container, encrypted chunk by chunk by the encryption
 * service. `plaintextBytes` settles with the file's plaintext size once the stream has ended.
 */
export function sealFile(source: Source, options: SealOptions): { stream: Readable; plaintextBytes: Promise<number> } {
  const provider = getEncryptionProvider();
  let settle!: (n: number) => void;
  let fail!: (err: Error) => void;
  const plaintextBytes = new Promise<number>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  plaintextBytes.catch(() => undefined);

  const stream = produce(async (write) => {
    let total = 0;
    let header: string | undefined;
    let sourceHeader: string | undefined;
    let chunks: AsyncGenerator<FileChunk>;
    if (options.caller) {
      const container = await readContainer(source);
      sourceHeader = Buffer.from(container.header.bytes).toString('base64');
      chunks = container.chunks;
    } else {
      chunks = plaintextChunks(source, options.chunkSize);
    }
    for await (const batch of batches(chunks)) {
      const sealed = await provider.sealFileChunks({
        ...(options.caller ?? {}),
        workspaceId: options.workspaceId,
        ...(header ? { header } : { chunkSize: options.chunkSize }),
        ...(sourceHeader ? { sourceHeader } : {}),
        chunks: batch,
      });
      if (!header) {
        header = sealed.header;
        await write(Buffer.from(sealed.header, 'base64'));
      }
      for (const chunk of sealed.chunks) await write(chunk);
      for (const chunk of batch) total += options.caller ? chunk.data.length - FILE_CHUNK_OVERHEAD : chunk.data.length;
    }
    settle(total);
  }, (err) => {
    fail(err);
    destroySource(source, err);
  });
  return { stream, plaintextBytes };
}

export type OpenOptions = {
  workspaceId: string;
  caller: TransitCaller;
};

/** Chunks of a stored container (`header`'s) written as a transit container for the caller. */
async function writeTransitChunks(
  write: (bytes: Buffer) => Promise<void>,
  header: FileContainerHeader,
  chunks: AsyncIterable<FileChunk>,
  options: OpenOptions,
): Promise<void> {
  const provider = getEncryptionProvider();
  const storageHeader = Buffer.from(header.bytes).toString('base64');
  let transitHeader: string | undefined;
  for await (const batch of batches(chunks)) {
    const opened = await provider.openFileChunksForTransit({
      ...options.caller,
      workspaceId: options.workspaceId,
      header: storageHeader,
      ...(transitHeader ? { transitHeader } : {}),
      chunks: batch,
    });
    if (!transitHeader) {
      transitHeader = opened.header;
      await write(Buffer.from(opened.header, 'base64'));
    }
    for (const chunk of opened.chunks) await write(chunk);
  }
}

/** A stored container (`source`) re-encrypted chunk by chunk for the caller's transit key. */
export function openFileForTransit(source: Source, options: OpenOptions): Readable {
  return produce(async (write) => {
    const container = await readContainer(source);
    await writeTransitChunks(write, container.header, container.chunks, options);
  }, (err) => destroySource(source, err));
}

export type OpenRangeOptions = OpenOptions & {
  /** The stored container's header (`source` holds only chunk bytes). */
  header: FileContainerHeader;
  /** Index of the first chunk in `source`. */
  firstIndex: number;
  /** Chunks in the whole file: the last one is sealed as such. */
  totalChunks: number;
};

/**
 * A run of a stored container's chunks (`source`: their bytes, from chunk `firstIndex`, as a
 * range read of the object returns them) re-encrypted for the caller's transit key: a transit
 * container header followed by those chunks, under their own indexes.
 */
export function openFileRangeForTransit(source: Source, options: OpenRangeOptions): Readable {
  return produce(async (write) => {
    const record = options.header.chunkSize + FILE_CHUNK_OVERHEAD;
    const chunks = records(new ByteQueue(), source[Symbol.asyncIterator](), record, () => {
      throw new Error('Encrypted file range is empty');
    });
    await writeTransitChunks(write, options.header, renumber(chunks, options.firstIndex, options.totalChunks), options);
  }, (err) => destroySource(source, err));
}

async function* renumber(chunks: AsyncIterable<FileChunk>, firstIndex: number, totalChunks: number): AsyncGenerator<FileChunk> {
  for await (const chunk of chunks) {
    const index = chunk.index + firstIndex;
    yield { index, last: index === totalChunks - 1, data: chunk.data };
  }
}

export async function collect(stream: AsyncIterable<Buffer | string | Uint8Array>): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const piece of stream) parts.push(Buffer.isBuffer(piece) ? piece : Buffer.from(piece));
  return Buffer.concat(parts);
}
