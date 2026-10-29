import { createCache } from '@xyne/cache';
import type {
  DeleteResult,
  FileMetadata,
  ListedFile,
  ObjectEncryption,
  ObjectInfo,
  ObjectKeyOptions,
  ObjectRead,
  ReadStreamOptions,
  StorageService,
  UploadOptions,
  UploadResult,
  UploadToPathOptions,
  UploadV2Options,
} from '@xyne/storage';
import { currentWorkspaceId } from '@/database/tenant/context';
import { getEncryptionProvider } from '@/services/encryption';
import { logger } from '@/utils/logger';

/** Custom-metadata keys that carry an object's wrapped key. */
const META_VERSION = 'enc-v';
const META_WRAPPED_KEY = 'enc-wdek';
const ENCRYPTION_VERSION = '1';

const KEY_CACHE_MAX_ENTRIES = 1024;
const KEY_CACHE_TTL_MS = 5 * 60 * 1000;

type SafeStorageOptions = {
  /** Encrypt new objects. Writes with no workspace in the tenant context stay plaintext. */
  encryptWrites: boolean;
  /** Decrypt objects that carry a wrapped key. Objects without one are read as plaintext. */
  decryptReads: boolean;
};

/**
 * Encrypts every object with its own GCS customer-supplied key (CSEK). The key is wrapped
 * by the encryption service under the workspace storage key and kept in the object's
 * custom metadata; reads unwrap it and hand it back to GCS, which decrypts server-side.
 */
export class SafeStorageService implements StorageService {
  private readonly keys = createCache<string, Buffer>({
    max: KEY_CACHE_MAX_ENTRIES,
    ttlMs: KEY_CACHE_TTL_MS,
    fetch: async (wrappedKey) => {
      const [key] = await getEncryptionProvider().unwrapStorageKeys([wrappedKey]);
      return key;
    },
  });

  constructor(
    private readonly inner: StorageService,
    private readonly options: SafeStorageOptions,
  ) {}

  async uploadFile(buffer: Buffer, options: UploadOptions): Promise<UploadResult> {
    return this.inner.uploadFile(buffer, { ...options, ...(await this.newObjectEncryption()) });
  }

  async uploadStream(stream: NodeJS.ReadableStream, options: UploadOptions): Promise<UploadResult> {
    return this.inner.uploadStream(stream, { ...options, ...(await this.newObjectEncryption()) });
  }

  async uploadFileV2(buffer: Buffer, options: UploadV2Options): Promise<UploadResult> {
    return this.inner.uploadFileV2(buffer, { ...options, ...(await this.newObjectEncryption()) });
  }

  async uploadStreamToPath(stream: NodeJS.ReadableStream, options: UploadToPathOptions): Promise<UploadResult> {
    return this.inner.uploadStreamToPath(stream, { ...options, ...(await this.newObjectEncryption()) });
  }

  async getFileBuffer(path: string, maxRetries?: number): Promise<Buffer> {
    return this.inner.getFileBuffer(path, maxRetries, await this.keyOptions(path));
  }

  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    return this.inner.downloadFile(remotePath, localPath, await this.keyOptions(remotePath));
  }

  async createReadStream(path: string, options?: ReadStreamOptions): Promise<NodeJS.ReadableStream> {
    return this.inner.createReadStream(path, { ...options, ...(await this.keyOptions(path)) });
  }

  async getObject(path: string): Promise<ObjectRead | null> {
    return this.inner.getObject(path, await this.keyOptions(path));
  }

  async moveFile(sourcePath: string, destinationPath: string): Promise<void> {
    return this.inner.moveFile(sourcePath, destinationPath, await this.keyOptions(sourcePath));
  }

  async copyFile(sourcePath: string, destinationPath: string): Promise<void> {
    return this.inner.copyFile(sourcePath, destinationPath, await this.keyOptions(sourcePath));
  }

  async generateSignedUrl(filename: string, expirationHours?: number): Promise<string> {
    if (await this.keyOptions(filename)) {
      throw new Error(`Signed URLs are not available for encrypted objects: ${filename}`);
    }
    return this.inner.generateSignedUrl(filename, expirationHours);
  }

  deleteFile(filename: string): Promise<DeleteResult> {
    return this.inner.deleteFile(filename);
  }

  fileExists(filename: string): Promise<boolean> {
    return this.inner.fileExists(filename);
  }

  getFileMetadata(filename: string): Promise<FileMetadata> {
    return this.inner.getFileMetadata(filename);
  }

  headObject(path: string): Promise<ObjectInfo | null> {
    return this.inner.headObject(path);
  }

  listFiles(prefix: string): Promise<ListedFile[]> {
    return this.inner.listFiles(prefix);
  }

  listPrefixes(prefix: string): Promise<string[]> {
    return this.inner.listPrefixes(prefix);
  }

  ensureBucketExists(): Promise<void> {
    return this.inner.ensureBucketExists();
  }

  checkBucketExists(): Promise<void> {
    return this.inner.checkBucketExists();
  }

  buildStorageUri(path: string): string {
    return this.inner.buildStorageUri(path);
  }

  private async newObjectEncryption(): Promise<{ encryption?: ObjectEncryption }> {
    if (!this.options.encryptWrites) return {};
    const workspaceId = currentWorkspaceId();
    if (!workspaceId) {
      logger.warn('[SafeStorage] No workspace in tenant context; writing object unencrypted');
      return {};
    }
    const { key, wrappedKey } = await getEncryptionProvider().generateStorageKey({ workspaceId });
    return {
      encryption: {
        key,
        customMetadata: {
          [META_VERSION]: ENCRYPTION_VERSION,
          [META_WRAPPED_KEY]: wrappedKey,
        },
      },
    };
  }

  /** The object's key, or undefined for a plaintext or missing object (the read then reports it). */
  private async keyOptions(path: string): Promise<ObjectKeyOptions | undefined> {
    if (!this.options.decryptReads) return undefined;
    const wrappedKey = (await this.inner.headObject(path))?.metadata?.[META_WRAPPED_KEY];
    if (!wrappedKey) return undefined;
    const encryptionKey = await this.keys.get(wrappedKey);
    if (!encryptionKey) {
      throw new Error(`Encryption key for ${path} could not be unwrapped`);
    }
    return { encryptionKey };
  }
}
