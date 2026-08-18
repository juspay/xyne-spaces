import { createElectronStore } from './electronStore';
import { createFsaStore } from './fsaStore';
import { createOpfsStore } from './opfsStore';
import type { RecordingArchiveStore } from './types';

let selected: RecordingArchiveStore | null | undefined;

/**
 * Pick the best available archive backend, once per session:
 * Electron native FS → web File System Access API → OPFS fallback.
 * Returns null only when none is available (recording cannot be persisted).
 */
export function selectRecordingArchiveStore(): RecordingArchiveStore | null {
  if (selected !== undefined) return selected;
  selected = createElectronStore() ?? createFsaStore() ?? createOpfsStore();
  return selected;
}

export * from './types';
export {
  MANIFEST_FILE,
  RECORDING_FILE,
  createManifest,
  computeManifestHash,
  sha256Hex,
  manifestByteLength,
  lastDurableEndedAtMs,
} from './clientManifest';
