/**
 * useMemory Hook
 *
 * React hook for fetching memory documents with reactive filters.
 * Automatically refetches when input filters change.
 */

import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { memoryService } from '../services/Memory/memoryService';
import { useDebouncedValue } from './useDebouncedValue';
import type {
  UseMemoryInput,
  UseMemoryOutput,
  MemorySearchRequest,
  MemoryUpdateRequest,
} from '../types/memory';

const DEFAULT_LIMIT = 15;
const DEFAULT_DEBOUNCE_MS = 500;

export function useMemory(input: UseMemoryInput): UseMemoryOutput {
  const {
    query,
    scope,
    limit = DEFAULT_LIMIT,
    offset = 0,
    docType,
    tags,
    repoUrl,
    commitId,
    sessionId,
    filePointers,
    ticketId,
    enabled = true,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    includeQuery,
    includeSummary,
  } = input;

  // Debounce the query to avoid excessive API calls
  const debouncedQuery = useDebouncedValue(query, debounceMs);

  // Build the search request - only include defined values
  const searchRequest: MemorySearchRequest = useMemo(() => {
    const request: MemorySearchRequest = {
      scope,
      limit,
      offset,
    };

    if (debouncedQuery !== undefined) {
      request.query = debouncedQuery;
    }
    if (docType !== undefined) {
      request.docType = docType;
    }
    if (tags !== undefined) {
      request.tags = tags;
    }
    if (repoUrl !== undefined) {
      request.repoUrl = repoUrl;
    }
    if (commitId !== undefined) {
      request.commitId = commitId;
    }
    if (sessionId !== undefined) {
      request.sessionId = sessionId;
    }
    if (filePointers !== undefined) {
      request.filePointers = filePointers;
    }
    if (ticketId !== undefined) {
      request.ticketId = ticketId;
    }
    if (includeQuery !== undefined) {
      request.includeQuery = includeQuery;
    }
    if (includeSummary !== undefined) {
      request.includeSummary = includeSummary;
    }

    return request;
  }, [
    debouncedQuery,
    scope,
    limit,
    offset,
    docType,
    tags,
    repoUrl,
    commitId,
    sessionId,
    filePointers,
    ticketId,
    includeQuery,
    includeSummary,
  ]);

  // Determine if this is initial load or search
  const isInitialLoad = !query && offset === 0;

  // React Query for fetching memory documents
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['memory', searchRequest],
    queryFn: async () => {
      const result = await memoryService.searchMemory(searchRequest);
      return result;
    },
    enabled,
    staleTime: 30000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
    retry: 2,
  });

  return {
    documents: data?.documents ?? [],
    totalCount: data?.totalCount ?? 0,
    hasMore: data?.hasMore ?? false,
    isLoading: isLoading && isInitialLoad,
    isSearching: isLoading && !isInitialLoad,
    error: error,
    refetch: () => void refetch(),
  };
}

/**
 * Hook for updating a memory document
 */
export function useUpdateMemory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ docId, fields }: { docId: string; fields: MemoryUpdateRequest }) =>
      memoryService.updateMemory(docId, fields),
    onSuccess: () => {
      // Invalidate all memory queries to refetch fresh data
      void queryClient.invalidateQueries({ queryKey: ['memory'] });
    },
  });
}

/**
 * Hook for deleting a memory document
 */
export function useDeleteMemory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (docId: string) => memoryService.deleteMemory(docId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['memory'] });
    },
  });
}

/**
 * Hook for uploading documents (.txt/.md) for async ingestion into Vespa memory.
 */
export function useUploadDocuments() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ files, repoUrl }: { files: File[]; repoUrl: string }) =>
      memoryService.uploadDocuments(files, repoUrl),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['memory'] });
    },
  });
}

/**
 * Hook for deleting all Vespa memory docs for the given session IDs.
 */
export function useDeleteBySessionIds() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sessionIds: string[]) => memoryService.deleteBySessionIds(sessionIds),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['memory'] });
    },
  });
}

/**
 * Hook for wiping ALL documents from the Vespa memory schema.
 */
export function useCleanupAllVespaMemory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => memoryService.cleanupAllVespaMemory(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['memory'] });
    },
  });
}
