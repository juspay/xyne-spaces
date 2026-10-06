/**
 * Agent index pipeline.
 *
 *   render  →  agent row becomes documents        (render.ts, pure)
 *   sync    →  documents replace what the bank holds (sync.ts)
 *   search  →  a need becomes ranked agents        (search.ts)
 *   status  →  bank contents versus the roster     (status.ts)
 *
 * `bank.ts` owns bank identity and the one-time configuration that makes the
 * bank a plain vector store rather than a fact store.
 */
export { agentIndexBankConfig, agentIndexBankId, ensureAgentIndexBank, memory, resetBankCache } from "./bank.js";
export {
  renderAgentBlobs,
  isIndexable,
  toolNames,
  capabilityPhrases,
  hashContent,
  hashTag,
  readAgentTag,
  readKindTag,
  tagsFor,
} from "./render.js";
export type { AgentRow } from "./render.js";
export {
  listAllBankEntries,
  listBankEntries,
  rebuildOrgIndex,
  removeAgentFromIndex,
  syncAgentToIndex,
  syncAgentToIndexBestEffort,
} from "./sync.js";
export { findAgents, rankByAgent } from "./search.js";
export { agentIndexDetail, groupIntoDocuments, orgIndexCoverage } from "./status.js";
export { INDEX_KINDS } from "./types.js";
export type { AgentIndexStatus, AgentMatch, IndexBlob, IndexDocument, IndexKind, StoredBlob, SyncOutcome } from "./types.js";
