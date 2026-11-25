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
import { createWriteStream } from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { currentWorkspaceId } from '@/database/tenant/context';
import { clientFileCaller, isUnencryptedFileWrite } from '@/middleware/clientFileEncryption';
import { getEncryptionProvider, type TransitCaller } from '@/services/encryption';
import { collect, MAX_HEADER_LENGTH, openFileForTransit, openFileRangeForTransit, sealFile } from './fileContainerStream';
import { FILE_CHUNK_OVERHEAD, filePlaintextLength, parseFileHeader, type FileContainerHeader } from '@xyne/shared';

/** Custom-metadata keys that say how an object is encrypted. */
const META_VERSION = 'enc-v';
const META_WRAPPED_KEY = 'enc-wdek';
/** Written before this file existed: a per-object GCS CSEK, wrapped in `enc-wdek`. Read only. */
const CSEK_VERSION = '1';
/** A workspace storage container (@xyne/shared file-container), encrypted by the encryption service. */
const CONTAINER_VERSION = '2';

const KEY_CACHE_MAX_ENTRIES = 1024;
const KEY_CACHE_TTL_MS = 5 * 60 * 1000;

type SafeStorageOptions = {
  /** Encrypt new objects (as storage containers). */
  encryptWrites: boolean;
  /** Decrypt objects that say they are encrypted. Objects that do not are read as plaintext. */
  decryptReads: boolean;
  /** Plaintext bytes per chunk of a newly encrypted file. */
  chunkSize: number;
};

/** Where an encrypted object's plaintext lies, for range reads. */
export type EncryptedLayout = {
  header: FileContainerHeader;
  /** Bytes in storage: the container. */
  storedSize: number;
  plaintextSize: number;
  totalChunks: number;
};

type StoredAs =
  | { kind: 'plaintext' }
  | { kind: 'csek'; key: ObjectKeyOptions }
  | { kind: 'container' };

/**
 * Encrypts every new object as a workspace storage container: the encryption service
 * encrypts it chunk by chunk under the workspace storage key, from plaintext (files the
 * backend writes) or from the client's transit container (routes mounted with
 * clientFileEncryption), so a client's file is never plaintext here. GCS stores the bytes as
 * they are.
 *
 * Reads tell objects apart by their metadata: plaintext, a GCS CSEK object from before
 * (`enc-v: 1`, the key unwrapped by the encryption service and handed to GCS), or a
 * container (`enc-v: 2`), which only a clientFileEncryption request can read: it gets the
 * file re-encrypted for its transit key. Anything else reading a container fails; the backend
 * never decrypts one.
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
    if (!this.encrypts()) return this.inner.uploadFile(buffer, options);
    const { bytes, plaintextBytes } = await this.sealBuffer(buffer);
    const result = await this.inner.uploadFile(bytes, { ...options, encryption: CONTAINER_ENCRYPTION });
    return { ...result, size: plaintextBytes };
  }

  async uploadStream(stream: NodeJS.ReadableStream, options: UploadOptions): Promise<UploadResult> {
    if (!this.encrypts()) return this.inner.uploadStream(stream, options);
    const sealed = this.sealStream(stream);
    const result = await this.inner.uploadStream(sealed.stream, { ...options, encryption: CONTAINER_ENCRYPTION });
    return { ...result, size: await sealed.plaintextBytes };
  }

  async uploadFileV2(buffer: Buffer, options: UploadV2Options): Promise<UploadResult> {
    if (!this.encrypts()) return this.inner.uploadFileV2(buffer, options);
    const { bytes, plaintextBytes } = await this.sealBuffer(buffer);
    const result = await this.inner.uploadFileV2(bytes, { ...options, encryption: CONTAINER_ENCRYPTION });
    return { ...result, size: plaintextBytes };
  }

  async uploadStreamToPath(stream: NodeJS.ReadableStream, options: UploadToPathOptions): Promise<UploadResult> {
    if (!this.encrypts()) return this.inner.uploadStreamToPath(stream, options);
    const sealed = this.sealStream(stream);
    const result = await this.inner.uploadStreamToPath(sealed.stream, { ...options, encryption: CONTAINER_ENCRYPTION });
    return { ...result, size: await sealed.plaintextBytes };
  }

  async getFileBuffer(path: string, maxRetries?: number): Promise<Buffer> {
    const stored = await this.storedAs(path);
    if (stored.kind === 'container') return collect(await this.openContainer(path));
    return this.inner.getFileBuffer(path, maxRetries, csekKey(stored));
  }

  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    const stored = await this.storedAs(remotePath);
    if (stored.kind === 'container') {
      await pipeline(await this.openContainer(remotePath), createWriteStream(localPath));
      return;
    }
    return this.inner.downloadFile(remotePath, localPath, csekKey(stored));
  }

  async createReadStream(path: string, options?: ReadStreamOptions): Promise<NodeJS.ReadableStream> {
    const stored = await this.storedAs(path);
    if (stored.kind === 'container') {
      if (options?.start !== undefined || options?.end !== undefined) {
        throw new Error(`Range reads are not available for encrypted files: ${path}`);
      }
      return this.openContainer(path);
    }
    return this.inner.createReadStream(path, { ...options, ...csekKey(stored) });
  }

  async getObject(path: string): Promise<ObjectRead | null> {
    const stored = await this.storedAs(path);
    if (stored.kind !== 'container') return this.inner.getObject(path, csekKey(stored));
    const caller = readerCaller(path);
    const read = await this.inner.getObject(path);
    if (!read) return null;
    // The size GCS reports is the stored container's, not the file's.
    const info = { ...read.info, size: undefined };
    const stream = openFileForTransit(read.stream as AsyncIterable<Buffer>, { workspaceId: requireWorkspaceId(), caller });
    return { info, stream };
  }

  async moveFile(sourcePath: string, destinationPath: string): Promise<void> {
    return this.inner.moveFile(sourcePath, destinationPath, csekKey(await this.storedAs(sourcePath)));
  }

  async generateSignedUrl(filename: string, expirationHours?: number): Promise<string> {
    if ((await this.storedAs(filename)).kind !== 'plaintext') {
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

  /** Whether a write now is encrypted: on, unless the request's route stores files unencrypted. */
  private encrypts(): boolean {
    return this.options.encryptWrites && !isUnencryptedFileWrite();
  }

  private sealStream(source: NodeJS.ReadableStream): ReturnType<typeof sealFile> {
    return sealFile(source as AsyncIterable<Buffer>, {
      workspaceId: requireWorkspaceId(),
      caller: clientFileCaller(),
      chunkSize: this.options.chunkSize,
    });
  }

  private async sealBuffer(buffer: Buffer): Promise<{ bytes: Buffer; plaintextBytes: number }> {
    const sealed = this.sealStream(Readable.from([buffer]));
    const bytes = await collect(sealed.stream);
    return { bytes, plaintextBytes: await sealed.plaintextBytes };
  }

  private async openContainer(path: string): Promise<Readable> {
    const caller = readerCaller(path);
    return openFileForTransit((await this.inner.createReadStream(path)) as AsyncIterable<Buffer>, {
      workspaceId: requireWorkspaceId(),
      caller,
    });
  }

  /**
   * The layout of an encrypted (`enc-v: 2`) object, read from its header; null for any other
   * object. For range reads, which address the file's plaintext.
   */
  async encryptedLayout(path: string): Promise<EncryptedLayout | null> {
    if ((await this.storedAs(path)).kind !== 'container') return null;
    const storedSize = Number((await this.inner.headObject(path))?.size ?? 0);
    const head = await collect(await this.inner.createReadStream(path, { start: 0, end: MAX_HEADER_LENGTH - 1 }));
    const header = parseFileHeader(head);
    if (!header) throw new Error(`Encrypted file header is truncated: ${path}`);
    const plaintextSize = filePlaintextLength(header.bytes.length, header.chunkSize, storedSize);
    if (plaintextSize === null) throw new Error(`Encrypted file has an invalid length: ${path}`);
    return {
      header,
      storedSize,
      plaintextSize,
      totalChunks: Math.max(1, Math.ceil(plaintextSize / header.chunkSize)),
    };
  }

  /**
   * Chunks `first`..`last` of an encrypted object, re-encrypted for the request's client: a
   * transit container header followed by those chunks. Only they are read from storage.
   */
  async openContainerChunks(path: string, layout: EncryptedLayout, first: number, last: number): Promise<Readable> {
    const caller = readerCaller(path);
    const headerLength = layout.header.bytes.length;
    const record = layout.header.chunkSize + FILE_CHUNK_OVERHEAD;
    const start = headerLength + first * record;
    const end = Math.min(headerLength + (last + 1) * record, layout.storedSize) - 1;
    const stored = await this.inner.createReadStream(path, { start, end });
    return openFileRangeForTransit(stored as AsyncIterable<Buffer>, {
      workspaceId: requireWorkspaceId(),
      caller,
      header: layout.header,
      firstIndex: first,
      totalChunks: layout.totalChunks,
    });
  }

  /** How the object at `path` is stored; a missing object reads as plaintext (the read then reports it). */
  private async storedAs(path: string): Promise<StoredAs> {
    if (!this.options.decryptReads) return { kind: 'plaintext' };
    const metadata = (await this.inner.headObject(path))?.metadata;
    const version = metadata?.[META_VERSION];
    if (version === CONTAINER_VERSION) return { kind: 'container' };
    const wrappedKey = metadata?.[META_WRAPPED_KEY];
    if (version !== CSEK_VERSION || !wrappedKey) return { kind: 'plaintext' };
    const encryptionKey = await this.keys.get(wrappedKey);
    if (!encryptionKey) {
      throw new Error(`Encryption key for ${path} could not be unwrapped`);
    }
    return { kind: 'csek', key: { encryptionKey } };
  }
}

/** Container bytes are already encrypted: no CSEK, only the metadata that says what they are. */
const CONTAINER_ENCRYPTION: ObjectEncryption = { customMetadata: { [META_VERSION]: CONTAINER_VERSION } };

function csekKey(stored: StoredAs): ObjectKeyOptions | undefined {
  return stored.kind === 'csek' ? stored.key : undefined;
}

/** Only a clientFileEncryption request reads a container: it gets the file under its transit key. */
function readerCaller(path: string): TransitCaller {
  const caller = clientFileCaller();
  if (!caller) throw new Error(`Encrypted file can only be read by a client that decrypts it: ${path}`);
  return caller;
}

/** New files go under their workspace's storage key, so a write without a workspace fails. */
function requireWorkspaceId(): string {
  const workspaceId = currentWorkspaceId();
  if (!workspaceId) throw new Error('No workspace in tenant context; refusing to store an unencrypted file');
  return workspaceId;
}
