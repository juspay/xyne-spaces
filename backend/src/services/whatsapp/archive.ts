import { createWriteStream } from 'fs';
import { mkdir, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, dirname, extname, join, resolve, sep } from 'path';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';
import unzipper from 'unzipper';

export interface ExtractedWhatsAppArchive {
  archiveName: string;
  extractionDir: string;
  chatFilePath: string;
  mediaFilesByBasename: Map<string, string[]>;
}

const normalizeKey = (value: string): string =>
  value
    .trim()
    .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
    .replace(/[.)\],;:!?]+$/g, '')
    .toLowerCase();

const MAX_ZIP_ENTRY_COUNT = 10000;
const MAX_TOTAL_EXTRACTED_BYTES = 2 * 1024 * 1024 * 1024;

export async function extractWhatsAppArchive(
  archivePath: string,
  originalArchiveName?: string | null,
): Promise<ExtractedWhatsAppArchive> {
  const extractionDir = await mkdtemp(join(tmpdir(), 'xyne-whatsapp-extract-'));
  const zip = await unzipper.Open.file(archivePath);
  const extractedFiles: string[] = [];
  const extractionRoot = resolve(extractionDir);
  const extractionRootPrefix = `${extractionRoot}${sep}`;
  let totalExtractedBytes = 0;

  try {
    if (zip.files.length > MAX_ZIP_ENTRY_COUNT) {
      throw new Error(`Zip contains too many entries (${zip.files.length}). Maximum allowed is ${MAX_ZIP_ENTRY_COUNT}`);
    }

    for (const entry of zip.files) {
      const entryPath = entry.path.replace(/\\/g, '/');
      const destination = resolve(extractionDir, entryPath);
      if (destination !== extractionRoot && !destination.startsWith(extractionRootPrefix)) {
        throw new Error(`Invalid zip entry path: ${entry.path}`);
      }

      if (entry.type === 'Directory') {
        await mkdir(destination, { recursive: true });
        continue;
      }

      await mkdir(dirname(destination), { recursive: true });
      const readStream = entry.stream();
      const sizeGuard = new Transform({
        transform(chunk, _encoding, callback) {
          totalExtractedBytes += chunk.length;
          if (totalExtractedBytes > MAX_TOTAL_EXTRACTED_BYTES) {
            callback(new Error(`Extracted archive exceeds ${MAX_TOTAL_EXTRACTED_BYTES} bytes`));
            return;
          }
          callback(null, chunk);
        },
      });
      const writeStream = createWriteStream(destination);
      await pipeline(readStream, sizeGuard, writeStream);
      extractedFiles.push(destination);
    }

    const textFiles = extractedFiles
      .filter(filePath => extname(filePath).toLowerCase() === '.txt')
      .sort((left, right) => {
        const leftBase = basename(left).toLowerCase();
        const rightBase = basename(right).toLowerCase();
        if (leftBase === '_chat.txt') return -1;
        if (rightBase === '_chat.txt') return 1;
        if (leftBase.includes('chat')) return -1;
        if (rightBase.includes('chat')) return 1;
        return left.length - right.length;
      });

    if (textFiles.length === 0) {
      throw new Error('No WhatsApp chat .txt file found in archive');
    }

    const mediaFilesByBasename = new Map<string, string[]>();
    for (const filePath of extractedFiles) {
      if (filePath === textFiles[0]) continue;
      const keys = new Set<string>();
      const baseName = basename(filePath);
      const normalizedBaseName = normalizeKey(baseName);
      if (normalizedBaseName) keys.add(normalizedBaseName);

      const extensionIndex = normalizedBaseName.lastIndexOf('.');
      if (extensionIndex > 0) {
        keys.add(normalizedBaseName.slice(0, extensionIndex));
      }

      for (const key of keys) {
        const existing = mediaFilesByBasename.get(key) || [];
        existing.push(filePath);
        mediaFilesByBasename.set(key, existing);
      }
    }

    return {
      archiveName: basename(
        originalArchiveName && originalArchiveName.trim() ? originalArchiveName : archivePath,
        extname(originalArchiveName && originalArchiveName.trim() ? originalArchiveName : archivePath),
      ),
      extractionDir,
      chatFilePath: textFiles[0],
      mediaFilesByBasename,
    };
  } catch (error) {
    await cleanupWhatsAppExtraction(extractionDir);
    throw error;
  }
}

export async function cleanupWhatsAppExtraction(extractionDir: string): Promise<void> {
  await rm(extractionDir, { recursive: true, force: true });
}
