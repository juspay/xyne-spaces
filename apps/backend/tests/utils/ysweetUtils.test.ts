import { syncToYSweet } from '../../src/utils/ysweetUtils';
import type { BlockNoteBlock } from '@/types/blockNoteTypes';

jest.mock('yjs', () => ({
  Doc: class {
    transact(callback: () => void) {
      callback();
    }

    getXmlFragment() {
      return { delete: jest.fn(), length: 0 };
    }
  },
  applyUpdate: jest.fn(),
  encodeStateAsUpdate: jest.fn(() => new Uint8Array([1])),
}));

jest.mock('@blocknote/core', () => ({
  BlockNoteSchema: { create: jest.fn(() => ({})) },
  createStyleSpec: jest.fn(() => ({})),
  defaultBlockSpecs: {},
  defaultInlineContentSpecs: {},
  defaultStyleSpecs: {},
}));

jest.mock('@blocknote/server-util', () => ({
  ServerBlockNoteEditor: {
    create: jest.fn(() => ({ blocksToYXmlFragment: jest.fn() })),
  },
}));

jest.mock('blocknote-layout-server-utils', () => ({ mentionServerSpec: {} }), { virtual: true });
jest.mock('@/utils/canvasCitationSpec', () => ({ citationServerSpec: {} }));

jest.mock('@/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const content: BlockNoteBlock[] = [
  {
    id: 'block-1',
    type: 'paragraph',
    content: [{ type: 'text', text: 'New SDLC artifact', styles: {} }],
    children: [],
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Y-Sweet content synchronization', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates a missing collaboration document before synchronizing a new artifact', async () => {
    const docId = 'new-sdlc-artifact';
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(
        jsonResponse({
          docId,
          token: 'write-token',
          baseUrl: `http://ysweet:8080/doc/${docId}`,
          url: `ws://ysweet:8080/doc/${docId}`,
        })
      )
      .mockResolvedValueOnce(new Response(new Uint8Array()))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(syncToYSweet(docId, content)).resolves.toBe(true);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringContaining(`/doc/${docId}/auth`),
      expect.stringContaining('/doc/new'),
      expect.stringContaining(`/doc/${docId}/auth`),
      expect.stringContaining(`/doc/${docId}/as-update`),
      expect.stringContaining(`/doc/${docId}/update`),
    ]);
  });

  it('synchronizes an existing collaboration document without creating it again', async () => {
    const docId = 'existing-sdlc-artifact';
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse({
          docId,
          token: 'write-token',
          baseUrl: `http://ysweet:8080/doc/${docId}`,
          url: `ws://ysweet:8080/doc/${docId}`,
        })
      )
      .mockResolvedValueOnce(new Response(new Uint8Array()))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(syncToYSweet(docId, content)).resolves.toBe(true);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringContaining(`/doc/${docId}/auth`),
      expect.stringContaining(`/doc/${docId}/as-update`),
      expect.stringContaining(`/doc/${docId}/update`),
    ]);
  });

  it('does not create a collaboration document after a non-404 authentication failure', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 503 }));

    await expect(syncToYSweet('unavailable-sdlc-artifact', content)).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
