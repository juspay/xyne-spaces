import JSZip from 'jszip';
import { z } from 'zod';
import {
  ATTACHMENT_JSON_SCHEMA,
  AttachmentSchema,
  BaseActionStep,
  markAttachmentFields,
  variableRef,
} from '@xyne/workflow-sdk';
import type { StepExecutionContext } from '@xyne/workflow-sdk';
import type { Attachment } from '@xyne/workflow-sdk/common';

/**
 * ZIP_FILES — bundle files produced earlier in a run into one `.zip` attachment.
 *
 * Inputs are workflow attachment references (trigger uploads, an agent's generated
 * files, an earlier step's output). Bytes are read through `ctx.storage` with the
 * run's own attributes, so the storage adapter's workspace check applies to every
 * entry — a reference owned by another workspace fails the step rather than being
 * zipped. The archive is written back through the same adapter, so the output is an
 * ordinary attachment any later step (Send message, HTTP request, Run agent) can bind.
 *
 * The whole archive is built in memory because `StorageAdapter.store` takes bytes,
 * which is why the input caps below exist.
 */

export const ZIP_MAX_FILES = 50;
export const ZIP_MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const DEFAULT_ARCHIVE_NAME = 'archive.zip';
const MAX_ENTRY_NAME_LENGTH = 200;

const ZipFilesConfigSchema = z.object({
  files: variableRef(z.array(AttachmentSchema).min(1).max(ZIP_MAX_FILES)),
  archiveName: variableRef(z.string().max(MAX_ENTRY_NAME_LENGTH)).optional(),
  compressionLevel: z.number().int().min(0).max(9).optional(),
});

type ZipFilesConfig = z.infer<typeof ZipFilesConfigSchema>;

const ZipFilesOutputSchema = z.object({
  file: AttachmentSchema,
  fileCount: z.number(),
  sizeBytes: z.number(),
  uncompressedBytes: z.number(),
});

interface ZipFilesOutput extends Record<string, unknown> {
  file: Attachment;
  fileCount: number;
  sizeBytes: number;
  uncompressedBytes: number;
}

/**
 * A safe, flat entry name. Drops any directory part (so an uploaded name like
 * `../../etc/passwd` cannot produce a zip-slip entry for whoever extracts it),
 * control characters, and leading dots.
 */
export function toEntryName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, MAX_ENTRY_NAME_LENGTH);
  return cleaned || 'file';
}

/** `report.pdf`, `report.pdf` → `report.pdf`, `report (1).pdf`. Case-insensitive. */
export function dedupeEntryNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let candidate = name;
    for (let n = 1; used.has(candidate.toLowerCase()); n += 1) {
      candidate = `${stem} (${n})${ext}`;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

export function toArchiveName(raw: string | undefined): string {
  const name = toEntryName(raw?.trim() || DEFAULT_ARCHIVE_NAME);
  return name.toLowerCase().endsWith('.zip') ? name : `${name}.zip`;
}

export class ZipFilesStep extends BaseActionStep<typeof ZipFilesConfigSchema, ZipFilesOutput> {
  readonly type = 'ZIP_FILES';
  readonly configSchema = ZipFilesConfigSchema;
  readonly outputSchema = ZipFilesOutputSchema;
  readonly name = 'Zip files';
  readonly description = `Bundle up to ${ZIP_MAX_FILES} files (25MB total) into a single .zip file.`;
  readonly category = 'files';
  readonly icon = 'archive';

  /** Render `files` as an attachment picker (variable-bound to attachment refs). */
  override decorateConfigSchema(jsonSchema: Record<string, unknown>): Record<string, unknown> {
    return markAttachmentFields(jsonSchema, ['files']);
  }

  /** Mark `file` as an attachment so the variable picker offers it to file inputs. */
  override resolveOutputJsonSchema(): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        file: ATTACHMENT_JSON_SCHEMA,
        fileCount: { type: 'number' },
        sizeBytes: { type: 'number' },
        uncompressedBytes: { type: 'number' },
      },
      required: ['file', 'fileCount', 'sizeBytes', 'uncompressedBytes'],
    };
  }

  async execute(config: ZipFilesConfig, ctx: StepExecutionContext): Promise<ZipFilesOutput> {
    const storage = ctx.storage;
    if (!storage) throw new Error(`[${this.type}] file storage is not configured`);

    // Variable-bound input is resolved before execute but not re-validated here,
    // so check shape and caps ourselves.
    const files = z.array(AttachmentSchema).safeParse(config.files);
    if (!files.success || files.data.length === 0) {
      throw new Error(`[${this.type}] "files" must be a non-empty list of files`);
    }
    if (files.data.length > ZIP_MAX_FILES) {
      throw new Error(
        `[${this.type}] ${files.data.length} files given; at most ${ZIP_MAX_FILES} can be zipped`,
      );
    }
    // Fail before downloading anything when the declared sizes already exceed the cap.
    const declared = files.data.reduce((sum, f) => sum + (f.size ?? 0), 0);
    if (declared > ZIP_MAX_TOTAL_BYTES) {
      throw new Error(`[${this.type}] files total ${declared} bytes; the limit is 25MB`);
    }

    const entryNames = dedupeEntryNames(files.data.map((f) => toEntryName(f.name)));
    const zip = new JSZip();
    let uncompressedBytes = 0;

    // Sequential on purpose: keeps peak memory to one download at a time on top of
    // the archive, and lets the size cap stop the loop early.
    for (const [index, ref] of files.data.entries()) {
      let bytes: Uint8Array;
      try {
        bytes = await storage.read(ref, ctx.runtime.attributes);
      } catch (error) {
        throw new Error(
          `[${this.type}] could not read "${ref.name}": ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      uncompressedBytes += bytes.byteLength;
      if (uncompressedBytes > ZIP_MAX_TOTAL_BYTES) {
        throw new Error(`[${this.type}] files exceed the 25MB total limit`);
      }
      zip.file(entryNames[index], bytes, { binary: true });
    }

    const level = config.compressionLevel ?? 6;
    const archive = await zip.generateAsync({
      type: 'uint8array',
      compression: level === 0 ? 'STORE' : 'DEFLATE',
      compressionOptions: { level },
    });

    const stored = await storage.store(ctx.runtime.attributes, {
      name: toArchiveName(config.archiveName),
      mimeType: 'application/zip',
      bytes: archive,
    });

    ctx.log.info(
      `[${this.type}] zipped ${files.data.length} files (${uncompressedBytes} → ${archive.byteLength} bytes)`,
    );

    return {
      file: stored,
      fileCount: files.data.length,
      sizeBytes: archive.byteLength,
      uncompressedBytes,
    };
  }
}
