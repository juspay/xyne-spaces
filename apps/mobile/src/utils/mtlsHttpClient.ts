/**
 * mTLS HTTP Client for React Native
 *
 * Cross-platform wrapper for native mTLS HTTP requests.
 * Uses client certificates from the device keychain/keystore
 * for mutual TLS authentication via CertificateModule.
 */

import Constants from 'expo-constants';
import DeviceInfo from 'react-native-device-info';
import { NativeModules, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import axios from 'axios';
import { isApprovedTransportDestination, isLocalOrInsecureUrl } from './mtlsTransportPolicy';
import {
  newRequestId,
  RequestTimeoutError,
  withDeadline,
  withNativeAbort,
} from '@/src/services/http/native-request-registry';
import { API_ORIGIN, isMtlsFeatureEnabled } from '../config';
import { buildApiCookieHeader, mergeCookieHeader } from './apiCookieHeader';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger';
import { getActiveWorkspaceId } from './activeWorkspace';
import { decodeBase64Bytes, decodeBase64Utf8 } from './base64Utf8';

/**
 * Structure representing a React Native FormData for native bridge transmission.
 * Passed to native modules for multipart/form-data uploads.
 */
export interface FormDataPayload {
  formData: true;
  fields: Array<{ name: string; value: string }>;
  files: Array<{
    name: string;
    type: string;
    uri: string;
    fieldName: string;
  }>;
}

type NativeMultipartArgs = {
  fields: Record<string, string>;
  files: Array<{
    fieldName: string;
    filePath: string;
    fileName: string;
    mimeType: string;
  }>;
};

// Keep aligned with multipartHeaderParameterMaxLength and
// safeMultipartHeaderParameter in CertificateModule.swift.
export const MULTIPART_HEADER_PARAMETER_MAX_LENGTH = 180;

function sanitizeMultipartFileName(name: string | undefined): string {
  const fallback = 'upload.bin';
  const trimmed = (name || fallback).trim();
  const safeName = trimmed
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/./g, character => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127 ? '_' : character;
    })
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/[\\/:"*?<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/_+/g, '_')
    .trim()
    .slice(0, MULTIPART_HEADER_PARAMETER_MAX_LENGTH);

  return safeName || fallback;
}

function fileUriToNativePath(uri: string): string {
  if (!uri.startsWith('file://')) {
    return uri;
  }

  const path = uri.replace(/^file:\/\//, '');
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

interface MtlsHttpClientInterface {
  request(
    url: string,
    options?: {
      method?: string;
      headers?: Record<string, string>;
      body?: string | FormDataPayload;
      /** Lets the native layer find and cancel this task. */
      requestId?: string;
    },
  ): Promise<{
    statusCode: number;
    body: unknown;
    headers: Record<string, string>;
    isBase64?: boolean;
  }>;
}

const LINKING_ERROR =
  `CertificateModule is not available. Make sure: \n\n` +
  '- You rebuilt the app after making native changes\n' +
  '- The CertificateModule is properly linked\n';
const CertificateModule = NativeModules['CertificateModule'] as
  | {
      performMtlsRequest?: (
        url: string,
        requestId: string,
        method: string,
        headers: Record<string, string>,
        body: string | FormDataPayload | null,
      ) => Promise<{
        status: number;
        body: unknown;
        headers: Record<string, string>;
        isBase64?: boolean;
      }>;
      performMtlsMultipartUpload?: (
        url: string,
        fields: Record<string, string>,
        files: Array<{
          fieldName: string;
          filePath: string;
          fileName: string;
          mimeType: string;
        }>,
        headers: Record<string, string>,
      ) => Promise<{
        status: number;
        body: unknown;
        headers: Record<string, string>;
        isBase64?: boolean;
      }>;
      downloadMtlsFile?: (
        url: string,
        destinationPath: string,
        headers: Record<string, string>,
      ) => Promise<{
        status: number;
        ok: boolean;
        uri?: string | null;
        size?: number;
        mimeType?: string | null;
        errorBody?: string;
        headers?: Record<string, string>;
      }>;
    }
  | undefined;

const MtlsHttpClientNative: MtlsHttpClientInterface = {
  request: async (url, options) => {
    if (!CertificateModule?.performMtlsRequest) {
      throw new Error(LINKING_ERROR);
    }

    const result = await CertificateModule.performMtlsRequest(
      url,
      options?.requestId ?? '',
      options?.method || 'GET',
      options?.headers || {},
      options?.body || null,
    );

    return {
      statusCode: result.status,
      body: result.body,
      headers: result.headers,
      isBase64: result.isBase64 ?? true,
    };
  },
};

export interface MtlsResponse {
  statusCode: number;
  body: unknown;
  headers: Record<string, string | string[]>;
  isBase64?: boolean;
}

/**
 * The native bridge may hand back `body` as a base64 string, a plain-text
 * string, or an already-parsed JSON value (see MtlsResponse.isBase64). These
 * three accessors are the single place that knows how to get from that
 * ambiguous shape to what a caller actually wants, so consumers never have
 * to re-derive the `typeof body === 'string'` / `isBase64` logic themselves.
 */
type MtlsResponseBodyLike = Pick<MtlsResponse, 'body' | 'isBase64'>;

/** Parse `body` as JSON, decoding base64 first if necessary. Throws if it isn't valid JSON. */
export function getResponseJson<T>(response: MtlsResponseBodyLike): T {
  if (typeof response.body !== 'string') {
    return response.body as T;
  }
  const decoded = response.isBase64 ? decodeBase64Utf8(response.body) : response.body;
  return JSON.parse(decoded) as T;
}

/** Get `body` as decoded text. Non-string bodies are stringified; decode failures return ''. */
export function getResponseText(response: MtlsResponseBodyLike): string {
  if (typeof response.body !== 'string') {
    try {
      return JSON.stringify(response.body);
    } catch {
      return '';
    }
  }
  if (response.isBase64) {
    try {
      return decodeBase64Utf8(response.body);
    } catch {
      return '';
    }
  }
  return response.body;
}

/** Get `body` as a raw base64 string. Throws if the response isn't actually base64-encoded. */
export function getResponseBase64(response: MtlsResponseBodyLike): string {
  if (typeof response.body !== 'string' || response.isBase64 !== true) {
    throw new Error(
      '[mTLS] Expected a base64-encoded response body, but received a different shape',
    );
  }
  return response.body;
}

export interface MtlsFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: string | FormData;
  /**
   * When true, repeated form field names (e.g. multiple `tags` entries) are
   * preserved. The request bypasses `performMtlsMultipartUpload` (which
   * collapses duplicates via NSDictionary/ReadableMap) and instead serialises
   * the FormDataPayload as a JSON string for `performMtlsRequest`, whose
   * `buildMultipartBody` iterates the fields array and keeps every entry.
   */
  allowRepeatedFields?: boolean;
  /**
   * Aborts the request all the way down to the native socket. Without this a
   * superseded search only stopped being *listened to*; it kept running.
   */
  signal?: AbortSignal;
  /** Hard deadline. Defaults to DEFAULT_REQUEST_TIMEOUT_MS. */
  timeoutMs?: number;
}

/** Matches the native URLSession request timeout. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

async function prepareHeadersForTransport(
  headers: Record<string, string> | undefined,
): Promise<Record<string, string>> {
  const nextHeaders: Record<string, string> = { ...(headers ?? {}) };
  const appVersion =
    Platform.OS === 'web' ? (Constants.expoConfig?.version ?? '') : DeviceInfo.getVersion();
  if (appVersion !== '') {
    nextHeaders['x-app-version'] = appVersion;
  }

  nextHeaders['x-request-id'] = uuidv4();
  nextHeaders['x-platform'] = 'native';

  const zeroClientId = logger.zeroClientId;
  if (zeroClientId) {
    nextHeaders['x-client-id'] = zeroClientId;
  }

  const zeroClientGroupId = logger.zeroClientGroupId;
  if (zeroClientGroupId) {
    nextHeaders['x-zero-client-group-id'] = zeroClientGroupId;
  }

  const clientSessionId = logger.getClientSessionId();
  if (clientSessionId) {
    nextHeaders['x-client-session-id'] = clientSessionId;
  }

  const workspaceId = getActiveWorkspaceId();
  if (workspaceId) {
    nextHeaders['x-workspace-id'] = workspaceId;
  }

  // iOS sends cookies from the native HTTPCookieStorage attached to the shared
  // URLSession, so reading the JS cookie jar here was a bridge round trip on the
  // critical path of every request whose result was discarded on the next line.
  // Return before paying for it.
  if (Platform.OS === 'ios') {
    const { Cookie: _cookie, ...remainingHeaders } = nextHeaders;
    return remainingHeaders;
  }

  const jarCookies = await buildApiCookieHeader(API_ORIGIN);
  const mergedCookie = mergeCookieHeader(jarCookies, nextHeaders['Cookie']);
  if (mergedCookie) {
    nextHeaders['Cookie'] = mergedCookie;
  }
  return nextHeaders;
}

/**
 * Make an HTTP request with mTLS client certificate authentication.
 *
 * This uses the client certificate stored in the device keychain (iOS)
 * or keystore (Android) for mutual TLS authentication.
 *
 * @param url - The URL to request
 * @param options - Request options (method, headers, body)
 * @returns Promise resolving to response with statusCode, body, and headers
 */
function isBinaryContentType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const ct = contentType.toLowerCase().split(';')[0]!.trim();
  if (
    ct.startsWith('text/') ||
    ct.includes('json') ||
    ct.includes('xml') ||
    ct.includes('javascript') ||
    ct === 'application/x-www-form-urlencoded'
  ) {
    return false;
  }
  return (
    ct.startsWith('image/') ||
    ct.startsWith('video/') ||
    ct.startsWith('audio/') ||
    ct.startsWith('application/')
  );
}

/**
 * Check if value is a React Native FormData object.
 * React Native FormData has internal `_parts` array.
 */
function isFormData(value: unknown): value is FormData {
  return (
    typeof value === 'object' &&
    value !== null &&
    '_parts' in value &&
    Array.isArray((value as FormData & { _parts: unknown })._parts)
  );
}

/**
 * Convert React Native FormData to a structured payload for native modules.
 * Extracts fields and files from the FormData's internal _parts array.
 */
function convertFormDataToPayload(formData: FormData): FormDataPayload {
  const fields: Array<{ name: string; value: string }> = [];
  const files: Array<{ name: string; type: string; uri: string; fieldName: string }> = [];

  const parts = (formData as FormData & { _parts: Array<[string, unknown]> })._parts;

  for (const [name, value] of parts) {
    if (
      typeof value === 'object' &&
      value !== null &&
      'uri' in value &&
      'type' in value &&
      'name' in value
    ) {
      // This is a file
      const fileValue = value as { uri: string; type: string; name: string };
      files.push({
        name: sanitizeMultipartFileName(fileValue.name),
        type: fileValue.type,
        uri: fileValue.uri,
        fieldName: name,
      });
    } else {
      // This is a regular field
      fields.push({
        name,
        value: String(value),
      });
    }
  }

  return { formData: true, fields, files };
}

function convertFormDataToNativeMultipartArgs(formData: FormData): NativeMultipartArgs {
  const payload = convertFormDataToPayload(formData);
  const fields = payload.fields.reduce<Record<string, string>>((acc, field) => {
    acc[field.name] = field.value;
    return acc;
  }, {});
  const files = payload.files.map(file => ({
    fieldName: file.fieldName,
    filePath: fileUriToNativePath(file.uri),
    fileName: file.name,
    mimeType: file.type,
  }));
  return { fields, files };
}

export type MtlsDownloadResult = {
  statusCode: number;
  ok: boolean;
  uri: string | null;
  size: number;
  mimeType: string | null;
  errorBody: string;
  headers: Record<string, string>;
};

function toFileUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

function flattenHeaders(headers: Record<string, string | string[]>): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    next[key] = Array.isArray(value) ? value.join(',') : value;
  }
  return next;
}

function headerValue(headers: Record<string, string | string[]>, name: string): string | undefined {
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  if (!match) return undefined;
  const value = match[1];
  return Array.isArray(value) ? value[0] : value;
}

function shouldUseNativeFileDownload(url: string): boolean {
  if (!CertificateModule?.downloadMtlsFile) {
    return false;
  }
  if (isLocalOrInsecureUrl(url)) {
    return false;
  }
  // iOS downloadMtlsFile always requires an enrolled client certificate.
  // Non-mTLS iOS builds must keep using the ordinary HTTPS fallback.
  return Platform.OS === 'android' || isMtlsFeatureEnabled();
}

async function writeFetchedBodyToFile(
  response: MtlsResponse,
  destinationPath: string,
): Promise<MtlsDownloadResult> {
  const headers = flattenHeaders(response.headers);
  const mimeType = headerValue(response.headers, 'content-type')?.split(';')[0]?.trim() ?? null;
  const ok = response.statusCode >= 200 && response.statusCode < 300;
  if (!ok) {
    return {
      statusCode: response.statusCode,
      ok: false,
      uri: null,
      size: 0,
      mimeType,
      errorBody: getResponseText(response).slice(0, 16 * 1024),
      headers,
    };
  }

  const fileUri = toFileUri(destinationPath);
  if (typeof response.body === 'string' && response.isBase64 === true) {
    await FileSystem.writeAsStringAsync(fileUri, response.body, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } else {
    await FileSystem.writeAsStringAsync(fileUri, getResponseText(response), {
      encoding: FileSystem.EncodingType.UTF8,
    });
  }
  const info = await FileSystem.getInfoAsync(fileUri);
  const size = info.exists && 'size' in info && typeof info.size === 'number' ? info.size : 0;

  return {
    statusCode: response.statusCode,
    ok: size > 0,
    uri: fileUri,
    size,
    mimeType,
    errorBody: '',
    headers,
  };
}

export async function mtlsDownloadToFile(
  url: string,
  destinationPath: string,
  options?: { headers?: Record<string, string>; maxJsFallbackBytes?: number },
): Promise<MtlsDownloadResult> {
  if (!isApprovedTransportDestination(url)) {
    throw new Error('Download destination is not allowed');
  }

  const headers = await prepareHeadersForTransport(options?.headers);

  if (shouldUseNativeFileDownload(url) && CertificateModule?.downloadMtlsFile) {
    const nativePath = fileUriToNativePath(destinationPath);
    const result = await CertificateModule.downloadMtlsFile(url, nativePath, headers);
    return {
      statusCode: result.status,
      ok: result.ok === true && typeof result.uri === 'string' && result.uri.length > 0,
      uri: result.uri ?? null,
      size: typeof result.size === 'number' ? result.size : 0,
      mimeType: result.mimeType ?? null,
      errorBody: result.errorBody ?? '',
      headers: result.headers ?? {},
    };
  }

  const maxJsFallbackBytes = options?.maxJsFallbackBytes;
  if (maxJsFallbackBytes === null || maxJsFallbackBytes === undefined) {
    throw new Error('Native streaming download is required. Rebuild the app.');
  }

  const response = await mtlsFetch(url, {
    method: 'GET',
    headers,
  });
  const contentLength = Number.parseInt(headerValue(response.headers, 'content-length') ?? '', 10);
  if (Number.isFinite(contentLength) && contentLength > maxJsFallbackBytes) {
    throw new Error('File is too large to download without native streaming.');
  }
  const written = await writeFetchedBodyToFile(response, destinationPath);
  if (written.size > maxJsFallbackBytes) {
    await FileSystem.deleteAsync(toFileUri(destinationPath), { idempotent: true }).catch(
      () => undefined,
    );
    throw new Error('File is too large to download without native streaming.');
  }
  return written;
}

export async function mtlsFetch(url: string, options?: MtlsFetchOptions): Promise<MtlsResponse> {
  if (!isApprovedTransportDestination(url)) {
    throw new Error('[mTLS] Refusing request to unapproved destination');
  }

  const headers = await prepareHeadersForTransport(options?.headers);

  // Check if body is FormData
  const bodyIsFormData = isFormData(options?.body);
  const formDataPayload = bodyIsFormData
    ? convertFormDataToPayload(options!.body as FormData)
    : null;
  const mtlsEnabled = isMtlsFeatureEnabled();
  const localOrInsecureUrl = isLocalOrInsecureUrl(url);
  const hasNativeRequest = !!CertificateModule?.performMtlsRequest;

  // Android's React Native XHR/Axios multipart path can fail with a generic
  // ERR_NETWORK before the request reaches the backend. The native bridge can
  // also run without client certificates; Android's MtlsNetworkClient only
  // installs mTLS SSL config when BuildConfig.MTLS_ENABLED is true.
  const shouldUseNativeFormDataTransport =
    bodyIsFormData && (Platform.OS === 'android' || (mtlsEnabled && !localOrInsecureUrl));

  if (
    shouldUseNativeFormDataTransport &&
    !options?.allowRepeatedFields &&
    CertificateModule?.performMtlsMultipartUpload
  ) {
    const multipartArgs = convertFormDataToNativeMultipartArgs(options!.body as FormData);
    const multipartResponse = await CertificateModule.performMtlsMultipartUpload(
      url,
      multipartArgs.fields,
      multipartArgs.files,
      headers,
    );
    return {
      statusCode: multipartResponse.status,
      body: multipartResponse.body,
      headers: multipartResponse.headers,
      isBase64: multipartResponse.isBase64 ?? true,
    };
  }

  // Local dev endpoints and builds with mTLS disabled use ordinary HTTPS.
  if (
    (!mtlsEnabled || localOrInsecureUrl) &&
    !(shouldUseNativeFormDataTransport && hasNativeRequest)
  ) {
    // Always request as arraybuffer so binary responses (images, etc.) aren't
    // corrupted by UTF-8 string conversion. Text/JSON responses are decoded
    // back to string based on the response Content-Type.
    const response = await axios({
      url,
      method: options?.method ?? 'GET',
      headers,
      data: options?.body,
      responseType: 'arraybuffer',
      validateStatus: () => true, // Don't throw on non-2xx
      timeout: options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      ...(options?.signal ? { signal: options.signal } : {}),
    });

    const responseContentType = response.headers['content-type'] as string | undefined;
    const isBinary = isBinaryContentType(responseContentType);
    let body: string;
    let isBase64 = false;

    if (isBinary) {
      // Binary data: base64-encode to match native CertificateModule behavior
      const bytes = new Uint8Array(response.data);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]!);
      }
      body = btoa(binary);
      isBase64 = true;
    } else {
      // Text/JSON: decode from arraybuffer to string
      const decoder = new TextDecoder('utf-8');
      body = decoder.decode(new Uint8Array(response.data));
    }

    return {
      statusCode: response.status,
      body,
      headers: response.headers as Record<string, string | string[]>,
      isBase64,
    };
  }

  const requestOptions: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | FormDataPayload;
  } = {
    method: options?.method ?? 'GET',
    headers,
  };

  if (options?.body !== undefined) {
    // If body is FormData, serialize the converted payload as JSON string
    // The New Architecture (TurboModules) doesn't handle nested objects well across the bridge

    if (formDataPayload) {
      requestOptions.body = JSON.stringify({ jsonBody: formDataPayload });
    } else if (typeof options.body === 'string') {
      requestOptions.body = options.body;
    }
  }

  if (bodyIsFormData) {
    // eslint-disable-next-line no-console
    console.warn('[mtlsFetch] Falling back to serialized FormData bridge', {
      url,
      hasNativeMultipart: !!CertificateModule?.performMtlsMultipartUpload,
    });
  }

  const requestId = newRequestId();
  const deadline = withDeadline(options?.signal, options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);

  try {
    return await withNativeAbort(requestId, deadline.signal, () =>
      MtlsHttpClientNative.request(url, { ...requestOptions, requestId }),
    );
  } catch (error) {
    // A deadline abort and a caller abort look identical by the time they get here;
    // only the deadline should surface as a failure.
    if (deadline.didTimeOut()) {
      throw new RequestTimeoutError(`Request to ${url} timed out`);
    }
    throw error;
  } finally {
    deadline.dispose();
  }
}

/**
 * Check if mTLS HTTP client is available.
 */
export function isMtlsHttpClientAvailable(): boolean {
  if (!isMtlsFeatureEnabled()) {
    return false;
  }

  return !!CertificateModule?.performMtlsRequest;
}

const SOCKET_IO_PATH = '/api/socket.io/';

export function isSocketIoRequestUrl(url: string): boolean {
  try {
    return new URL(url).pathname.includes(SOCKET_IO_PATH);
  } catch {
    return url.includes(SOCKET_IO_PATH);
  }
}

function requestInitHeadersToRecord(init?: RequestInit): Record<string, string> {
  const headers: Record<string, string> = {};
  const raw = init?.headers;
  if (!raw) return headers;

  if (raw instanceof Headers) {
    raw.forEach((value, key) => {
      headers[key] = value;
    });
    return headers;
  }

  if (Array.isArray(raw)) {
    for (const [key, value] of raw) {
      headers[key] = value;
    }
    return headers;
  }

  return { ...raw };
}

export async function mtlsFetchAsWebResponse(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const method = (init?.method ?? 'GET').toUpperCase();
  const headers = requestInitHeadersToRecord(init);

  let body: string | undefined;
  if (typeof init?.body === 'string') {
    body = init.body;
  }

  const mtlsMethod =
    method === 'POST' ||
    method === 'PUT' ||
    method === 'PATCH' ||
    method === 'DELETE' ||
    method === 'GET'
      ? method
      : 'GET';

  const result = await mtlsFetch(url, {
    method: mtlsMethod,
    headers,
    ...(body !== undefined ? { body } : {}),
  });

  const responseHeaders = new Headers();
  for (const [key, value] of Object.entries(result.headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        responseHeaders.append(key, entry);
      }
    } else if (typeof value === 'string') {
      responseHeaders.set(key, value);
    }
  }

  const responseBody = result.isBase64
    ? (decodeBase64Bytes(getResponseBase64(result)) as unknown as BodyInit)
    : getResponseText(result);

  return new Response(responseBody, {
    status: result.statusCode,
    headers: responseHeaders,
  });
}
