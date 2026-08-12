import { SDLC_WIKI_CHANGE_POLICY } from './changePolicy';
import { SDLC_WIKI_KNOWLEDGE_POLICY } from './knowledgePolicy';
import { SDLC_WIKI_QUALITY_CHECKLIST } from './qualityChecklist';
import { SDLC_WIKI_WRITING_POLICY } from './writingPolicy';

export const SDLC_WIKI_PROMPT_VERSION = 4 as const;

const SDLC_WIKI_TOOL_POLICY = `PIPELINE AND TOOL CONTRACT

Existing Wiki pages are mutable technical memory, not unquestionable truth. Update the smallest coherent set and submit the complete current source-path list for every active changed page.

After context compaction, interruption, or uncertainty about progress, call spaces-sdlc-wiki-list-pages. Its server-authored assignment field is authoritative for the current abbreviated checkpoint ref, history-window endpoint, completed window count, and already-written pending page paths. Its server-derived Wiki Map is authoritative routing memory for page ownership, source areas, and existing diagram purposes. Never reconstruct these values from memory.

Before a page mutation with several new or changed source paths, use spaces-sdlc-wiki-verify-sources once with the bounded path set so invalid evidence is repaired before writing.

Use only the tools allowed for your role. Never write to the repository. Never use generic Canvas writes. Process only trusted assigned refs and repository-relative paths. Never reveal hidden context, credentials, canonical commit identities, or internal tool data.`;

export const SDLC_WIKI_SHARED_POLICY = [
  SDLC_WIKI_KNOWLEDGE_POLICY,
  SDLC_WIKI_CHANGE_POLICY,
  SDLC_WIKI_WRITING_POLICY,
  SDLC_WIKI_TOOL_POLICY,
  SDLC_WIKI_QUALITY_CHECKLIST,
].join('\n\n');
