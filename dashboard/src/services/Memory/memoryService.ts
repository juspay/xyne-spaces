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
}

export const memoryService = new MemoryService();
