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
  shredError,
  isSecretKey,
  CLIENT_EVENT_SHRED_OPTIONS,
  type ShredOptions,
} from "./shredder.js";

export { REDACT_CONFIG_KEY, getRedactConfig, setRedactConfig, syncRedactConfig, type RedactConfig } from "./policy.js";

export { SetOnceContext, emptyContext } from "./context.js";
