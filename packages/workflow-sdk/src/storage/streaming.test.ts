/**
 * The regression guard: a file's size must not decide how much memory the
 * process uses. These push more through both byte paths than a heap could hold
 * and assert what is held stays flat.
 */

import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { createFileAccess, AttachmentTooLargeError } from './files.js';
import { multipartBody } from '../connectors/builtin/steps/multipart-body.js';
import type { Attachment } from '../common/attachment.js';
import type { StorageAdapter, StorageFile, StorageInfo } from './types.js';

const MB = 1024 * 1024;
const CHUNK = 64 * 1024;

/** Bytes that exist only while in flight, as a real store's do. */
function* generate(total: number): Generator<Buffer> {
  for (let sent = 0; sent < total; sent += CHUNK) {
    // A fresh buffer each time: reusing one would hide retention.
    yield Buffer.alloc(Math.min(CHUNK, total - sent), 0x61);
  }
}

class SinkStorage implements StorageAdapter {
  written = 0;
  constructor(private readonly size: number) {}

  async put(_scope: unknown, file: StorageFile): Promise<Attachment> {
    for await (const chunk of file.stream) this.written += (chunk as Buffer).length;
    return { name: file.name, mimeType: file.mimeType, handle: 'sink://1', size: this.written };
  }

  async stream(): Promise<Readable> {
    return Readable.from(generate(this.size));
  }

  async info(): Promise<StorageInfo | null> {
    return { size: this.size, mimeType: 'application/octet-stream' };
  }

  async delete(): Promise<void> {
    /* a sink has nothing to reclaim */
  }
}

const ref = (size: number): Attachment => ({
  name: 'big.bin',
  mimeType: 'application/octet-stream',
  handle: 'sink://1',
  size,
});

/** Peak growth in bytes the process is holding across `run`. */
async function heapGrowth(run: () => Promise<void>): Promise<number> {
  const before = process.memoryUsage().heapUsed;
  await run();
  return process.memoryUsage().heapUsed - before;
}

describe('bytes move without accumulating', () => {
  // Generous — buffering 128MB would blow this by an order of magnitude.
  const BUDGET = 32 * MB;

  it('streams an attachment into storage without holding it', async () => {
    const size = 128 * MB;
    const storage = new SinkStorage(size);

    const growth = await heapGrowth(async () => {
      await storage.put({}, {
        name: 'big.bin',
        mimeType: 'application/octet-stream',
        stream: Readable.from(generate(size)),
      });
    });

    expect(storage.written).toBe(size);
    expect(growth).toBeLessThan(BUDGET);
  });

  it('builds a multipart upload body without holding the file', async () => {
    const size = 128 * MB;
    const storage = new SinkStorage(size);
    let sent = 0;

    const growth = await heapGrowth(async () => {
      const { body, contentType } = multipartBody(
        [{ key: 'verdict', value: 'passed' }],
        [{ key: 'report', attachment: ref(size) }],
        () => storage.stream(),
      );
      expect(contentType).toContain('boundary=');
      for await (const chunk of body) sent += (chunk as Buffer).length;
    });

    // Everything arrived — the headers and trailer on top of the file itself.
    expect(sent).toBeGreaterThan(size);
    expect(growth).toBeLessThan(BUDGET);
  });

  it('refuses to buffer an oversized attachment before transferring anything', async () => {
    const size = 128 * MB;
    const storage = new SinkStorage(size);
    const files = createFileAccess(storage, {} as never);

    const growth = await heapGrowth(async () => {
      await expect(files.buffer(ref(size), { maxBytes: 8 * MB }))
        .rejects.toBeInstanceOf(AttachmentTooLargeError);
    });

    // `info` answered, so not one byte was fetched to find this out.
    expect(growth).toBeLessThan(2 * MB);
  });

  it('still refuses when the adapter cannot say how big it is', async () => {
    const size = 128 * MB;
    const storage = new SinkStorage(size);
    // An adapter whose `info` is blind: the ceiling has to hold anyway.
    storage.info = async () => null;
    const files = createFileAccess(storage, {} as never);

    await expect(files.buffer(ref(size), { maxBytes: 4 * MB }))
      .rejects.toBeInstanceOf(AttachmentTooLargeError);
  });
});
