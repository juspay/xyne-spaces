import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import {
  createFileAccess,
  AttachmentTooLargeError,
  StorageUnavailableError,
} from './files.js';
import type { Attachment } from '../common/attachment.js';
import type { StorageAdapter, StorageFile } from './types.js';

const ref: Attachment = { name: 'a.txt', mimeType: 'text/plain', handle: 'h1', size: 5 };

/** Records the scope it was called with, so the binding can be asserted. */
function spyAdapter() {
  const scopes: unknown[] = [];
  const adapter: StorageAdapter = {
    async put(scope, file: StorageFile) {
      scopes.push(scope);
      let size = 0;
      for await (const c of file.stream) size += (c as Buffer).length;
      return { name: file.name, mimeType: file.mimeType, handle: 'h1', size };
    },
    async stream(_r, scope) {
      scopes.push(scope);
      return Readable.from(Buffer.from('hello'));
    },
    async info(_r, scope) {
      scopes.push(scope);
      return { size: 5, mimeType: 'text/plain' };
    },
    async delete() {
      /* unused here */
    },
  };
  return { adapter, scopes };
}

describe('the delete contract', () => {
  // Two callers rely on the scope being optional: multer reclaiming an orphaned
  // part, and the engine discarding a delivery. An adapter that demands one
  // anyway turns both into silent leaks — which shipped once.
  it('an adapter must accept a delete with no scope', () => {
    const adapter: StorageAdapter = {
      async put(_s, f) { return { name: f.name, mimeType: f.mimeType, handle: 'h', size: 0 }; },
      async stream() { return Readable.from(Buffer.from('')); },
      async info() { return null; },
      async delete(_ref, scope) {
        expect(scope).toBeUndefined();
      },
    };
    return adapter.delete(ref);
  });
});

describe('ctx.files', () => {
  const scope = { workspaceId: 'ws_1' } as never;

  it('binds the run scope once, so a step never names a tenant', async () => {
    const { adapter, scopes } = spyAdapter();
    const files = createFileAccess(adapter, scope);

    await files.put({ name: 'a.txt', mimeType: 'text/plain', stream: Readable.from('hi') });
    await files.info(ref);
    await files.stream(ref);

    // Every call reached the adapter with this run's scope, and no call site
    // had the chance to pass a different one.
    expect(scopes).toEqual([scope, scope, scope]);
  });

  it('reports what the host can do, for the steps that degrade', () => {
    expect(createFileAccess(spyAdapter().adapter, scope).available).toBe(true);
    expect(createFileAccess(undefined, scope).available).toBe(false);
  });

  it('explains itself when the host stores nothing', async () => {
    const files = createFileAccess(undefined, scope);
    await expect(files.stream(ref)).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(files.buffer(ref)).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(files.info(ref)).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(
      files.put({ name: 'a', mimeType: 'text/plain', stream: Readable.from('x') }),
    ).rejects.toThrow(/no StorageAdapter configured/);
  });

  it('buffers what fits', async () => {
    const files = createFileAccess(spyAdapter().adapter, scope);
    expect(new TextDecoder().decode(await files.buffer(ref))).toBe('hello');
  });

  it('refuses what does not', async () => {
    const files = createFileAccess(spyAdapter().adapter, scope);
    await expect(files.buffer(ref, { maxBytes: 2 })).rejects.toBeInstanceOf(AttachmentTooLargeError);
  });
});
