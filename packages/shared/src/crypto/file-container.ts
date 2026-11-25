import { parseTransitKeyId, type TransitKeyring } from './keyring.js';
import type { TransitAesKey } from './transit-crypto.js';
import { getTransitPlatform } from './transit-platform.js';

/**
 * Chunked encrypted file container, the format of every encrypted file in object storage and
 * of every encrypted file between the client and the backend. The encryption service
 * (apps/encryption-rust, file_container.rs) implements the same layout; keep the two in step.
 *
 *   header  = magic "XEF1" (4) | keyIdLength u8 | keyId (ASCII) | chunkSize u32 BE | fileId (16)
 *   chunk i = iv (12) | AES-256-GCM ciphertext | tag (16)
 *   AAD i   = header | i u32 BE | last u8 (1 on the final chunk, else 0)
 *
 * Every chunk but the last holds exactly `chunkSize` plaintext bytes; the last holds
 * 0..chunkSize (an empty file is one empty last chunk). The header in the AAD binds each chunk
 * to its file and key, the index stops reordering, and the last flag stops truncation at a
 * chunk boundary. `keyId` is a transit key id (`tk-<n>`) between client and backend, and the
 * workspace storage key's id at rest.
 */

export const FILE_CONTAINER_MAGIC = 'XEF1';
/**
 * Request header by which the client says it sends files as transit containers and reads
 * them back as such, on the routes that support it.
 */
export const FILE_ENCRYPTION_HEADER = 'x-file-encryption';
export const FILE_ENCRYPTION_HEADER_VALUE = FILE_CONTAINER_MAGIC;
export const FILE_ID_LENGTH = 16;
export const FILE_CHUNK_IV_LENGTH = 12;
export const FILE_CHUNK_TAG_LENGTH = 16;
/** Bytes a chunk adds to its plaintext. */
export const FILE_CHUNK_OVERHEAD = FILE_CHUNK_IV_LENGTH + FILE_CHUNK_TAG_LENGTH;
export const MIN_FILE_CHUNK_SIZE = 4 * 1024;
/** One chunk must fit an encryption-service request (10 MB JSON, base64). */
export const MAX_FILE_CHUNK_SIZE = 4 * 1024 * 1024;

const MAX_KEY_ID_LENGTH = 255;
const FIXED_HEADER_LENGTH = FILE_CONTAINER_MAGIC.length + 1 + 4 + FILE_ID_LENGTH;

export interface FileContainerHeader {
  keyId: string;
  chunkSize: number;
  fileId: Uint8Array;
  /** The encoded header, as written and as used in every chunk's AAD. */
  bytes: Uint8Array;
}

export function isValidFileChunkSize(chunkSize: number): boolean {
  return (
    Number.isSafeInteger(chunkSize) &&
    chunkSize >= MIN_FILE_CHUNK_SIZE &&
    chunkSize <= MAX_FILE_CHUNK_SIZE
  );
}

export function encodeFileHeader(keyId: string, chunkSize: number, fileId: Uint8Array): FileContainerHeader {
  const keyIdBytes = new TextEncoder().encode(keyId);
  if (keyIdBytes.length === 0 || keyIdBytes.length > MAX_KEY_ID_LENGTH) {
    throw new Error('File container key id must be 1-255 bytes');
  }
  if (!isValidFileChunkSize(chunkSize)) {
    throw new Error(`File container chunk size out of range: ${chunkSize}`);
  }
  if (fileId.length !== FILE_ID_LENGTH) {
    throw new Error('File container file id must be 16 bytes');
  }
  const bytes = new Uint8Array(FIXED_HEADER_LENGTH + keyIdBytes.length);
  let at = 0;
  for (; at < FILE_CONTAINER_MAGIC.length; at++) bytes[at] = FILE_CONTAINER_MAGIC.charCodeAt(at);
  bytes[at++] = keyIdBytes.length;
  bytes.set(keyIdBytes, at);
  at += keyIdBytes.length;
  new DataView(bytes.buffer).setUint32(at, chunkSize);
  at += 4;
  bytes.set(fileId, at);
  return { keyId, chunkSize, fileId: new Uint8Array(fileId), bytes };
}

/** True when `bytes` starts with the container magic. */
export function hasFileContainerMagic(bytes: Uint8Array): boolean {
  if (bytes.length < FILE_CONTAINER_MAGIC.length) return false;
  for (let i = 0; i < FILE_CONTAINER_MAGIC.length; i++) {
    if (bytes[i] !== FILE_CONTAINER_MAGIC.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * The header at the start of `bytes`; `null` while `bytes` is too short to hold it (read more
 * and try again). Throws when the bytes are not a container header.
 */
export function parseFileHeader(bytes: Uint8Array): FileContainerHeader | null {
  if (bytes.length < FILE_CONTAINER_MAGIC.length + 1) return null;
  if (!hasFileContainerMagic(bytes)) throw new Error('Not an encrypted file container');
  const keyIdLength = bytes[FILE_CONTAINER_MAGIC.length];
  if (keyIdLength === 0) throw new Error('File container key id is empty');
  const length = FIXED_HEADER_LENGTH + keyIdLength;
  if (bytes.length < length) return null;
  const keyIdStart = FILE_CONTAINER_MAGIC.length + 1;
  const keyId = new TextDecoder().decode(bytes.subarray(keyIdStart, keyIdStart + keyIdLength));
  const view = new DataView(bytes.buffer, bytes.byteOffset, length);
  const chunkSize = view.getUint32(keyIdStart + keyIdLength);
  if (!isValidFileChunkSize(chunkSize)) {
    throw new Error(`File container chunk size out of range: ${chunkSize}`);
  }
  const fileIdStart = keyIdStart + keyIdLength + 4;
  return {
    keyId,
    chunkSize,
    fileId: bytes.slice(fileIdStart, fileIdStart + FILE_ID_LENGTH),
    bytes: bytes.slice(0, length),
  };
}

export function fileChunkAad(header: Uint8Array, index: number, last: boolean): Uint8Array<ArrayBuffer> {
  const aad = new Uint8Array(header.length + 5);
  aad.set(header, 0);
  const view = new DataView(aad.buffer);
  view.setUint32(header.length, index);
  aad[header.length + 4] = last ? 1 : 0;
  return aad;
}

/** Length of a container holding `plaintextLength` bytes. */
export function fileContainerLength(headerLength: number, chunkSize: number, plaintextLength: number): number {
  const chunks = Math.max(1, Math.ceil(plaintextLength / chunkSize));
  return headerLength + plaintextLength + chunks * FILE_CHUNK_OVERHEAD;
}

/** Plaintext length of a container of `containerLength` bytes; `null` when no layout fits. */
export function filePlaintextLength(headerLength: number, chunkSize: number, containerLength: number): number | null {
  const body = containerLength - headerLength;
  const record = chunkSize + FILE_CHUNK_OVERHEAD;
  if (body < FILE_CHUNK_OVERHEAD) return null;
  const full = Math.floor(body / record);
  const rest = body - full * record;
  if (rest === 0) return full * chunkSize;
  if (rest < FILE_CHUNK_OVERHEAD) return null;
  return full * chunkSize + rest - FILE_CHUNK_OVERHEAD;
}

// AES-GCM through the transit platform, as for fields, so a host without WebCrypto (React Native,
// where the key is raw bytes) can encrypt and decrypt files too.
async function sealChunk(key: TransitAesKey, header: Uint8Array, index: number, last: boolean, plaintext: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(FILE_CHUNK_IV_LENGTH));
  const sealed = await getTransitPlatform().crypto.encrypt(
    key,
    iv,
    plaintext,
    fileChunkAad(header, index, last),
  );
  const out = new Uint8Array(FILE_CHUNK_IV_LENGTH + sealed.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(sealed), FILE_CHUNK_IV_LENGTH);
  return out;
}

/**
 * Encrypt `file` for upload under the client's current transit key: the backend sends it to
 * the encryption service, which re-encrypts it under the workspace storage key.
 */
export async function encryptFileForUpload(file: Blob, keyring: TransitKeyring, chunkSize: number): Promise<Blob> {
  const { key, keyId } = await keyring.current();
  const header = encodeFileHeader(keyId, chunkSize, crypto.getRandomValues(new Uint8Array(FILE_ID_LENGTH)));
  const parts: BlobPart[] = [header.bytes as Uint8Array<ArrayBuffer>];
  const chunks = Math.max(1, Math.ceil(file.size / chunkSize));
  for (let i = 0; i < chunks; i++) {
    const plaintext = new Uint8Array(await file.slice(i * chunkSize, (i + 1) * chunkSize).arrayBuffer());
    parts.push((await sealChunk(key, header.bytes, i, i === chunks - 1, plaintext)) as Uint8Array<ArrayBuffer>);
  }
  return new Blob(parts, { type: 'application/octet-stream' });
}

/** Decrypt a downloaded container, encrypted by the backend under one of the client's transit keys. */
export async function decryptDownloadedFile(container: Uint8Array, keyring: TransitKeyring): Promise<Uint8Array<ArrayBuffer>> {
  const header = parseFileHeader(container);
  if (!header) throw new Error('Encrypted file is truncated');
  if (parseTransitKeyId(header.keyId) === null) {
    throw new Error(`File is not encrypted with a transit key: ${header.keyId}`);
  }
  const plaintextLength = filePlaintextLength(header.bytes.length, header.chunkSize, container.length);
  if (plaintextLength === null) throw new Error('Encrypted file has an invalid length');
  const key = await keyring.forKeyId(header.keyId);
  const out = new Uint8Array(plaintextLength);
  const record = header.chunkSize + FILE_CHUNK_OVERHEAD;
  let at = header.bytes.length;
  let written = 0;
  for (let i = 0; at < container.length; i++) {
    const end = Math.min(at + record, container.length);
    const last = end === container.length;
    const plain = await getTransitPlatform().crypto.decrypt(
      key,
      container.slice(at, at + FILE_CHUNK_IV_LENGTH),
      container.slice(at + FILE_CHUNK_IV_LENGTH, end),
      fileChunkAad(header.bytes, i, last),
    );
    out.set(new Uint8Array(plain), written);
    written += plain.byteLength;
    at = end;
  }
  return out;
}
