export interface SdlcWikiActor {
  userId: string;
  workspaceId: string;
}

export interface SdlcWikiPageSummary {
  canvasId: string;
  title: string;
  path: string;
  folderPath: string;
  syncedAt: string;
  updatedAt: string;
}

export interface SdlcWiki {
  listPages(actor: SdlcWikiActor, repoId: string): Promise<SdlcWikiPageSummary[]>;
}
