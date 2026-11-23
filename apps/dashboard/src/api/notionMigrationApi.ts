import { apiInstance } from '../services/clients/apiClient';

// Served by the backend at /api/notion-migration/*.
const BASE = '/notion-migration';

export type NotionImportStatus =
  | 'collecting'
  | 'awaiting_review'
  | 'ingesting'
  | 'completed'
  | 'failed';

/** The importer's access choice for one top-level Notion page (and everything under it). */
export type NotionSectionChoice = 'public' | 'private-owner' | 'private-me' | 'skip';

export interface NotionSection {
  key: string;
  title: string;
  pages: number;
  databases: number;
  notionOwner?: { name: string; email?: string };
  spacesOwner?: { id: string; name: string; email: string };
}

export interface NotionImportJob {
  id: string;
  /** token = workspace import with an integration token; member = someone bringing their own pages via Notion sign-in */
  kind: 'token' | 'member';
  userId: string;
  status: NotionImportStatus;
  channel?: string;
  notionWorkspace?: string;
  log: string[];
  sections?: NotionSection[];
  summary?: {
    created: number;
    updated: number;
    joined: number;
    skipped: number;
    folders: number;
    attachments: number;
    comments: number;
    /** Canvases this person lost access to because they can no longer see the page in Notion. */
    accessRemoved: string[];
    warnings: string[];
    unresolvedUsers: Array<{ name: string; email?: string }>;
    canvases: Array<{
      title: string;
      url: string;
      status: 'created' | 'updated' | 'joined';
      access: 'public' | 'private';
      ownerEmail?: string;
      /** Everyone who can open the canvas in Spaces right now. */
      sharedWith?: string[];
    }>;
  };
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

export const notionMigrationApi = {
  /** Notion's consent + page-picker URL for the signed-in user; the caller navigates there. */
  connectUrl: async (): Promise<string> =>
    (await apiInstance.get<{ url: string }>(`${BASE}/connect?format=json`)).data.url,

  /** Start an import from the merchant's Notion integration token. */
  startWithToken: async (token: string): Promise<NotionImportJob> =>
    (await apiInstance.post<NotionImportJob>(`${BASE}/token-import`, { token })).data,

  listMine: async (): Promise<{ jobs: NotionImportJob[] }> =>
    (await apiInstance.get<{ jobs: NotionImportJob[] }>(`${BASE}/mine`)).data,

  approve: async (
    jobId: string,
    input: { channel?: string | undefined; sections: Record<string, NotionSectionChoice> },
  ): Promise<NotionImportJob> =>
    (await apiInstance.post<NotionImportJob>(`${BASE}/jobs/${jobId}/approve`, input)).data,
};
