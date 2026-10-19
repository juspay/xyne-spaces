/**
 * The real disk-cache helper over an in-memory file system and a mocked native
 * download, so what is asserted is which downloads happen and what is left on disk.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Directory, File } from 'expo-file-system';

import {
  cacheMtlsRemoteFile,
  cacheMtlsRemoteFileByType,
  DownloadFailedError,
  isAttachmentNotReadyError,
  isPermanentDownloadMiss,
  isThumbnailUnavailableError,
} from '@/src/utils/mtlsDiskCache';
import { mtlsDownloadToFile, type MtlsDownloadResult } from '@/src/utils/mtlsHttpClient';

/** uri -> size in bytes. A file exists when it has an entry. */
const mockDisk = new Map<string, number>();

jest.mock('expo-file-system', () => {
  class MockDirectory {
    uri: string;
    constructor(...parts: string[]) {
      this.uri = parts.join('/');
    }
    create(): void {}
  }

  class MockFile {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map(part => (typeof part === 'string' ? part : part.uri)).join('/');
    }
    get exists(): boolean {
      return mockDisk.has(this.uri);
    }
    get size(): number {
      return mockDisk.get(this.uri) ?? 0;
    }
    get parentDirectory(): MockDirectory {
      return new MockDirectory(this.uri.slice(0, this.uri.lastIndexOf('/')));
    }
    delete(): void {
      mockDisk.delete(this.uri);
    }
    moveSync(destination: { uri: string }): void {
      mockDisk.set(destination.uri, this.size);
      mockDisk.delete(this.uri);
      this.uri = destination.uri;
    }
  }

  return { Directory: MockDirectory, File: MockFile };
});

jest.mock('@/src/utils/mtlsHttpClient', () => ({ mtlsDownloadToFile: jest.fn() }));

jest.mock('@/src/services/authToken', () => ({
  buildAuthenticatedHeaders: async (): Promise<Record<string, string>> => ({ Cookie: 'session' }),
}));

const mockedDownload = mtlsDownloadToFile as jest.MockedFunction<typeof mtlsDownloadToFile>;

const URL = 'https://api.example.com/attachments/a1/download';
const PATH = 'file:///cache/images/a1.jpg';

function result(overrides: Partial<MtlsDownloadResult> = {}): MtlsDownloadResult {
  return {
    statusCode: 200,
    ok: true,
    uri: null,
    size: 1024,
    mimeType: 'image/jpeg',
    errorBody: '',
    headers: {},
    ...overrides,
  };
}

/** A download that writes the file, as the native side does once it has finished. */
function downloadSucceeds(overrides: Partial<MtlsDownloadResult> = {}): void {
  mockedDownload.mockImplementation(async (_url, destination) => {
    mockDisk.set(destination, 1024);
    return result({ uri: destination, ...overrides });
  });
}

function downloadFails(statusCode: number, errorBody = ''): void {
  mockedDownload.mockResolvedValue(result({ statusCode, ok: false, errorBody }));
}

beforeEach(() => {
  mockDisk.clear();
  mockedDownload.mockReset();
});

describe('cacheMtlsRemoteFile', () => {
  it('returns a cached file without downloading', async () => {
    mockDisk.set(PATH, 2048);

    await expect(cacheMtlsRemoteFile({ url: URL, localPath: PATH })).resolves.toBe(PATH);
    expect(mockedDownload).not.toHaveBeenCalled();
  });

  it('downloads when nothing is cached', async () => {
    downloadSucceeds();

    await expect(cacheMtlsRemoteFile({ url: URL, localPath: PATH })).resolves.toBe(PATH);
    expect(mockedDownload).toHaveBeenCalledTimes(1);
  });

  it('downloads again over an empty file', async () => {
    mockDisk.set(PATH, 0);
    downloadSucceeds();

    await cacheMtlsRemoteFile({ url: URL, localPath: PATH });

    expect(mockedDownload).toHaveBeenCalledTimes(1);
  });

  it('accepts a path without the file:// scheme', async () => {
    downloadSucceeds();

    await expect(
      cacheMtlsRemoteFile({ url: URL, localPath: '/cache/images/a1.jpg' }),
    ).resolves.toBe(PATH);
  });

  it('sends auth headers and allows the JS fallback for builds without native streaming', async () => {
    downloadSucceeds();

    await cacheMtlsRemoteFile({ url: URL, localPath: PATH });

    const [, , options] = mockedDownload.mock.calls[0] ?? [];
    expect(options?.headers).toEqual({ Cookie: 'session' });
    expect(options?.maxJsFallbackBytes).toBeGreaterThan(0);
  });

  it('shares one download between callers wanting the same file', async () => {
    downloadSucceeds();

    const [first, second] = await Promise.all([
      cacheMtlsRemoteFile({ url: URL, localPath: PATH }),
      cacheMtlsRemoteFile({ url: URL, localPath: PATH }),
    ]);

    expect(first).toBe(second);
    expect(mockedDownload).toHaveBeenCalledTimes(1);
  });

  it('downloads again after a failure', async () => {
    downloadFails(500);
    await expect(cacheMtlsRemoteFile({ url: URL, localPath: PATH })).rejects.toThrow();

    downloadSucceeds();
    await expect(cacheMtlsRemoteFile({ url: URL, localPath: PATH })).resolves.toBe(PATH);
  });

  describe('refresh', () => {
    it('downloads even though a file is cached', async () => {
      mockDisk.set(PATH, 2048);
      downloadSucceeds();

      await cacheMtlsRemoteFile({ url: URL, localPath: PATH, refresh: true });

      expect(mockedDownload).toHaveBeenCalledTimes(1);
    });

    it('leaves the cached file in place while the download runs', async () => {
      mockDisk.set(PATH, 2048);
      let cachedDuringDownload = false;
      mockedDownload.mockImplementation(async () => {
        cachedDuringDownload = mockDisk.has(PATH);
        return result({ uri: PATH });
      });

      await cacheMtlsRemoteFile({ url: URL, localPath: PATH, refresh: true });

      expect(cachedDuringDownload).toBe(true);
    });

    it('keeps the cached file when the download fails', async () => {
      mockDisk.set(PATH, 2048);
      downloadFails(503);

      await expect(
        cacheMtlsRemoteFile({ url: URL, localPath: PATH, refresh: true }),
      ).rejects.toThrow();

      expect(mockDisk.get(PATH)).toBe(2048);
    });
  });

  describe('failures', () => {
    it('reports an upload still in progress as retryable', async () => {
      downloadFails(404, '{"error":"Attachment not yet uploaded"}');

      const error = await cacheMtlsRemoteFile({ url: URL, localPath: PATH }).catch(e => e);

      expect(isAttachmentNotReadyError(error)).toBe(true);
      expect(isPermanentDownloadMiss(error)).toBe(false);
    });

    it('reports a missing thumbnail as permanent', async () => {
      downloadFails(404, '{"error":"Thumbnail not available for this attachment"}');

      const error = await cacheMtlsRemoteFile({ url: URL, localPath: PATH }).catch(e => e);

      expect(isThumbnailUnavailableError(error)).toBe(true);
      expect(isPermanentDownloadMiss(error)).toBe(true);
    });

    it('reports a missing attachment as permanent', async () => {
      downloadFails(404, '{"error":"Attachment not found"}');

      const error = await cacheMtlsRemoteFile({ url: URL, localPath: PATH }).catch(e => e);

      expect(error).toBeInstanceOf(DownloadFailedError);
      expect(isPermanentDownloadMiss(error)).toBe(true);
    });

    it('does not treat a server error as permanent', async () => {
      downloadFails(503);

      const error = await cacheMtlsRemoteFile({ url: URL, localPath: PATH }).catch(e => e);

      expect((error as DownloadFailedError).statusCode).toBe(503);
      expect(isPermanentDownloadMiss(error)).toBe(false);
    });

    it('does not treat a lost connection as permanent', async () => {
      mockedDownload.mockRejectedValue(new Error('Network request failed'));

      const error = await cacheMtlsRemoteFile({ url: URL, localPath: PATH }).catch(e => e);

      expect(isPermanentDownloadMiss(error)).toBe(false);
    });
  });
});

describe('cacheMtlsRemoteFileByType', () => {
  const directory = new Directory('file:///cache/emojis');
  const options = {
    url: 'https://api.example.com/emojis/e1/stream',
    directory,
    baseName: 'e1',
    extensionFor: (mimeType: string | null): string => (mimeType === 'image/gif' ? 'gif' : 'png'),
  };

  it('names the file after the type the server reports', async () => {
    downloadSucceeds({ mimeType: 'image/gif' });

    await expect(cacheMtlsRemoteFileByType(options)).resolves.toEqual({
      uri: 'file:///cache/emojis/e1.gif',
      extension: 'gif',
    });
  });

  it('leaves only the finished file behind', async () => {
    downloadSucceeds({ mimeType: 'image/gif' });

    await cacheMtlsRemoteFileByType(options);

    expect([...mockDisk.keys()]).toEqual(['file:///cache/emojis/e1.gif']);
  });

  it('replaces a file already at the final name', async () => {
    mockDisk.set('file:///cache/emojis/e1.gif', 1);
    downloadSucceeds({ mimeType: 'image/gif' });

    await cacheMtlsRemoteFileByType(options);

    expect(mockDisk.get('file:///cache/emojis/e1.gif')).toBe(1024);
  });

  it('does not download straight into a name a reader could pick up', async () => {
    downloadSucceeds();

    await cacheMtlsRemoteFileByType(options);

    const [, destination] = mockedDownload.mock.calls[0] ?? [];
    expect(new File(destination as string).uri).not.toMatch(/e1\.(png|gif|jpg|webp)$/);
  });

  it('cleans up after a failed download', async () => {
    mockedDownload.mockImplementation(async (_url, destination) => {
      mockDisk.set(destination, 12);
      return result({ statusCode: 500, ok: false });
    });

    await expect(cacheMtlsRemoteFileByType(options)).rejects.toBeInstanceOf(DownloadFailedError);

    expect(mockDisk.size).toBe(0);
  });
});
