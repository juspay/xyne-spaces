/**
 * Knowledge Service - API functions for knowledge document management
 */

import { apiInstance } from '../clients/apiClient';

export interface ApproveKnowledgeResponse {
  success: boolean;
  alreadyApproved?: boolean;
  message: string;
  documentIds?: string[];
}

export interface KnowledgeDocument {
  id: string;
  projectId: string;
  repositoryUrl: string | null;
  title: string;
  content: string;
  approvedBy: string;
  approvedAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Approve a knowledge canvas and create a KnowledgeDocument
 * @param viewAccessId - The canvas view access ID (from URL)
 * @returns Approval result with success status and document IDs
 */
export async function approveKnowledgeCanvas(
  viewAccessId: string,
): Promise<ApproveKnowledgeResponse> {
  const response = await apiInstance.post<ApproveKnowledgeResponse>('/knowledge/approve', {
    viewAccessId,
  });
  return response.data;
}

/**
 * Get knowledge documents for a project
 * @param projectId - The project ID to get documents for
 * @param options - Optional filters (repositoryUrl, limit, offset)
 */
export async function getKnowledgeDocuments(
  projectId: string,
  options?: {
    repositoryUrl?: string;
    limit?: number;
    offset?: number;
  },
): Promise<KnowledgeDocument[]> {
  const params = new URLSearchParams({ projectId });
  if (options?.repositoryUrl) params.append('repositoryUrl', options.repositoryUrl);
  if (options?.limit) params.append('limit', options.limit.toString());
  if (options?.offset) params.append('offset', options.offset.toString());

  const response = await apiInstance.get<{ documents: KnowledgeDocument[] }>(
    `/knowledge/documents?${params.toString()}`,
  );
  return response.data.documents;
}

/**
 * Delete a knowledge document
 * @param documentId - The document ID to delete
 */
export async function deleteKnowledgeDocument(documentId: string): Promise<void> {
  await apiInstance.delete(`/knowledge/documents/${documentId}`);
}
