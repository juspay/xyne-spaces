import type { ReactElement, ReactNode } from 'react';
import { Download, ExternalLink } from 'lucide-react';
import { downloadFile } from '../../../services/clients/fileFetchService';
import CanvasScreen from '../../Canvas/CanvasScreen';
import { openLink } from '../../../utils/openLink';
import type { ConversationArtifact } from '../../../services/XyneAI/XyneAIArtifactsService';
import { safeHttpUrl } from './safeHttpUrl';
import { LocalDiffView, LocalDiffActions, isLocalDiffArtifact } from './LocalDiffView';
import type { ReviewGuide } from './reviewDiff';
import { DesignPanel } from './design/DesignPanel';
import {
  Centered,
  FileView,
  HtmlDocView,
  MarkdownView,
  SandboxedFrame,
} from '../../workspaceItems/primitives';
import { itemFromArtifact } from '../../workspaceItems';
import { AiBrowserItemView } from './AiBrowserItemView';

function attachmentDownloadUrl(refId: string): string {
  return `/xyne-ai/v2/attachments/${encodeURIComponent(refId)}/download`;
}

// The sandbox editor (code-server, a full workbench) opens in its own tab
// rather than inline. That is not a security boundary: /claw-code is served
// from this origin, and iframeSandboxFor grants frames under /claw-preview and
// /claw-code allow-same-origin, so inline or in a tab, anything the agent serves
// there can call /api/* as the viewer, who may be any member of the
// conversation. The sandbox-access gate and the router's Origin check narrow
// who is exposed; only a dedicated preview origin removes it (#2993, #3007).
function isSandboxEditorUrl(url: string): boolean {
  try {
    return new URL(url).pathname.startsWith('/claw-code/');
  } catch {
    return false;
  }
}

function SandboxEditorCard({ url }: { url: string }): ReactElement {
  return (
    <div className='flex h-full flex-col items-center justify-center gap-3 px-6 text-center'>
      <p className='text-sm text-muted-foreground'>The sandbox editor opens in its own tab.</p>
      <button
        type='button'
        onClick={event => openLink(url, event, { force: 'external' })}
        className='flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-secondary/60'
        data-track-category='AskAI'
        data-track-name='workspace-sandbox-editor-open'
      >
        <ExternalLink className='h-3.5 w-3.5' aria-hidden='true' />
        Open editor
      </button>
    </div>
  );
}

export function artifactInlineActions(artifact: ConversationArtifact): ReactElement | null {
  const url = safeHttpUrl(artifact.openRef.url ?? artifact.url);

  if (artifact.kind === 'SPEC') {
    return (
      <button
        type='button'
        onClick={() => {
          void downloadFile(attachmentDownloadUrl(artifact.openRef.refId), artifact.title);
        }}
        aria-label='Download'
        title='Download'
        className='grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
        data-track-category='AskAI'
        data-track-name='workspace-artifact-download'
      >
        <Download className='h-4 w-4' />
      </button>
    );
  }

  if (isLocalDiffArtifact(artifact)) {
    return <LocalDiffActions artifact={artifact} />;
  }

  const linkable = artifact.kind === 'PREVIEW' || artifact.kind === 'DIFF';

  if (linkable && artifact.status === 'STALE') {
    return <span className='flex-shrink-0 text-xs text-muted-foreground'>Ended</span>;
  }

  if (linkable && !url) {
    return <span className='flex-shrink-0 text-xs text-muted-foreground'>Link unavailable</span>;
  }

  if (url && linkable) {
    return (
      <button
        type='button'
        onClick={event => openLink(url, event, { force: 'external' })}
        aria-label='Open in a new tab'
        title='Open in a new tab'
        className='grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
        data-track-category='AskAI'
        data-track-name='workspace-artifact-open-tab'
      >
        <ExternalLink className='h-4 w-4' />
      </button>
    );
  }

  return null;
}

export interface ArtifactInlineViewProps {
  artifact: ConversationArtifact;
  appPane: ReactNode;
  reviewGuide?: ReviewGuide | null;
}

export function ArtifactInlineView({
  artifact,
  appPane,
  reviewGuide,
}: ArtifactInlineViewProps): ReactElement {
  if (artifact.status === 'DELETED') {
    return <Centered>This artifact has been deleted.</Centered>;
  }

  const url = safeHttpUrl(artifact.openRef.url ?? artifact.url);

  switch (artifact.kind) {
    case 'CANVAS':
      return (
        <div className='h-full w-full bg-background'>
          <CanvasScreen canvasId={artifact.openRef.refId} />
        </div>
      );
    case 'REACT_APP':
      return <div className='h-full w-full min-w-0'>{appPane}</div>;
    case 'FILE':
    case 'UPLOAD':
      return (
        <FileView
          url={attachmentDownloadUrl(artifact.openRef.refId)}
          title={artifact.title}
          {...(artifact.mimeType ? { mimeType: artifact.mimeType } : {})}
          {...(artifact.size ? { size: artifact.size } : {})}
        />
      );
    case 'SPEC':
      return (
        <MarkdownView url={attachmentDownloadUrl(artifact.openRef.refId)} title={artifact.title} />
      );
    case 'DESIGN_HTML':
      return <DesignPanel artifact={artifact} />;
    case 'PREVIEW':
    case 'DIFF':
      if (isLocalDiffArtifact(artifact))
        return <LocalDiffView artifact={artifact} guide={reviewGuide ?? null} />;
      if (artifact.status === 'STALE') return <Centered>This sandbox has ended.</Centered>;
      if (url && isSandboxEditorUrl(url)) return <SandboxEditorCard url={url} />;
      return url ? (
        <SandboxedFrame url={url} title={artifact.title} />
      ) : (
        <Centered>Link unavailable</Centered>
      );
    case 'REVIEW_ROOM':
    case 'LESSON':
      return (
        <HtmlDocView url={attachmentDownloadUrl(artifact.openRef.refId)} title={artifact.title} />
      );
    case 'LINK':
      return <AiBrowserItemView item={itemFromArtifact(artifact)} />;
    case 'PAGE':
      return <AiBrowserItemView item={itemFromArtifact(artifact)} />;
  }
}
