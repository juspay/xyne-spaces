import { resolveYSweetDocWorkspaceId } from '@/bypassAcl/ysweetServices';
import { config } from '@/config/env';
import { getEncryptionProvider, type YSweetDocKey } from '@/services/encryption';
import { redisService } from '@/services/redisService';
import { getStorageService } from '@/services/storage/storageServiceFactory';

/**
 * Keys of the canvas docs y-sweet encrypts itself (its Y_SWEET_STORE_ENCRYPTION), prepared
 * while ENABLE_STORAGE_ENCRYPTION is on. A doc's key is fetched when the doc is opened (every
 * opener, the browser and the backend's own reads and writes, gets its y-sweet token through
 * ysweetGetClientToken) and kept in Redis, sealed to y-sweet, while the doc is in use. y-sweet's storage-key request is answered only from there,
 * so a y-sweet asking for a doc nobody opened gets no key. An entry is useless without y-sweet's
 * private key.
 */

/** Under the one-hour life of the grant in an entry. */
const DOC_KEY_TTL_SECONDS = 50 * 60;
/** An open with less than this left fetches the key again. */
const DOC_KEY_REFRESH_BELOW_SECONDS = 25 * 60;

function docKeyRedisKey(docId: string): string {
  return `ysweet:doc-key:${docId}`;
}

/** The doc's object in y-sweet's store, as y-sweet names it. */
function docObjectKey(docId: string): string {
  const prefix = config.ysweet.storagePrefix.replace(/\/+$/, '');
  return `${prefix ? `${prefix}/` : ''}${docId}/data.ysweet`;
}

/**
 * Fetches the doc's key into Redis before y-sweet loads the doc. The doc's object says how the
 * encryption service finds the key: a CSEK doc by the digest GCS keeps of its key, any other doc
 * by its id (a new key for a doc that has none).
 */
export async function prepareYSweetDocKey(docId: string): Promise<void> {
  if (!config.enc.enableStorageEncryption) {
    return;
  }
  const redisKey = docKeyRedisKey(docId);
  if ((await redisService.getClient().ttl(redisKey)) > DOC_KEY_REFRESH_BELOW_SECONDS) {
    return;
  }
  const workspaceId = await resolveYSweetDocWorkspaceId(docId);
  if (!workspaceId) {
    throw new Error(`No canvas owns y-sweet doc ${docId}`);
  }
  if (!config.gcs.canvasBucketName) {
    throw new Error('GCS_CANVAS_BUCKET_NAME is not set; y-sweet doc keys are looked up from the doc object');
  }
  const object = await getStorageService(config.gcs.canvasBucketName).headObject(docObjectKey(docId));
  const keySha256 = object?.keySha256;
  // The stored wrapped key, for a doc whose key has no record yet.
  const storedWrappedKey = object?.metadata?.['enc-wdek'];
  const docKey = await getEncryptionProvider().sealYSweetDocKey({
    workspaceId,
    docId,
    keyType: keySha256 ? 'CSEK' : 'STORAGE',
    ...(keySha256 ? { keySha256 } : {}),
    ...(storedWrappedKey ? { wrappedKey: storedWrappedKey } : {}),
  });
  await redisService.set(redisKey, JSON.stringify(docKey), DOC_KEY_TTL_SECONDS);
}

/** The key fetched when the doc was opened, or null when it was not opened (or has expired). */
export async function getPreparedYSweetDocKey(docId: string): Promise<YSweetDocKey | null> {
  const raw = await redisService.get(docKeyRedisKey(docId));
  if (!raw) {
    return null;
  }
  const { wrappedKey, grant } = JSON.parse(raw) as Partial<YSweetDocKey>;
  return typeof wrappedKey === 'string' && typeof grant === 'string' ? { wrappedKey, grant } : null;
}
