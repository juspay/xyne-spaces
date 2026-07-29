/**
 * Research Agent Shared Types
 * Used by both frontend (dashboard) and backend for research agent functionality
 */

export interface ResearchProduct {
  id: string;
  name: string;
}

export interface ResearchRepository {
  id: string;
  name: string;
}

/**
 * Research context for product/repository selection
 * Used by frontend to pass selected context to backend
 */
export interface ResearchContext {
  type: 'product' | 'repository';
  id?: string;
  name: string;
}
