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
  repairPreview(actor: SdlcWikiActor, repoId: string): Promise<Array<{
    path: string;
    action: 'archive' | 'review';
    reason: string;
    canvasId: string;
    preservesCanvasIdentity: true;
    preservesVersionHistory: true;
    preservesSourceEvidence: true;
    applied: false;
  }>>;
}
