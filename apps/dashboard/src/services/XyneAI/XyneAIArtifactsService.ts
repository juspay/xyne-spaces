import { apiInstance } from '../clients/apiClient';

export type ConversationArtifactKind =
  | 'CANVAS'
  | 'REACT_APP'
  | 'DESIGN_HTML'
  | 'FILE'
  | 'DIFF'
  | 'PREVIEW'
  | 'SPEC'
  | 'LINK'
  | 'PAGE'
  | 'REVIEW_ROOM'
  | 'LESSON'
  | 'UPLOAD';

export type ArtifactRefService = 'SPACES' | 'CLAW' | 'EXTERNAL';

export type ConversationArtifactStatus = 'ACTIVE' | 'STALE' | 'DELETED';

export interface ConversationArtifactOpenRef {
  kind: ConversationArtifactKind;
  service: ArtifactRefService;
  refId: string;
  url?: string | null;
  versionRef?: string | null;
}

export interface ConversationArtifact {
  id: string;
  conversationId: string;
  messageId?: string | null;
  runId?: string | null;
  kind: ConversationArtifactKind;
  refService: ArtifactRefService;
  refId: string;
  url?: string | null;
  provider?: string | null;
  latestVersionRef?: string | null;
  title: string;
  status: ConversationArtifactStatus;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  openRef: ConversationArtifactOpenRef;
}

export interface ConversationArtifactPatch {
  title?: string;
  pinned?: boolean;
  status?: ConversationArtifactStatus;
}

interface ListResponse {
  success: boolean;
  artifacts: ConversationArtifact[];
}

interface SingleResponse {
  success: boolean;
  artifact: ConversationArtifact;
}

export async function listConversationArtifacts(
  conversationId: string,
): Promise<ConversationArtifact[]> {
  const response = await apiInstance.get<ListResponse>(
    `/xyne-ai/v2/conversations/${encodeURIComponent(conversationId)}/artifacts`,
  );
  return response.data?.artifacts ?? [];
}

export async function getConversationArtifact(
  artifactId: string,
): Promise<ConversationArtifact | null> {
  const response = await apiInstance.get<SingleResponse>(
    `/xyne-ai/v2/artifacts/${encodeURIComponent(artifactId)}`,
  );
  return response.data?.artifact ?? null;
}

export async function patchConversationArtifact(
  artifactId: string,
  patch: ConversationArtifactPatch,
): Promise<ConversationArtifact | null> {
  const response = await apiInstance.patch<SingleResponse>(
    `/xyne-ai/v2/artifacts/${encodeURIComponent(artifactId)}`,
    patch,
  );
  return response.data?.artifact ?? null;
}

export const conversationArtifactsQueryKey = (conversationId: string): [string, string] => [
  'conversation-artifacts',
  conversationId,
];

export interface ArtifactCommentAnchor {
  quote: string;
  selector?: string;
  line?: number;
  offset?: number;
}

export interface ArtifactCommentRow {
  id: string;
  itemId: string;
  body: string;
  author: { id: string; name: string };
  createdAt: string;
  anchor?: ArtifactCommentAnchor;
  resolved?: boolean;
  byAgent?: boolean;
}

export async function listArtifactComments(artifactId: string): Promise<ArtifactCommentRow[]> {
  const response = await apiInstance.get<{ comments?: ArtifactCommentRow[] }>(
    `/xyne-ai/v2/artifacts/${encodeURIComponent(artifactId)}/comments`,
  );
  return response.data?.comments ?? [];
}

export async function addArtifactComment(
  artifactId: string,
  payload: { body: string; anchor?: ArtifactCommentAnchor },
): Promise<ArtifactCommentRow | null> {
  const response = await apiInstance.post<{ comment?: ArtifactCommentRow }>(
    `/xyne-ai/v2/artifacts/${encodeURIComponent(artifactId)}/comments`,
    payload,
  );
  return response.data?.comment ?? null;
}

export async function resolveArtifactComment(
  artifactId: string,
  commentId: string,
  resolved: boolean,
): Promise<void> {
  await apiInstance.patch(
    `/xyne-ai/v2/artifacts/${encodeURIComponent(artifactId)}/comments/${encodeURIComponent(commentId)}`,
    { resolved },
  );
}
