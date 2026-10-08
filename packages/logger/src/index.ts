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
  CLIENT_EVENT_SHRED_OPTIONS,
  type ShredOptions,
} from "./shredder.js";

export {
  REDACT_ALLOW_CONFIG_KEY,
  parseRedactAllowList,
  getRedactAllowList,
  setRedactAllowList,
  syncRedactAllowList,
  type RedactAllowList,
  type RedactAllowSyncOptions,
} from "./policy.js";

export { SetOnceContext, emptyContext } from "./context.js";
