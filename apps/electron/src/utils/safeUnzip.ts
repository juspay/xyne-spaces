import { createWriteStream, mkdirSync } from 'fs';
import { dirname } from 'path';
import { pipeline } from 'stream/promises';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import { safeChildPath } from './safePath';

const MAX_UNZIPPED_BYTES = 1024 * 1024 * 1024; // 1 GB
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

function isSymlink(entry: Entry): boolean {
  return ((entry.externalFileAttributes >>> 16) & S_IFMT) === S_IFLNK;
}

function openZip(zipPath: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipFile) => {
      if (err || !zipFile) reject(err ?? new Error(`Unable to open zip: ${zipPath}`));
      else resolve(zipFile);
    });
  });
}

function openEntryStream(zipFile: ZipFile, entry: Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (err, stream) => {
      if (err || !stream) reject(err ?? new Error(`Unable to read zip entry: ${entry.fileName}`));
      else resolve(stream);
    });
  });
}

/** Extracts a zip into destDir, rejecting symlinks, paths outside destDir and archives over 1 GB. */
export async function safeUnzip(zipPath: string, destDir: string): Promise<void> {
  const zipFile = await openZip(zipPath);
  let totalBytes = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      const fail = (err: unknown) => reject(err instanceof Error ? err : new Error(String(err)));

      zipFile.on('error', fail);
      zipFile.on('end', () => resolve());
      zipFile.on('entry', (entry: Entry) => {
        (async () => {
          if (isSymlink(entry)) {
            throw new Error(`Refusing symlink entry in zip: ${entry.fileName}`);
          }
          totalBytes += entry.uncompressedSize;
          if (totalBytes > MAX_UNZIPPED_BYTES) {
            throw new Error('Refusing zip: unpacked size exceeds 1 GB');
          }
          const target = safeChildPath(destDir, entry.fileName);
          if (!target) {
            throw new Error(`Refusing zip entry outside the destination: ${entry.fileName}`);
          }
          if (entry.fileName.endsWith('/')) {
            mkdirSync(target, { recursive: true });
          } else {
            mkdirSync(dirname(target), { recursive: true });
            await pipeline(await openEntryStream(zipFile, entry), createWriteStream(target));
          }
          zipFile.readEntry();
        })().catch(fail);
      });

      zipFile.readEntry();
    });
  } finally {
    zipFile.close();
  }
}
