/**
 * `StorageAdapter` for `@xyne/workflow-sdk`, over the app's configured object store
 * (`@xyne/storage` — GCS or S3 by `STORAGE_PROVIDER`).
 *
 * The framework never opens `Attachment.data`; it is an opaque host reference carried
 * through workflow context and step config. Here it is the object key.
 *
 * What flows through this adapter: trigger uploads (`POST /uploads`), attachments on a
 * resume payload (a reviewer approving with a file), and attachments in a rerun's config
 * overrides.
 */
import { randomUUID } from 'crypto';
import type { StorageAdapter, StorageFile, StorageScope } from '@xyne/workflow-sdk';
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
  const { key, workspaceId } = parseOwnedKey(ref.data, op);
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
   * Persist a file and return its reference.
   *
   * The key carries the workspace so attachments are greppable and lifecycle-manageable
   * per tenant, and a random segment so keys are unguessable — see the note on `read`
   * about why that is load-bearing rather than cosmetic.
   */
  async store(scope: StorageScope, file: StorageFile): Promise<Attachment> {
    const workspaceId = workspaceOf(scope);
    if (!workspaceId) {
      throw new Error(
        'workflows storage: store has no scope — pass the caller (routes) or ' +
          '`ctx.runtime.attributes` (steps)',
      );
    }
    const safeName = sanitizeFilename(file.name);
    const path = `${KEY_PREFIX}/${workspaceId}/${randomUUID()}-${safeName}`;

    await getStorageService().uploadFileV2(Buffer.from(file.bytes), {
      path,
      contentType: file.mimeType,
      metadata: { workspaceId, originalName: file.name },
    });

    logger.info(
      `[WORKFLOWS-STORAGE] stored ${String(file.bytes.byteLength)} bytes for workspace ${workspaceId}`,
    );

    return {
      name: file.name,
      mimeType: file.mimeType,
      data: path,
      size: file.bytes.byteLength,
    };
  }

  /**
   * Resolve a reference back to bytes.
   *
   * NOTE — the contract gives `read` no scope, so this cannot verify the reference belongs
   * to the *calling* workspace, only that it is a workflow attachment. A step that
   * fabricated a reference to another tenant's key would be served it.
   *
   * What stands between that and a leak is the random segment in every key: references
   * are only obtainable from workflow context, which the framework populates, and a key is
   * not derivable from a workspace id. That is defence by unguessability rather than by
   * authorization, which is worth knowing before this is relied on for anything sensitive.
   * Closing it properly means either a scope on the contract or a signed reference.
   */
  async read(ref: Attachment, scope?: StorageScope): Promise<Uint8Array> {
    const key = assertAccessible(ref, scope, 'read');
    const buffer = await getStorageService().getFileBuffer(key);
    return new Uint8Array(buffer);
  }

  async delete(ref: Attachment, scope?: StorageScope): Promise<void> {
    const key = assertAccessible(ref, scope, 'delete');
    await getStorageService().deleteFile(key);
    logger.info(`[WORKFLOWS-STORAGE] deleted ${key}`);
  }
}
