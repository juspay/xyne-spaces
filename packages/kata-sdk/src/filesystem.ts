import { Buffer } from "node:buffer";
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
