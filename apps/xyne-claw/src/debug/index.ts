/**
 * Debug tracing — public surface.
 *
 * Callers (agent.ts, subagent-tools.ts, routes/debug.ts) import from here and
 * never reach into the individual modules, so the internal split can change
 * without touching the run loop.
 *
 * The shape of the whole thing:
 *
 *   record()  →  Recorder  →  RunStore   (events.jsonl, append-only)
 *                    ↓
 *               BlobWriter →  RunStore   (blobs.jsonl, content-addressed)
 *
 *   readRun() →  materialize →  the v1 snapshot every existing reader expects
 */

export * from "./types.js";
export {
  EVENTS,
  LEGACY_EVENT_KINDS,
  isKnownKind,
  specFor,
  policyFor,
  plain,
  ref,
  range,
  drop,
  type DebugEventKind,
  type EventSpec,
  type FieldPolicy,
} from "./registry.js";
export * from "./keys.js";
export {
  BlobWriter,
  BlobIndex,
  hashContent,
  serializeForBlob,
  BLOB_MAX_BYTES,
  BLOB_GZIP_OVER,
  type BlobLine,
} from "./blobs.js";
export {
  RunStore,
  readRun,
  listRunDirs,
  packRun,
  unpackRun,
  debugDirFor,
  type ReadRun,
  type RunStoreOpts,
} from "./store.js";
export { Recorder, type RecorderOpts } from "./recorder.js";
export {
  toV1Snapshot,
  toV1Events,
  toV2Run,
  deriveToolInvocations,
  replayMessages,
} from "./materialize.js";
export {
  startCapture,
  installStreamCapture,
  parseAvailableSkills,
  paletteDiff,
  resolveCaptureLevel,
  type StartCaptureOpts,
  type CaptureHandles,
  type AvailableSkill,
} from "./capture.js";
