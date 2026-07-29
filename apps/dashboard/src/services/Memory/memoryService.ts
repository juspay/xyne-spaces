/**
 * Memory Service
 *
 * API functions for memory document retrieval from Vespa
 */

import { apiInstance } from '../clients/apiClient';
import {
  MemoryDocument,
  MemorySearchRequest,
  MemorySearchResponse,
  MemoryUpdateRequest,
  MemoryDocumentResponse,
} from '../../types/memory';

export interface DocumentUploadResult {
  filename: string;
  sessionId: string;
  status: string;
}

export interface DocumentUploadResponse {
  success: boolean;
  files: DocumentUploadResult[];
  rejected?: string[];
  rejectedReason?: string;
}

export class MemoryService {
  private baseUrl = '/memory';

  /**
   * Search memory documents with filters
   * @param request - Search request with filters
   * @returns Paginated memory documents
   */
  async searchMemory(request: MemorySearchRequest): Promise<{
    documents: MemoryDocument[];
    totalCount: number;
    hasMore: boolean;
  }> {
    const response = await apiInstance.post<MemorySearchResponse>(
      `${this.baseUrl}/search`,
      request,
    );

    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error || 'Memory search failed');
    }

    return response.data.data;
  }

  /**
   * Delete a memory document
   * @param docId - Document ID to delete
   */
  async deleteMemory(docId: string): Promise<void> {
    await apiInstance.delete(`${this.baseUrl}/${docId}`);
  }

  /**
   * Update a memory document (partial update)
   * @param docId - Document ID to update
   * @param fields - Fields to update
   * @returns Updated memory document
   */
  async updateMemory(docId: string, fields: MemoryUpdateRequest): Promise<MemoryDocument> {
    const response = await apiInstance.patch<MemoryDocumentResponse>(
      `${this.baseUrl}/${docId}`,
      fields,
    );

    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error || 'Failed to update memory document');
    }

    return response.data.data;
  }

  /**
   * Upload one or more .txt/.md files for document ingestion.
   * Files are stored in GCS under memoryDocuments/ and queued for async processing into Vespa memory.
   * @param files - Array of File objects (only .txt and .md accepted)
   * @param repoUrl - Repository URL to scope the ingested knowledge (required)
   * @returns Upload results per file including sessionIds
   */
  async uploadDocuments(files: File[], repoUrl: string): Promise<DocumentUploadResponse> {
    const formData = new FormData();
    for (const file of files) {
      formData.append('files', file);
    }
    formData.append('repoUrl', repoUrl);
    const response = await apiInstance.post<DocumentUploadResponse>(
      `${this.baseUrl}/upload`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return response.data;
  }

  /**
   * Delete all Vespa memory documents for the specified session IDs.
   * Requires MEMORY ADMIN permission.
   * @param sessionIds - List of session UUIDs to delete
   */
  async deleteBySessionIds(sessionIds: string[]): Promise<void> {
    await apiInstance.delete(`${this.baseUrl}/sessions`, {
      data: { sessionIds },
    });
  }

  /**
   * Cleanup — permanently deletes ALL documents from the Vespa memory schema.
   * Requires MEMORY ADMIN permission. This is irreversible and affects all users.
   */
  async cleanupAllVespaMemory(): Promise<void> {
    await apiInstance.delete(`${this.baseUrl}/vespa-memory`);
  }
}

export const memoryService = new MemoryService();
