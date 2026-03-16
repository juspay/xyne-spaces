/**
 * Memory Types
 *
 * Types for memory document based on Vespa memory schema
 */

export const DocType = {
  FACT: 'fact',
  SOP: 'sop',
} as const;

export type DocType = (typeof DocType)[keyof typeof DocType];

/** Memory document type based on Vespa memory schema */
export interface MemoryDocument {
  docId: string;
  docType: DocType;
  userId?: string; // Present only for 'my' scope - backend handles hiding this for 'all' scope
  sessionId: string;
  repoUrl: string;
  commitId: string;
  ticketId: string;
  userQuery: string;
  tags: string[];
  filePointers: string[];
  chatSummary: string[];
  documentType: string;
  createdAt: number; // Unix timestamp (long)
  updatedAt: number; // Unix timestamp (long)
  committedAt: number; // Unix timestamp (long)
  agentUsed: string;
  modelUsed: string[];
  fileStoragePath: string;
  parentRef: string;
  reviewStatus: string;
  // Relevance score from search
  relevanceScore?: number;
}

/** Memory scope toggle options */
export const MemoryScope = {
  MY: 'my',
  ALL: 'all',
} as const;

export type MemoryScope = (typeof MemoryScope)[keyof typeof MemoryScope];

/** UI Filters for memory header component */
export interface MemoryFilters {
  searchQuery: string;
  includeQuery: boolean;
  includeSummary: boolean;
  scope: MemoryScope;
  docTypeFilter: string[];
  tagsFilter: string;
  repoUrlFilter: string;
  commitIdFilter: string;
  sessionIdFilter: string;
  filePointersFilter: string;
  ticketIdFilter: string;
}

/** Filters for memory search */
export interface MemorySearchFilters {
  query?: string; // Text search query
  scope: MemoryScope; // 'my' = current user, 'all' = all users
  limit?: number; // default: 20
  offset?: number; // default: 0
  docType?: DocType;
  tags?: string[];
  repoUrl?: string;
  commitId?: string;
  sessionId?: string;
  filePointers?: string;
  ticketId?: string;
  parentRef?: string;
  reviewStatus?: string;
  includeQuery?: boolean; // Include userQuery in search ranking
  includeSummary?: boolean; // Include chatSummary in search ranking
}

/** API request body */
export interface MemorySearchRequest {
  query?: string | undefined;
  scope: MemoryScope;
  limit: number;
  offset: number;
  docType?: DocType | undefined;
  tags?: string[] | undefined;
  repoUrl?: string | undefined;
  commitId?: string | undefined;
  sessionId?: string | undefined;
  filePointers?: string | undefined;
  ticketId?: string | undefined;
  parentRef?: string | undefined;
  reviewStatus?: string | undefined;
  includeQuery?: boolean | undefined;
  includeSummary?: boolean | undefined;
}

/** API response */
export interface MemorySearchResponse {
  success: boolean;
  data?: {
    documents: MemoryDocument[];
    totalCount: number;
    hasMore: boolean;
  };
  error?: string;
}

/** Partial update request — editable fields only */
export interface MemoryUpdateRequest {
  userQuery?: string | undefined;
  chatSummary?: string[] | undefined;
  tags?: string[] | undefined;
  filePointers?: string[] | undefined;
  commitId?: string | undefined;
  reviewStatus?: string | undefined;
}

/** Single document API response */
export interface MemoryDocumentResponse {
  success: boolean;
  data?: MemoryDocument;
  error?: string;
}

/** Hook input */
export interface UseMemoryInput {
  query?: string | undefined;
  scope: MemoryScope;
  limit?: number;
  offset?: number;
  docType?: DocType | undefined;
  tags?: string[] | undefined;
  repoUrl?: string | undefined;
  commitId?: string | undefined;
  sessionId?: string | undefined;
  filePointers?: string | undefined;
  ticketId?: string | undefined;
  enabled?: boolean;
  debounceMs?: number;
  includeQuery?: boolean;
  includeSummary?: boolean;
}

/** Hook output */
export interface UseMemoryOutput {
  documents: MemoryDocument[];
  totalCount: number;
  hasMore: boolean;
  isLoading: boolean;
  isSearching: boolean;
  error: Error | null;
  refetch: () => void;
}
