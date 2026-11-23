import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import {
  FILE_ENCRYPTION_HEADER,
  FILE_ENCRYPTION_HEADER_VALUE,
  decryptDownloadedFile,
  encryptFileForUpload,
  hasFileContainerMagic,
  isValidFileChunkSize,
} from '@xyne/shared';
import { getEncryptionState, isEncryptionReady } from '../machines/encryptionMachine';

/**
 * Routes mounted with the backend's clientFileEncryption: uploads to them are sent as transit
 * containers and downloads from them come back as transit containers. Every other route keeps
 * sending and receiving plaintext files.
 */
const UPLOAD_ROUTES = [/\/conversations\/[^/]+\/messages$/, /\/drafts\/attachments\/upload$/];
const DOWNLOAD_ROUTES = [/\/attachments\/[^/]+\/(download|thumbnail)$/];

function pathOf(config: InternalAxiosRequestConfig): string {
  return new URL(config.url ?? '', 'http://localhost').pathname;
}

function fileEncryptionActive(): boolean {
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
    UPLOAD_ROUTES.some(r => r.test(path))
  ) {
    config.data = await encryptFormDataFiles(config.data);
    config.headers.set(FILE_ENCRYPTION_HEADER, FILE_ENCRYPTION_HEADER_VALUE);
    return config;
  }

  if (
    method === 'get' &&
    (config.responseType === 'blob' || config.responseType === 'arraybuffer') &&
    DOWNLOAD_ROUTES.some(r => r.test(path))
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
