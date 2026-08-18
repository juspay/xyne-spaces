import { app, dialog } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';

// Native filesystem backend for the offline-first note-taker recorder (main
// process). The renderer only passes captureIds; this module owns the user's
// chosen root directory and does all file I/O there. Layout:
//   {root}/Xyne Recordings/{captureId}/recording.webm
//                                     /chunk_manifest.json

const RECORDINGS_SUBDIR = 'Xyne Recordings';
const RECORDING_FILE = 'recording.webm';
const MANIFEST_FILE = 'chunk_manifest.json';

// Only ever PUT recording bytes to object-storage hosts. The signed URL comes
// from our backend, but validate here too so a compromised renderer cannot use
// the main process to exfiltrate audio to an arbitrary host.
function isAllowedUploadUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname;
    return (
      host === 'storage.googleapis.com' ||
      host.endsWith('.googleapis.com') ||
      host.endsWith('.amazonaws.com')
    );
  } catch {
    return false;
  }
}

let rootDir: string | null = null;
let rootLoaded = false;
const appendQueues = new Map<string, Promise<unknown>>();

function configPath(): string {
  return path.join(app.getPath('userData'), 'recording-fs.json');
}

async function loadRoot(): Promise<void> {
  if (rootLoaded) return;
  rootLoaded = true;
  try {
    const parsed = JSON.parse(await fs.readFile(configPath(), 'utf8')) as { root?: unknown };
    if (typeof parsed.root === 'string') rootDir = parsed.root;
  } catch {
    rootDir = null;
  }
}

async function saveRoot(root: string): Promise<void> {
  rootDir = root;
  rootLoaded = true;
  await fs.writeFile(configPath(), JSON.stringify({ root }), 'utf8');
}

function safeCaptureId(captureId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(captureId)) throw new Error('Invalid capture id');
  return captureId;
}

async function recordingsDir(): Promise<string | null> {
  await loadRoot();
  if (!rootDir) return null;
  const dir = path.join(rootDir, RECORDINGS_SUBDIR);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function captureDir(captureId: string, create: boolean): Promise<string | null> {
  const base = await recordingsDir();
  if (!base) return null;
  const dir = path.join(base, safeCaptureId(captureId));
  if (dir !== path.join(base, path.basename(dir)) || !dir.startsWith(base + path.sep)) {
    throw new Error('Invalid capture path');
  }
  if (create) await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function pickDirectory(): Promise<{ granted: boolean }> {
  const result = await dialog.showOpenDialog({
    title: 'Choose a folder to save your recordings',
    properties: ['openDirectory', 'createDirectory'],
  });
  const picked = result.filePaths[0];
  if (result.canceled || !picked) return { granted: false };
  await saveRoot(picked);
  return { granted: true };
}

export async function hasDirectory(): Promise<boolean> {
  await loadRoot();
  if (!rootDir) return false;
  try {
    return (await fs.stat(rootDir)).isDirectory();
  } catch {
    return false;
  }
}

export async function createCapture(captureId: string): Promise<void> {
  const dir = await captureDir(captureId, true);
  if (!dir) throw new Error('No recording directory configured');
  await fs.writeFile(path.join(dir, RECORDING_FILE), Buffer.alloc(0), { flag: 'w' });
}

function enqueueAppend<T>(captureId: string, op: () => Promise<T>): Promise<T> {
  const prev = appendQueues.get(captureId) ?? Promise.resolve();
  const run = prev.then(op, op);
  appendQueues.set(
    captureId,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

export async function appendFragment(
  captureId: string,
  bytes: ArrayBuffer,
): Promise<{ byteOffset: number; byteLength: number }> {
  return enqueueAppend(captureId, async () => {
    const dir = await captureDir(captureId, false);
    if (!dir) throw new Error('No recording directory configured');
    const file = path.join(dir, RECORDING_FILE);
    const buffer = Buffer.from(bytes);
    let byteOffset = 0;
    try {
      byteOffset = (await fs.stat(file)).size;
    } catch {
      byteOffset = 0;
    }
    const handle = await fs.open(file, 'a');
    try {
      await handle.write(buffer);
      await handle.sync();
    } finally {
      await handle.close();
    }
    return { byteOffset, byteLength: buffer.byteLength };
  });
}

export async function writeManifest(captureId: string, manifestJson: string): Promise<void> {
  const dir = await captureDir(captureId, true);
  if (!dir) throw new Error('No recording directory configured');
  const file = path.join(dir, MANIFEST_FILE);
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, manifestJson, 'utf8');
  await fs.rename(tmp, file);
}

export async function readRange(
  captureId: string,
  byteOffset: number,
  byteLength: number,
): Promise<ArrayBuffer> {
  const dir = await captureDir(captureId, false);
  if (!dir) throw new Error('No recording directory configured');
  const handle = await fs.open(path.join(dir, RECORDING_FILE), 'r');
  try {
    const buffer = Buffer.alloc(byteLength);
    const { bytesRead } = await handle.read(buffer, 0, byteLength, byteOffset);
    const view = buffer.subarray(0, bytesRead);
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  } finally {
    await handle.close();
  }
}

export async function finalize(_captureId: string): Promise<void> {
  // The manifest's `completed` flag (written by the renderer) is the source of
  // truth; no move is needed for the in-directory layout.
}

export async function listPending(): Promise<Array<{ captureId: string; manifestJson: string }>> {
  const base = await recordingsDir();
  if (!base) return [];
  const entries = await fs.readdir(base, { withFileTypes: true }).catch(() => []);
  const out: Array<{ captureId: string; manifestJson: string }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const manifestJson = await fs.readFile(path.join(base, entry.name, MANIFEST_FILE), 'utf8');
      out.push({ captureId: entry.name, manifestJson });
    } catch {
      // Skip a capture with no/corrupt manifest; the others still recover.
    }
  }
  return out;
}

export async function deleteCapture(captureId: string): Promise<void> {
  const dir = await captureDir(captureId, false);
  if (!dir) return;
  await fs.rm(dir, { recursive: true, force: true });
}

export async function freeSpace(): Promise<{ availableBytes: number | null }> {
  await loadRoot();
  if (!rootDir) return { availableBytes: null };
  try {
    const stats = await fs.statfs(rootDir);
    return { availableBytes: stats.bavail * stats.bsize };
  } catch {
    return { availableBytes: null };
  }
}

export async function putChunk(args: {
  url: string;
  captureId: string;
  byteOffset: number;
  byteLength: number;
  contentType: string;
}): Promise<{ status: number }> {
  if (!isAllowedUploadUrl(args.url)) throw new Error('Upload host not allowed');
  const body = Buffer.from(await readRange(args.captureId, args.byteOffset, args.byteLength));
  const response = await fetch(args.url, {
    method: 'PUT',
    headers: { 'Content-Type': args.contentType },
    body,
  });
  return { status: response.status };
}

export async function putManifest(captureId: string, url: string): Promise<{ status: number }> {
  if (!isAllowedUploadUrl(url)) throw new Error('Upload host not allowed');
  const dir = await captureDir(captureId, false);
  if (!dir) throw new Error('No recording directory configured');
  const body = await fs.readFile(path.join(dir, MANIFEST_FILE));
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  return { status: response.status };
}
