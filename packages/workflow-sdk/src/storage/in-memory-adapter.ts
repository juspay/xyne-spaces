/**
 * In-memory StorageAdapter for tests and local development.
 *
 * Blobs in a Map behind a `mem://<id>` handle. Deliberately not a shortcut
 * around the streaming contract — `put` drains the stream and `stream` hands
 * one back — so a test exercises the paths a real adapter does.
 */

import { Readable } from 'node:stream';
import type { Attachment } from '../common/attachment.js';
import type { StorageAdapter, StorageFile, StorageInfo, StorageScope } from './types.js';

interface StoredBlob {
  bytes: Uint8Array;
  attachment: Attachment;
}

export class InMemoryStorageAdapter implements StorageAdapter {
  /** Exposed for test inspection — count, clear, etc. */
  readonly blobs = new Map<string, StoredBlob>();

  private nextId = 1;

  private genHandle(): string {
    return `mem://${String(this.nextId++)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  async put(_scope: StorageScope, file: StorageFile): Promise<Attachment> {
    const chunks: Buffer[] = [];
    for await (const chunk of file.stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    const bytes = new Uint8Array(Buffer.concat(chunks));
    const handle = this.genHandle();
    const attachment: Attachment = {
      name: file.name,
      mimeType: file.mimeType,
      handle,
      size: bytes.byteLength,
    };
    this.blobs.set(handle, { bytes, attachment });
    return attachment;
  }

  async stream(ref: Attachment): Promise<Readable> {
    const stored = this.blobs.get(ref.handle);
    if (!stored) {
      throw new Error(`InMemoryStorageAdapter: unknown reference "${ref.handle}"`);
    }
    return Readable.from(Buffer.from(stored.bytes));
  }

  async info(ref: Attachment): Promise<StorageInfo | null> {
    const stored = this.blobs.get(ref.handle);
    if (!stored) return null;
    return { size: stored.bytes.byteLength, mimeType: stored.attachment.mimeType };
  }

  /**
   * The scope each delete was given. A fake that ignores it passes tests a real
   * adapter fails, which happened once — so tests can assert it arrived.
   */
  readonly deleteScopes: Array<StorageScope | undefined> = [];

  async delete(ref: Attachment, scope?: StorageScope): Promise<void> {
    this.deleteScopes.push(scope);
    this.blobs.delete(ref.handle);
  }

  async signUrl(ref: Attachment, _ttlSeconds: number): Promise<string> {
    // For tests / dev — the opaque handle doubles as the URL.
    return ref.handle;
  }
}
