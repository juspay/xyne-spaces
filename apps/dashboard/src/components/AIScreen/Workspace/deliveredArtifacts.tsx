import { createContext, useContext, type ReactElement } from 'react';
import { Download } from 'lucide-react';
import { downloadFile } from '../../../services/clients/fileFetchService';
import type { ConversationArtifact } from '../../../services/XyneAI/XyneAIArtifactsService';
import { artifactKindIcon, artifactKindLabel } from './artifactKinds';

const DELIVERED_KINDS = new Set<ConversationArtifact['kind']>([
  'FILE',
  'SPEC',
  'REVIEW_ROOM',
  'LESSON',
  'DESIGN_HTML',
]);

export interface DeliveredArtifactIndex {
  byAttachmentId: ReadonlyMap<string, ConversationArtifact>;
  byMessageId: ReadonlyMap<string, readonly ConversationArtifact[]>;
}

export interface DeliveredArtifacts extends DeliveredArtifactIndex {
  open: (artifactId: string) => void;
}

export const DeliveredArtifactsContext = createContext<DeliveredArtifacts | null>(null);

export function useDeliveredArtifacts(): DeliveredArtifacts | null {
  return useContext(DeliveredArtifactsContext);
}

function deliveredAttachmentId(artifact: ConversationArtifact): string | null {
  return artifact.kind === 'DESIGN_HTML' ? (artifact.latestVersionRef ?? null) : artifact.refId;
}

export function indexDeliveredArtifacts(
  artifacts: readonly ConversationArtifact[],
): DeliveredArtifactIndex {
  const byAttachmentId = new Map<string, ConversationArtifact>();
  const byMessageId = new Map<string, ConversationArtifact[]>();
  for (const artifact of artifacts) {
    if (!DELIVERED_KINDS.has(artifact.kind) || artifact.status === 'DELETED') continue;
    const attachmentId = deliveredAttachmentId(artifact);
    if (attachmentId) byAttachmentId.set(attachmentId, artifact);
    if (artifact.messageId) {
      const list = byMessageId.get(artifact.messageId) ?? [];
      list.push(artifact);
      byMessageId.set(artifact.messageId, list);
    }
  }
  return { byAttachmentId, byMessageId };
}

export function splitDeliveredAttachments<A extends { id?: string | undefined }>(
  messageId: string,
  attachments: readonly A[],
  index: DeliveredArtifactIndex | null,
): { artifacts: ConversationArtifact[]; attachments: A[] } {
  if (!index) return { artifacts: [], attachments: [...attachments] };
  const artifacts = [...(index.byMessageId.get(messageId) ?? [])];
  const plain: A[] = [];
  for (const attachment of attachments) {
    const artifact = attachment.id ? index.byAttachmentId.get(attachment.id) : undefined;
    if (!artifact) plain.push(attachment);
    else if (!artifacts.some(a => a.id === artifact.id)) artifacts.push(artifact);
  }
  return { artifacts, attachments: plain };
}

export function DeliveredArtifactChip({
  artifact,
  onOpen,
}: {
  artifact: ConversationArtifact;
  onOpen: (artifactId: string) => void;
}): ReactElement {
  const attachmentId = deliveredAttachmentId(artifact);
  return (
    <div className='group flex w-full items-center gap-2.5 rounded-xl bg-muted/50 px-3 py-2.5 transition-colors hover:bg-muted'>
      <button
        type='button'
        onClick={() => onOpen(artifact.id)}
        className='flex min-w-0 flex-1 items-center gap-2.5 text-left'
        title='Open in workspace'
        data-track-category='AskAI'
        data-track-name='DeliveredArtifactOpen'
      >
        {artifactKindIcon(artifact.kind, 'h-4 w-4 shrink-0 text-muted-foreground')}
        <span className='truncate text-sm font-medium text-foreground'>{artifact.title}</span>
        <span className='shrink-0 text-[13px] text-muted-foreground'>
          {artifactKindLabel(artifact.kind)} · Open in workspace
        </span>
      </button>
      {attachmentId && (
        <button
          type='button'
          onClick={() => {
            void downloadFile(
              `/xyne-ai/v2/attachments/${encodeURIComponent(attachmentId)}/download`,
              artifact.title,
            );
          }}
          aria-label='Download'
          title='Download'
          className='grid h-7 w-7 shrink-0 place-items-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
          data-track-category='AskAI'
          data-track-name='DeliveredArtifactDownload'
        >
          <Download className='h-4 w-4' />
        </button>
      )}
    </div>
  );
}
