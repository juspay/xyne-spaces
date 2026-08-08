export interface SdlcWikiActor {
  userId: string;
  workspaceId: string;
}

export interface SdlcWikiPageInput {
  sourcePath: string;
  title: string;
  markdown: string;
}

export interface SdlcWikiPageSummary {
  canvasId: string;
  title: string;
  path: string;
  folderPath: string;
  syncedAt: string;
  updatedAt: string;
}

export type SdlcWikiPageSyncStatus = 'created' | 'updated' | 'unchanged' | 'failed';

export interface SdlcWikiPageSyncResult {
  sourcePath: string;
  status: SdlcWikiPageSyncStatus;
  canvasId?: string;
  error?: string;
}

export interface SdlcWikiSyncResult {
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  pages: SdlcWikiPageSyncResult[];
}

export interface SyncSdlcWikiInput {
  repoId: string;
  sourceRepository: string;
  pages: SdlcWikiPageInput[];
}

export interface SdlcWiki {
  listPages(actor: SdlcWikiActor, repoId: string): Promise<SdlcWikiPageSummary[]>;
  syncPages(input: SyncSdlcWikiInput): Promise<SdlcWikiSyncResult>;
}
