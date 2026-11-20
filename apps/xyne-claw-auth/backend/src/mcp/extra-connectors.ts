import type { ExtraConnectors } from "./extra-connectors.types.js";

export type { EnvCredentials, ExtraConnectors } from "./extra-connectors.types.js";

/** Additional MCP connectors. None by default. */
export const EXTRA_CONNECTORS: ExtraConnectors = {
  adapters: {},
  sharedToolListTypes: [],
  platformInternalTypes: [],
  globalConnectors: [],
  envCredentials: () => undefined,
};
