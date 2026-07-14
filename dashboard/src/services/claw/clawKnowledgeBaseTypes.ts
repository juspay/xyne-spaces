// Knowledge Base tree types, copied verbatim from the claw-auth reference
// frontend (xyne-claw-auth/frontend/src/lib/api.ts) so the ported
// KnowledgeBasePicker keeps the exact shapes it was written against.

export interface KbFile {
  id: string;
  name: string;
  itemType: 'file';
  fileId: string;
  ingestionStatus: string;
  createdAt: string;
  updatedAt: string;
}

export interface KbCollectionNode {
  id: string;
  name: string;
  description: string | null;
  isPrivate: boolean;
  ownerId: string;
  scopeType: string;
  scopeId: string;
  parentId: string | null;
  rootCollectionId: string | null;
  effectiveRole: 'OWNER' | 'EDITOR' | 'VIEWER';
  /** Channel display name when scopeType='CHANNEL' (root nodes only). */
  channelName?: string;
  /** Project id of the channel that owns this collection (root nodes only). */
  projectId?: string;
  /** Project display name (root nodes only). */
  projectName?: string;
  children?: KbCollectionNode[];
  items?: KbFile[];
}

/** A single KB grant. fileId === null grants the whole collection. */
export interface KbSelection {
  collectionId: string;
  fileId: string | null;
}
