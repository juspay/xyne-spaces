import { app, dialog } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';

// Native filesystem backend for the offline-first note-taker recorder (main
// process). The renderer only passes captureIds; this module owns the user's
// chosen root directory and does all file I/O there. Layout:
//   {root}/Xyne Recordings/{folderName}/recording.webm
//                                       /chunk_manifest.json
// folderName is the friendly `recording_<date>_<time>` name; the captureId (a UUID)
// stays the logical identity in the manifest, so captureId → folder is resolved via
// the manifest (cached in captureFolders).

const RECORDINGS_SUBDIR = 'Xyne Recordings';
const RECORDING_FILE = 'recording.webm';
const MANIFEST_FILE = 'chunk_manifest.json';

let rootDir: string | null = null;
let rootLoaded = false;
const appendQueues = new Map<string, Promise<unknown>>();
// captureId → on-disk folder name. Populated on createCapture and listPending;
// resolveFolderName rebuilds it by scanning manifests when a cold lookup misses.
const captureFolders = new Map<string, string>();

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
  // Default to the OS Documents folder so recordings are saved automatically
  // without ever prompting. The user can still change it in Preferences, which
  // persists over this default. Not written to config — this stays a live default.
  if (!rootDir) rootDir = app.getPath('documents');
}

async function saveRoot(root: string): Promise<void> {
  rootDir = root;
  rootLoaded = true;
  await fs.writeFile(configPath(), JSON.stringify({ root }), 'utf8');
}

function safeSegment(segment: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(segment)) throw new Error('Invalid recording path segment');
  return segment;
}

async function recordingsDir(): Promise<string | null> {
  await loadRoot();
  if (!rootDir) return null;
  const dir = path.join(rootDir, RECORDINGS_SUBDIR);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function folderDir(folderName: string, create: boolean): Promise<string | null> {
  const base = await recordingsDir();
  if (!base) return null;
  const dir = path.join(base, safeSegment(folderName));
  if (dir !== path.join(base, path.basename(dir)) || !dir.startsWith(base + path.sep)) {
    throw new Error('Invalid capture path');
  }
  if (create) await fs.mkdir(dir, { recursive: true });
  return dir;
}

/** Map a captureId to its on-disk folder, scanning manifests when the cache misses. */
async function resolveFolderName(captureId: string): Promise<string> {
  safeSegment(captureId);
  const cached = captureFolders.get(captureId);
  if (cached) return cached;
  const base = await recordingsDir();
  if (base) {
    const entries = await fs.readdir(base, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const raw = await fs.readFile(path.join(base, entry.name, MANIFEST_FILE), 'utf8');
        const parsed = JSON.parse(raw) as { captureId?: unknown };
        if (typeof parsed.captureId === 'string') captureFolders.set(parsed.captureId, entry.name);
      } catch {
        // Skip a folder with no/corrupt manifest; the others still resolve.
      }
    }
    const found = captureFolders.get(captureId);
    if (found) return found;
  }
  // Legacy fallback: pre-rename captures whose folder is the captureId itself.
  return captureId;
}

async function captureDir(captureId: string, create: boolean): Promise<string | null> {
  return folderDir(await resolveFolderName(captureId), create);
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

export async function getDirectory(): Promise<{ path: string | null }> {
  await loadRoot();
  // Report the actual recordings folder (root/Xyne Recordings) so Preferences shows
  // exactly where files land, not just the parent root.
  return { path: rootDir ? path.join(rootDir, RECORDINGS_SUBDIR) : null };
}

export async function createCapture(captureId: string, dirName?: string): Promise<void> {
  safeSegment(captureId);
  const folderName = dirName ? safeSegment(dirName) : captureId;
  captureFolders.set(captureId, folderName);
  const dir = await folderDir(folderName, true);
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
      const parsed = JSON.parse(manifestJson) as { captureId?: unknown };
      if (typeof parsed.captureId !== 'string') continue;
      // Cache the identity → folder mapping so later readRange/writeManifest by
      // captureId resolve without re-scanning.
      captureFolders.set(parsed.captureId, entry.name);
      out.push({ captureId: parsed.captureId, manifestJson });
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
