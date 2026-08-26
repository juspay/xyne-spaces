// Workflow-sdk attachment storage over the host's GCS/S3 storage service.
// Objects live under the `workflow-sdk/<workspaceId>/` prefix; the Attachment
// `data` field is the object path. read()/delete() re-validate the prefix
// because ref.data flows through step config (attacker-influenced) — without
// the check a workflow could address arbitrary objects in the bucket.

import { randomUUID } from 'crypto';
import type { StorageAdapter, StorageFile, StorageScope } from '@xyne/workflow-sdk';
import type { Attachment } from '@xyne/workflow-sdk/common';
import { getStorageService } from '@/services/storage/storageServiceFactory';

const STORAGE_PREFIX = 'workflow-sdk/';

const assertWithinPrefix = (refData: string): string => {
  if (
    !refData.startsWith(STORAGE_PREFIX) ||
    refData.split('/').some(seg => seg === '..' || seg === '')
  ) {
    throw new Error(
      `XyneStorageAdapter: attachment ref escapes storage prefix: ${JSON.stringify(refData)}`,
    );
  }
  return refData;
};

export class XyneStorageAdapter implements StorageAdapter {
  async store(scope: StorageScope, file: StorageFile): Promise<Attachment> {
    const workspaceId = (scope as { workspaceId?: string }).workspaceId ?? 'default';
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const objectPath = `${STORAGE_PREFIX}${workspaceId}/${randomUUID()}-${safeName}`;
    await getStorageService().uploadFileV2(Buffer.from(file.bytes), {
      path: objectPath,
      contentType: file.mimeType,
    });
    return {
      name: file.name,
      mimeType: file.mimeType,
      data: objectPath,
      size: file.bytes.byteLength,
    };
  }

  async read(ref: Attachment): Promise<Uint8Array> {
    const objectPath = assertWithinPrefix(ref.data);
    const buf = await getStorageService().getFileBuffer(objectPath);
    return new Uint8Array(buf);
  }

  async delete(ref: Attachment): Promise<void> {
    const objectPath = assertWithinPrefix(ref.data);
    try {
      await getStorageService().deleteFile(objectPath);
    } catch (err) {
      // Deleting an already-gone attachment is not an error.
      const message = err instanceof Error ? err.message : String(err);
      if (!/not.?found|no such object|404/i.test(message)) throw err;
    }
  }
}
