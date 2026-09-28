/**
 * Tool index pipeline.
 *
 *   render  →  a `tools` row becomes a document      (render.ts, pure)
 *   sync    →  documents replace what the bank holds (sync.ts)
 *   search  →  a need becomes ranked tools           (search.ts)
 *
 * `bank.ts` owns bank identity and the one-time configuration that makes the
 * bank a plain vector store rather than a fact store.
 */
export { ensureToolIndexBank, memoryEnabled, resetToolBankCache, toolIndexBankConfig, toolIndexBankId } from "./bank.js";
export { classifyToolRisk } from "xyne-claw-shared";
export {
  extractParams,
  integrationOf,
  readToolTag,
  renderToolBlob,
  renderToolDoc,
  toolTag,
  toolTags,
} from "./render.js";
export {
  rebuildToolIndex,
  removeToolFromIndex,
  removeToolFromIndexBestEffort,
  syncToolsToIndex,
  syncToolsToIndexBestEffort,
} from "./sync.js";
export { listTools, rankBySlug, searchTools } from "./search.js";
export type { SearchToolsOpts } from "./search.js";
export { TOOL_INDEX_KINDS } from "./types.js";
export type { RiskLevel, ToolBlob, ToolMatch, ToolParam, ToolRow, ToolSyncOutcome } from "./types.js";
