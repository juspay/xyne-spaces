import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import type { Session } from "./session.js";
import type { FileEntry } from "./types.js";

interface ListEntryResponse {
  name?: unknown;
  size?: unknown;
  type?: unknown;
  mod_time?: unknown;
}

interface ValidListEntryResponse {
  name: string;
  size: number;
  type: "file" | "directory";
  mod_time: number;
}

interface ExistsResponse {
  exists?: unknown;
}

function normalizePath(targetPath: string): string {
  const trimmed = targetPath.trim();
  if (trimmed.length === 0) {
    return ".";
  }

  return trimmed.replace(/^\/+/, "");
}

function requirePath(targetPath: string): string {
  const normalizedPath = normalizePath(targetPath);
  if (normalizedPath === ".") {
    throw new Error("Path must be a non-empty string.");
  }

  return normalizedPath;
}

function encodePath(targetPath: string): string {
  return encodeURIComponent(targetPath);
}

export class FilesystemModule {
  constructor(private readonly session: Session) {}

  async write(path: string, content: string | Buffer): Promise<void> {
    const targetPath = requirePath(path);
    const absolutePath = targetPath.startsWith("/") ? targetPath : `/${targetPath}`;
    const isBuffer = Buffer.isBuffer(content);
    const encoded = isBuffer ? content.toString("base64") : Buffer.from(content, "utf8").toString("base64");

    await this.session.request("/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: absolutePath, content: encoded, encoding: "base64" }),
    });
  }

  /**
   * Write a large file without buffering it in the SDK, router, or workspace
   * agent as one request. The source is split into bounded chunks; each chunk
   * uses the existing /write endpoint, is appended to the destination by a
   * fixed shell command, then immediately removed.
   *
   * DESTRUCTIVE CONTRACT: the destination is truncated to zero bytes as soon
   * as the call starts, and on ANY failure both the part file AND the
   * destination are deleted — the caller gets the thrown error and no file,
   * never partial content. Do not point this at a file whose current content
   * must survive a failed overwrite; write to a temp path and move instead.
   *
   * This deliberately needs no sandbox egress and no workspace-image change.
   */
  async writeStream(
    path: string,
    source: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>,
    options: { maxBytes?: number; chunkBytes?: number } = {},
  ): Promise<{ bytesWritten: number }> {
    const targetPath = requirePath(path);
    const absolutePath = targetPath.startsWith("/") ? targetPath : `/${targetPath}`;
    const maxBytes = options.maxBytes ?? 1024 * 1024 * 1024;
    const chunkBytes = options.chunkBytes ?? 4 * 1024 * 1024;
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("maxBytes must be a positive safe integer.");
    if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0 || chunkBytes > 16 * 1024 * 1024) {
      throw new Error("chunkBytes must be between 1 byte and 16 MiB.");
    }

    const quote = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`;
    const uploadId = randomUUID().replace(/-/g, "");
    const partPath = `${absolutePath}.upload-${uploadId}.part`;
    let bytesWritten = 0;
    let pendingParts: Buffer<ArrayBufferLike>[] = [];
    let pendingBytes = 0;

    const iterable: AsyncIterable<Uint8Array> = Symbol.asyncIterator in Object(source)
      ? source as AsyncIterable<Uint8Array>
      : {
          async *[Symbol.asyncIterator]() {
            const reader = (source as ReadableStream<Uint8Array>).getReader();
            // Mirror native async iteration: on ANY early exit — a read error
            // OR the consumer aborting mid-iteration (generator return()) —
            // cancel the source so e.g. an underlying HTTP body releases its
            // connection instead of wedging until an external timeout. Both
            // paths land in `finally` with drained still false.
            let drained = false;
            try {
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value) yield value;
              }
              drained = true;
            } finally {
              if (!drained) await reader.cancel().catch(() => undefined);
              reader.releaseLock();
            }
          },
        };

    const append = async (chunk: Buffer): Promise<void> => {
      if (bytesWritten + chunk.length > maxBytes) {
        throw new Error(`Stream exceeds maximum size of ${maxBytes} bytes.`);
      }
      await this.write(partPath, chunk);
      const appended = await this.session.commands.run(
        `cat ${quote(partPath)} >> ${quote(absolutePath)} && rm -f -- ${quote(partPath)}`,
        60_000,
      );
      if (appended.exitCode !== 0) {
        throw new Error(appended.stderr.trim() || appended.stdout.trim() || "Sandbox chunk append failed.");
      }
      bytesWritten += chunk.length;
    };

    const initialized = await this.session.commands.run(`: > ${quote(absolutePath)}`, 15_000);
    if (initialized.exitCode !== 0) {
      throw new Error(initialized.stderr.trim() || initialized.stdout.trim() || "Sandbox file initialization failed.");
    }
    try {
      for await (const value of iterable) {
        const incoming = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
        let offset = 0;
        while (offset < incoming.length) {
          const take = Math.min(chunkBytes - pendingBytes, incoming.length - offset);
          pendingParts.push(incoming.subarray(offset, offset + take));
          pendingBytes += take;
          offset += take;
          if (pendingBytes === chunkBytes) {
            await append(Buffer.concat(pendingParts, pendingBytes));
            pendingParts = [];
            pendingBytes = 0;
          }
        }
      }
      if (pendingBytes > 0) await append(Buffer.concat(pendingParts, pendingBytes));
      return { bytesWritten };
    } catch (error) {
      await this.session.commands.run(
        `rm -f -- ${quote(partPath)} ${quote(absolutePath)}`,
        15_000,
      ).catch(() => undefined);
      throw error;
    }
  }

  async read(path: string): Promise<Buffer> {
    const targetPath = requirePath(path);
    const absolutePath = targetPath.startsWith("/") ? targetPath : `/${targetPath}`;
    const response = await this.session.requestJson<{ content: string; encoding: string }>(
      `/read?path=${encodeURIComponent(absolutePath)}`,
      { method: "GET" },
    );
    return Buffer.from(response.content, "base64");
  }

  async list(path: string): Promise<FileEntry[]> {
    const targetPath = normalizePath(path);
    const suffix = targetPath === "." ? "" : `/${encodePath(targetPath)}`;
    const response = await this.session.requestJson<unknown>(`/list${suffix}`, {
      method: "GET",
    });

    if (!Array.isArray(response)) {
      throw new Error("Sandbox returned an invalid file listing response.");
    }

    return response.map((entry) => mapFileEntry(entry));
  }

  async exists(path: string): Promise<boolean> {
    const targetPath = normalizePath(path);
    const suffix = targetPath === "." ? "" : `/${encodePath(targetPath)}`;
    const response = await this.session.requestJson<ExistsResponse>(`/exists${suffix}`, {
      method: "GET",
    });

    return response.exists === true;
  }
}

function mapFileEntry(entry: unknown): FileEntry {
  if (!isListEntryResponse(entry)) {
    throw new Error("Sandbox returned an invalid file entry.");
  }

  return {
    name: entry.name,
    size: entry.size,
    type: entry.type,
    modTime: entry.mod_time,
  };
}

function isListEntryResponse(entry: unknown): entry is ValidListEntryResponse {
  if (typeof entry !== "object" || entry === null) {
    return false;
  }

  const candidate = entry as ListEntryResponse;
  return typeof candidate.name === "string"
    && typeof candidate.size === "number"
    && (candidate.type === "file" || candidate.type === "directory")
    && typeof candidate.mod_time === "number";
}
