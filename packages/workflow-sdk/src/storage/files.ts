/**
 * `ctx.files` — a step's whole interface to the files its run carries.
 *
 * Built by the engine from the host's {@link StorageAdapter}, with the run's
 * scope bound in: a step only ever acts as its own tenant, so there is nowhere
 * to pass a different one. `buffer`'s ceiling lives here rather than on the
 * adapter because it is engine policy, not host mechanism.
 */

import type { Attachment } from '../common/attachment.js';
import type { StorageAdapter, StorageFile, StorageInfo, StorageScope } from './types.js';

/** How much a step may pull into memory when a boundary cannot take a stream. */
export const DEFAULT_BUFFER_LIMIT_BYTES = 8 * 1024 * 1024;

export class AttachmentTooLargeError extends Error {
  constructor(
    readonly attachment: Attachment,
    readonly size: number,
    readonly limit: number,
  ) {
    super(
      `"${attachment.name}" is ${String(size)} bytes, over the ${String(limit)}-byte limit for `
      + 'reading an attachment into memory. Stream it instead (ctx.files.stream), or raise '
      + 'maxBytes for this call if the step genuinely needs it all at once.',
    );
    this.name = 'AttachmentTooLargeError';
  }
}

/** Thrown when a step reaches for a file and the host configured no storage. */
export class StorageUnavailableError extends Error {
  constructor(verb: string) {
    super(
      `Cannot ${verb} a file: this host has no StorageAdapter configured, so attachments `
      + 'cannot be read or written. Check `ctx.files.available` first if the step should '
      + 'carry on without them.',
    );
    this.name = 'StorageUnavailableError';
  }
}

/** What a step is handed as `ctx.files`. */
export interface FileAccess {
  /** Whether this host stores files at all — for steps that degrade rather than fail. */
  readonly available: boolean;
  /** Stream a new file in, under this run's scope. */
  put(file: StorageFile): Promise<Attachment>;
  /** Size and type, without transferring anything. Null when it is gone. */
  info(ref: Attachment): Promise<StorageInfo | null>;
  /** The bytes, to pipe. */
  stream(ref: Attachment): Promise<NodeJS.ReadableStream>;
  /** The bytes, in memory, refused above `maxBytes`. */
  buffer(ref: Attachment, opts?: { maxBytes?: number }): Promise<Uint8Array>;
}

export function createFileAccess(
  storage: StorageAdapter | undefined,
  scope: StorageScope,
): FileAccess {
  const need = (verb: string): StorageAdapter => {
    if (!storage) throw new StorageUnavailableError(verb);
    return storage;
  };

  // All async: a signature promising a Promise must not throw synchronously.
  return {
    available: storage !== undefined,

    async put(file) {
      return need('write').put(scope, file);
    },

    async info(ref) {
      return need('inspect').info(ref, scope);
    },

    async stream(ref) {
      return need('read').stream(ref, scope);
    },

    async buffer(ref, opts) {
      const adapter = need('read');
      const limit = opts?.maxBytes ?? DEFAULT_BUFFER_LIMIT_BYTES;

      // Ask before fetching: an oversized attachment costs nothing to refuse,
      // where reading until the limit trips would cost the limit itself.
      const known = await adapter.info(ref, scope);
      if (known && known.size > limit) {
        throw new AttachmentTooLargeError(ref, known.size, limit);
      }

      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of await adapter.stream(ref, scope)) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string | Uint8Array);
        total += buf.byteLength;
        // An adapter that cannot answer `info` still cannot overrun the limit.
        if (total > limit) throw new AttachmentTooLargeError(ref, total, limit);
        chunks.push(buf);
      }
      return new Uint8Array(Buffer.concat(chunks));
    },
  };
}
