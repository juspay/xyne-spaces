/**
 * A `multipart/form-data` body produced as it is sent.
 *
 * `FormData` + `Blob` would be shorter but both want the bytes in hand, which
 * would mean reading an attachment fully into memory to upload it. Here the
 * file parts are piped straight from storage.
 */

import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import type { Attachment } from '../../../common/attachment.js';

export interface MultipartField {
  key: string;
  value: string;
}

export interface MultipartFile {
  key: string;
  attachment: Attachment;
}

/** RFC 7578 says quote it and escape quotes; browsers also strip CR/LF. */
function quoted(value: string): string {
  return value.replace(/[\r\n]/g, ' ').replace(/"/g, '%22');
}

export interface MultipartBody {
  body: Readable;
  contentType: string;
}

export function multipartBody(
  fields: readonly MultipartField[],
  files: readonly MultipartFile[],
  open: (attachment: Attachment) => Promise<NodeJS.ReadableStream>,
): MultipartBody {
  const boundary = `----xyne${randomBytes(16).toString('hex')}`;

  async function* parts(): AsyncGenerator<Buffer> {
    for (const field of fields) {
      yield Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${quoted(field.key)}"\r\n\r\n`,
      );
      yield Buffer.from(field.value);
      yield Buffer.from('\r\n');
    }

    for (const file of files) {
      const { attachment } = file;
      yield Buffer.from(
        `--${boundary}\r\n`
        + `Content-Disposition: form-data; name="${quoted(file.key)}"; `
        + `filename="${quoted(attachment.name)}"\r\n`
        + `Content-Type: ${attachment.mimeType}\r\n\r\n`,
      );
      for await (const chunk of await open(attachment)) {
        yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string | Uint8Array);
      }
      yield Buffer.from('\r\n');
    }

    yield Buffer.from(`--${boundary}--\r\n`);
  }

  return {
    body: Readable.from(parts()),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}
