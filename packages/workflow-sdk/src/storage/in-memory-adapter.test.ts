import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { InMemoryStorageAdapter } from './in-memory-adapter.js';
import type { Attachment } from '../common/attachment.js';

const file = (name: string, mimeType: string, text: string) => ({
  name,
  mimeType,
  stream: Readable.from(Buffer.from(text)),
});

const textOf = async (s: NodeJS.ReadableStream): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const c of s) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as string));
  return Buffer.concat(chunks).toString('utf8');
};

const missing: Attachment = { name: 'x', mimeType: 'text/plain', handle: 'mem://nope' };

describe('InMemoryStorageAdapter', () => {
  it('drains the stream on put and hands one back on stream', async () => {
    const storage = new InMemoryStorageAdapter();
    const att = await storage.put({}, file('a.txt', 'text/plain', 'hello'));
    expect(att.name).toBe('a.txt');
    expect(att.mimeType).toBe('text/plain');
    expect(att.size).toBe(5);
    expect(att.handle.startsWith('mem://')).toBe(true);

    expect(await textOf(await storage.stream(att))).toBe('hello');
  });

  it('generates a unique handle per put', async () => {
    const storage = new InMemoryStorageAdapter();
    const a = await storage.put({}, file('a.txt', 'text/plain', '1'));
    const b = await storage.put({}, file('a.txt', 'text/plain', '2'));
    expect(a.handle).not.toBe(b.handle);
    expect(await textOf(await storage.stream(a))).toBe('1');
    expect(await textOf(await storage.stream(b))).toBe('2');
  });

  it('reports size and type without reading', async () => {
    const storage = new InMemoryStorageAdapter();
    const att = await storage.put({}, file('a.txt', 'text/plain', 'hello'));
    expect(await storage.info(att)).toEqual({ size: 5, mimeType: 'text/plain' });
  });

  it('answers null from info for a reference it does not hold', async () => {
    // Null rather than a throw: "gone" is an ordinary answer a caller acts on.
    expect(await new InMemoryStorageAdapter().info(missing)).toBeNull();
  });

  it('throws when streaming an unknown reference', async () => {
    await expect(new InMemoryStorageAdapter().stream(missing)).rejects.toThrow(/unknown reference/);
  });

  it('deletes a stored blob', async () => {
    const storage = new InMemoryStorageAdapter();
    const att = await storage.put({}, file('a.txt', 'text/plain', 'bye'));
    expect(storage.blobs.size).toBe(1);
    await storage.delete(att);
    expect(storage.blobs.size).toBe(0);
    await expect(storage.stream(att)).rejects.toThrow(/unknown reference/);
  });

  it('signUrl returns the opaque handle (test stub)', async () => {
    const storage = new InMemoryStorageAdapter();
    const att = await storage.put({}, file('a.txt', 'text/plain', 'x'));
    expect(await storage.signUrl(att, 60)).toBe(att.handle);
  });
});
