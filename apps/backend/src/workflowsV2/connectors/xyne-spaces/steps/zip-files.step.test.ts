import JSZip from 'jszip';
import type { StepExecutionContext, StorageAdapter } from '@xyne/workflow-sdk';
import type { Attachment } from '@xyne/workflow-sdk/common';
import {
  ZIP_MAX_FILES,
  ZIP_MAX_TOTAL_BYTES,
  ZipFilesStep,
  dedupeEntryNames,
  toArchiveName,
  toEntryName,
} from './zip-files.step';

const WS = 'ws_a';
const enc = (s: string) => new TextEncoder().encode(s);

/** In-memory adapter that mimics the real one's workspace check. */
function makeStorage(blobs: Record<string, Uint8Array>) {
  const stored: { name: string; mimeType: string; bytes: Uint8Array }[] = [];
  const storage: StorageAdapter = {
    async read(ref, scope) {
      const owner = ref.data.split('/')[2];
      if ((scope as { workspaceId?: string } | undefined)?.workspaceId !== owner) {
        throw new Error('refused a reference owned by another workspace');
      }
      const bytes = blobs[ref.data];
      if (!bytes) throw new Error('not found');
      return bytes;
    },
    async store(_scope, file) {
      stored.push(file);
      return {
        name: file.name,
        mimeType: file.mimeType,
        data: `workflows/attachments/${WS}/uuid-${file.name}`,
        size: file.bytes.byteLength,
      };
    },
  };
  return { storage, stored };
}

function makeCtx(storage?: StorageAdapter): StepExecutionContext {
  return {
    storage,
    runtime: { attributes: { workspaceId: WS } },
    log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  } as unknown as StepExecutionContext;
}

const ref = (name: string, key: string, size?: number): Attachment => ({
  name,
  mimeType: 'text/plain',
  data: `workflows/attachments/${key}`,
  ...(size !== undefined ? { size } : {}),
});

describe('ZipFilesStep', () => {
  const step = new ZipFilesStep();

  it('zips files into one stored archive with unique flat entry names', async () => {
    const { storage, stored } = makeStorage({
      [`workflows/attachments/${WS}/1-a.txt`]: enc('alpha'),
      [`workflows/attachments/${WS}/2-a.txt`]: enc('beta'),
      [`workflows/attachments/${WS}/3-x`]: enc('gamma'),
    });
    const out = await step.execute(
      {
        files: [
          ref('a.txt', `${WS}/1-a.txt`),
          ref('A.txt', `${WS}/2-a.txt`),
          ref('../../evil.sh', `${WS}/3-x`),
        ],
        archiveName: 'bundle',
      },
      makeCtx(storage),
    );

    expect(out.fileCount).toBe(3);
    expect(out.uncompressedBytes).toBe(14);
    expect(out.file.name).toBe('bundle.zip');
    expect(out.file.mimeType).toBe('application/zip');
    expect(stored).toHaveLength(1);

    const zip = await JSZip.loadAsync(stored[0].bytes);
    expect(Object.keys(zip.files).sort()).toEqual(['A (1).txt', 'a.txt', 'evil.sh']);
    expect(await zip.file('A (1).txt')!.async('string')).toBe('beta');
  });

  it('refuses a file owned by another workspace', async () => {
    const { storage, stored } = makeStorage({ 'workflows/attachments/ws_b/1-a.txt': enc('x') });
    await expect(
      step.execute({ files: [ref('a.txt', 'ws_b/1-a.txt')] }, makeCtx(storage)),
    ).rejects.toThrow(/could not read "a.txt".*another workspace/);
    expect(stored).toHaveLength(0);
  });

  it('rejects too many files and oversized input before storing', async () => {
    const { storage, stored } = makeStorage({});
    const many = Array.from({ length: ZIP_MAX_FILES + 1 }, (_, i) => ref(`${i}.txt`, `${WS}/${i}`));
    await expect(step.execute({ files: many }, makeCtx(storage))).rejects.toThrow(/at most/);
    await expect(
      step.execute(
        { files: [ref('big.bin', `${WS}/big`, ZIP_MAX_TOTAL_BYTES + 1)] },
        makeCtx(storage),
      ),
    ).rejects.toThrow(/25MB/);
    expect(stored).toHaveLength(0);
  });

  it('enforces the cap on actual bytes when sizes are not declared', async () => {
    const half = new Uint8Array(ZIP_MAX_TOTAL_BYTES / 2 + 1);
    const { storage, stored } = makeStorage({
      [`workflows/attachments/${WS}/1`]: half,
      [`workflows/attachments/${WS}/2`]: half,
    });
    await expect(
      step.execute({ files: [ref('a', `${WS}/1`), ref('b', `${WS}/2`)] }, makeCtx(storage)),
    ).rejects.toThrow(/25MB/);
    expect(stored).toHaveLength(0);
  });

  it('fails clearly when storage is not configured or files is empty', async () => {
    await expect(step.execute({ files: [ref('a', `${WS}/1`)] }, makeCtx())).rejects.toThrow(
      /storage is not configured/,
    );
    const { storage } = makeStorage({});
    await expect(step.execute({ files: [] }, makeCtx(storage))).rejects.toThrow(/non-empty/);
  });

  it('marks attachment fields for the builder', () => {
    const out = step.resolveOutputJsonSchema();
    expect((out.properties as Record<string, { format?: string }>).file.format).toBe('attachment');
  });
});

describe('name helpers', () => {
  it('flattens and cleans entry names', () => {
    expect(toEntryName('dir/sub\\report.pdf')).toBe('report.pdf');
    expect(toEntryName('..')).toBe('file');
    expect(toEntryName('.env')).toBe('env');
    expect(toEntryName('a\u0000b.txt')).toBe('ab.txt');
  });
  it('dedupes case-insensitively', () => {
    expect(dedupeEntryNames(['x.txt', 'X.txt', 'x.txt'])).toEqual(['x.txt', 'X (1).txt', 'x (2).txt']);
  });
  it('builds archive names', () => {
    expect(toArchiveName(undefined)).toBe('archive.zip');
    expect(toArchiveName('Report.ZIP')).toBe('Report.ZIP');
    expect(toArchiveName('q3')).toBe('q3.zip');
  });
});
