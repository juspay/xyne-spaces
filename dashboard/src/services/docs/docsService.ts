import { apiInstance } from '../clients/apiClient';

// XYNE-1287: Quarto docs are now stored as Canvas records with docType='Quarto'
// This service is kept for utility functions only. Docs are fetched via Zero queries.

export interface QuartoDoc {
  id: string;
  userRepo: string;
  repoId: string | null;
  branchName: string | null;
  repoUrl: string | null;
  channelId: string | null;
  title: string;
  entryFile: string | null;
  quartoDocumentType: string | null;
  createdBy: string;
  lastEditedBy: string | null;
  lastEditedAt: number | null;
  gcsPath: string | null;
  createdAt: number;
  updatedAt: number;
}

export class DocsService {
  getDocViewUrl(userRepo: string): string {
    return `/docs/${userRepo}`;
  }

  async deleteDoc(docId: string): Promise<void> {
    await apiInstance.delete(`/docs/${docId}`);
  }
}

export const docsService = new DocsService();
