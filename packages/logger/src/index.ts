// @xyne/logger — typed, secret-shredding logging core (PRD).
// Node-only ALS context lives at @xyne/logger/node.
export type {
  LogValue,
  SecretKey,
  ForbidSecrets,
  LogPayload,
  LogLevel,
  Logger,
  ContextProvider,
} from "./types.js";

export {
  shred,
  shredText,
  shredRecordInPlace,
  isSecretKey,
  type ShredOptions,
} from "./shredder.js";

export { SetOnceContext, emptyContext } from "./context.js";
