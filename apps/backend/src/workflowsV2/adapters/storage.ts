/**
 * `StorageAdapter` for `@xyne/workflow-sdk`, over the app's configured object store
 * (`@xyne/storage` — GCS, S3 or Azure Blob by `STORAGE_PROVIDER`).
 *
 * The framework never opens `Attachment.data`; it is an opaque host reference carried
 * through workflow context and step config. Here it is the object key.
 *
 * What flows through this adapter: trigger uploads (`POST /uploads`), attachments on a
 * resume payload (a reviewer approving with a file), and attachments in a rerun's config
 * overrides.
 */
import { randomUUID } from 'crypto';
import type { Readable } from 'node:stream';
import type { StorageAdapter, StorageFile, StorageInfo, StorageScope } from '@xyne/workflow-sdk';
import type { Attachment } from '@xyne/workflow-sdk/common';
import { sanitizeFilename } from '@xyne/storage';
import { getStorageService } from '@/services/storage';
import { logger } from '@/utils/logger';

/**
 * Every key this adapter writes starts here. `read`/`delete` refuse anything outside it,
 * which keeps a hand-crafted reference from reaching the rest of the bucket — ticket
 * attachments, recordings, avatars.
 */
const KEY_PREFIX = 'workflows/attachments';

/** One chunk in flight per upload. A multiple of 256 KiB, as GCS requires. */
const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

/**
 * Validate an incoming reference before it reaches the object store.
 *
 * `ref.data` is attacker-influenced: it arrives from step config, which a workflow author
 * writes, and from resume payloads. So this is a real boundary rather than a formality.
 *
 * Two rules, and both matter:
 *  - it must sit under {@link KEY_PREFIX}, so a reference cannot address another
 *    subsystem's objects;
 *  - no `..` segment, so it cannot climb out of the prefix. Object stores treat keys as
 *    opaque strings and will happily resolve `a/../../b` server-side on some backends.
 */
const parseOwnedKey = (raw: string, op: string): { key: string; workspaceId: string } => {
  const key = raw.replace(/^\/+/, '');
  const segments = key.split('/');
  const workspaceId = segments[2];
  if (
    !key.startsWith(`${KEY_PREFIX}/`) ||
    segments.includes('..') ||
    segments.length < 4 ||
    !workspaceId
  ) {
    throw new Error(
      `workflows storage: ${op} refused a reference outside the workflow attachment ` +
        `prefix: ${JSON.stringify(raw)}`,
    );
  }
  return { key, workspaceId };
};

const workspaceOf = (scope: StorageScope | undefined): string | undefined =>
  (scope as { workspaceId?: string } | undefined)?.workspaceId;

const assertAccessible = (ref: Attachment, scope: StorageScope | undefined, op: string): string => {
  const { key, workspaceId } = parseOwnedKey(ref.handle, op);
  const caller = workspaceOf(scope);
  if (!caller) {
    throw new Error(
      `workflows storage: ${op} has no scope — pass the caller (routes) or ` +
        '`ctx.runtime.attributes` (steps)',
    );
  }
  if (caller !== workspaceId) {
    throw new Error(
      `workflows storage: ${op} refused a reference owned by another workspace`,
    );
  }
  return key;
};

export class WorkflowStorageAdapter implements StorageAdapter {
  /**
   * Stream a file into the bucket and return its reference.
   *
   * The key carries the workspace so attachments are greppable and
   * lifecycle-manageable per tenant, and a random segment so keys are
   * unguessable.
   */
  async put(scope: StorageScope, file: StorageFile): Promise<Attachment> {
    const workspaceId = workspaceOf(scope);
    if (!workspaceId) {
      throw new Error(
        'workflows storage: put has no scope — pass the caller (routes) or ' +
          '`ctx.runtime.attributes` (steps)',
      );
    }
    const safeName = sanitizeFilename(file.name);
    const path = `${KEY_PREFIX}/${workspaceId}/${randomUUID()}-${safeName}`;

    const result = await getStorageService().uploadStreamToPath(file.stream, {
      path,
      // `contentType` only — the store serves it back on download. Whose the
      // file is and what it was called are already in the key and in the
      // Attachment, and a third copy would be read by nobody.
      contentType: file.mimeType,
      // Bounded chunk: one in flight rather than a buffer sized to the upload.
      resumable: true,
      chunkSize: UPLOAD_CHUNK_BYTES,
    });

    logger.info(
      `[WORKFLOWS-STORAGE] streamed ${String(result.size)} bytes for workspace ${workspaceId}`,
    );

    return { name: file.name, mimeType: file.mimeType, handle: path, size: result.size };
  }

  /**
   * The object's bytes, to pipe. The scope is required, so a reference owned by
   * another workspace is refused outright rather than relying on an unguessable
   * key — which is all the `read` this replaces had.
   */
  async stream(ref: Attachment, scope: StorageScope): Promise<Readable> {
    const key = assertAccessible(ref, scope, 'stream');
    const body = await getStorageService().createReadStream(key);
    return body as Readable;
  }

  /** Size and type from object metadata — null when it is gone. */
  async info(ref: Attachment, scope: StorageScope): Promise<StorageInfo | null> {
    const key = assertAccessible(ref, scope, 'info');
    const head = await getStorageService().headObject(key);
    if (!head) return null;
    return {
      size: head.size ?? ref.size ?? 0,
      mimeType: head.contentType ?? ref.mimeType,
    };
  }

  /**
   * Remove the object.
   *
   * An absent scope means the system reclaiming its own write — a part orphaned
   * by a later failure, a delivery the engine declined — where there is no
   * caller to compare against. Structural validation still runs either way, so
   * it can never reach outside the attachment prefix; only the tenant
   * comparison is skipped. `stream` and `info` require a scope by signature.
   */
  async delete(ref: Attachment, scope?: StorageScope): Promise<void> {
    const key = scope
      ? assertAccessible(ref, scope, 'delete')
      : parseOwnedKey(ref.handle, 'delete').key;
    await getStorageService().deleteFile(key);
    logger.info(`[WORKFLOWS-STORAGE] deleted ${key}`);
  }
}

/** Shared by the runtime and the multipart middleware, so both write the same keys. */
export const workflowStorage = new WorkflowStorageAdapter();
