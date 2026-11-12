import { createWriteStream, mkdirSync } from 'fs';
import { dirname } from 'path';
import { pipeline } from 'stream/promises';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import { safeChildPath } from './safePath';

// Unix file-type bits live in the high 16 bits of a zip entry's external attributes.
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

/** Default cap on the total unpacked size, so a zip bomb cannot fill the disk. */
export const DEFAULT_MAX_UNZIPPED_BYTES = 1024 * 1024 * 1024; // 1 GB

export interface SafeUnzipOptions {
  /** Refuse the archive once its entries add up to more than this many bytes. */
  maxTotalBytes?: number;
}

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

/**
 * Extracts `zipPath` into `destDir`, refusing any entry that could write outside it.
 *
 * Replaces extract-zip, which recreates symlink entries and then writes later
 * entries through them (GHSA-7pqw-9j4j-h8q3, GHSA-jmr9-qjv8-65gv). Here symlink
 * entries are rejected outright and every entry path must resolve inside
 * `destDir`, so the archive can only create regular files and directories under it.
 *
 * The total unpacked size is capped (1 GB by default). yauzl's validateEntrySizes,
 * on by default, fails any entry whose data is longer than its declared size, so
 * summing the declared sizes bounds what can actually be written.
 */
export async function safeUnzip(
  zipPath: string,
  destDir: string,
  { maxTotalBytes = DEFAULT_MAX_UNZIPPED_BYTES }: SafeUnzipOptions = {},
): Promise<void> {
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
          if (totalBytes > maxTotalBytes) {
            throw new Error(`Refusing zip: unpacked size exceeds the ${maxTotalBytes}-byte limit`);
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
