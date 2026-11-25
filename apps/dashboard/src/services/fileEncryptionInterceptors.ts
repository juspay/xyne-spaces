import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import {
  FILE_ENCRYPTION_HEADER,
  FILE_ENCRYPTION_HEADER_VALUE,
  decryptDownloadedFile,
  encryptFileForUpload,
  hasFileContainerMagic,
  isClientEncryptedFileRoute,
  isValidFileChunkSize,
} from '@xyne/shared';
import { getEncryptionState, isEncryptionReady } from '../machines/encryptionMachine';

/**
 * Files to and from @xyne/shared's CLIENT_ENCRYPTED_FILE_ROUTES (the list the backend marks
 * requests by) travel as transit containers. Every other route keeps sending and receiving
 * plaintext files.
 */
function pathOf(config: InternalAxiosRequestConfig): string {
  return new URL(config.url ?? '', 'http://localhost').pathname;
}

/** Whether files on the client-encrypted routes are encrypted and decrypted here. */
export function fileEncryptionActive(): boolean {
  if (!isEncryptionReady()) return false;
  const { keyring, apiClientEncryptionEnabled, fileChunkSize } = getEncryptionState();
  return keyring !== null && apiClientEncryptionEnabled && isValidFileChunkSize(fileChunkSize);
}

/** The FormData with every file replaced by its transit container (same name and type). */
async function encryptFormDataFiles(source: FormData): Promise<FormData> {
  const { keyring, fileChunkSize } = getEncryptionState();
  const entries: [string, FormDataEntryValue][] = [];
  source.forEach((value, key) => entries.push([key, value]));
  const out = new FormData();
  for (const [key, value] of entries) {
    if (typeof value === 'string') {
      out.append(key, value);
      continue;
    }
    // A request re-sent after a stale-manifest retry already carries containers.
    if (hasFileContainerMagic(new Uint8Array(await value.slice(0, 4).arrayBuffer()))) {
      out.append(key, value);
      continue;
    }
    const container = await encryptFileForUpload(value, keyring!, fileChunkSize);
    out.append(key, new File([container], value.name, { type: value.type }));
  }
  return out;
}

export async function fileEncryptionRequestInterceptor(
  config: InternalAxiosRequestConfig,
): Promise<InternalAxiosRequestConfig> {
  if (!fileEncryptionActive()) return config;
  const method = config.method?.toLowerCase();
  const path = pathOf(config);

  if (
    method === 'post' &&
    config.data instanceof FormData &&
    isClientEncryptedFileRoute('POST', path)
  ) {
    config.data = await encryptFormDataFiles(config.data);
    config.headers.set(FILE_ENCRYPTION_HEADER, FILE_ENCRYPTION_HEADER_VALUE);
    return config;
  }

  if (
    method === 'get' &&
    (config.responseType === 'blob' || config.responseType === 'arraybuffer') &&
    isClientEncryptedFileRoute('GET', path)
  ) {
    config.headers.set(FILE_ENCRYPTION_HEADER, FILE_ENCRYPTION_HEADER_VALUE);
  }
  return config;
}

/**
 * Decrypt a download the request interceptor asked for as a transit container. Files stored
 * before encryption come back as plaintext and are left as they are.
 */
export async function fileEncryptionResponseInterceptor(
  response: AxiosResponse<unknown>,
): Promise<AxiosResponse<unknown>> {
  if (response.config.headers?.get?.(FILE_ENCRYPTION_HEADER) !== FILE_ENCRYPTION_HEADER_VALUE)
    return response;
  if (response.config.method?.toLowerCase() !== 'get') return response;
  const { keyring } = getEncryptionState();
  if (!keyring) return response;

  const data = response.data;
  const blob = data instanceof Blob ? data : data instanceof ArrayBuffer ? new Blob([data]) : null;
  if (!blob) return response;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!hasFileContainerMagic(bytes)) return response;

  const plaintext = await decryptDownloadedFile(bytes, keyring);
  const contentType = String(
    response.headers['content-type'] ?? (data instanceof Blob ? data.type : ''),
  );
  response.data =
    response.config.responseType === 'arraybuffer'
      ? plaintext.buffer
      : new Blob([plaintext], { type: contentType });
  return response;
}

/** Whether a service worker can stream encrypted attachments for this page (public/sw.js). */
export function fileStreamWorkerReady(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.serviceWorker?.controller);
}

/**
 * Answers the service worker that streams encrypted attachments (public/sw.js): whether file
 * encryption is on, and the transit key for a key id. The key goes over as the keyring's
 * non-extractable CryptoKey, so it never leaves the browser and cannot be read as bytes.
 */
export function answerFileStreamWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
    const port = event.ports[0];
    const data = event.data as { type?: unknown; keyId?: unknown } | null;
    if (!port || !data) return;
    if (data.type === 'file-encryption-state') {
      port.postMessage({ active: fileEncryptionActive() });
      return;
    }
    if (data.type === 'file-encryption-key' && typeof data.keyId === 'string') {
      const { keyring } = getEncryptionState();
      if (!fileEncryptionActive() || !keyring) {
        port.postMessage({ key: null });
        return;
      }
      keyring.forKeyId(data.keyId).then(
        key => port.postMessage({ key }),
        () => port.postMessage({ key: null }),
      );
    }
  });
}
