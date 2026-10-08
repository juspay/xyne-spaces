import { useCallback, useState, type ReactElement } from 'react';
import { Copy, ExternalLink } from 'lucide-react';
import { openLink } from '../../../utils/openLink';
import type { ElectronWebviewElement } from '../../../types/electron';
import {
  Centered,
  EmbeddedBrowser,
  requestComments,
  useAnnotate,
  useWebviewTransport,
  type PickedBlock,
  type WorkspaceItem,
} from '../../workspaceItems';
import { artifactKindIcon, linkHost, providerLabel } from './artifactKinds';
import { safeHttpUrl } from './safeHttpUrl';
import { registerWorkspaceWebview } from './workspaceBrowserTools';
import { SignInImportBar, looksLikeSignIn } from './SignInImportBar';

import { usePublishViewerAction } from './viewerActions';
import { InlineCommentThread, type InlineCommentTarget } from './InlineCommentThread';

/**
 * Providers the agent can actually write back to. Everywhere else the passage
 * can be asked about but not edited, so offering "edit" would be a promise the
 * run cannot keep.
 */
const EDITABLE_PROVIDERS = new Set(['google_docs', 'google_sheets', 'google_slides', 'notion']);

/**
 * The AI screen's browser: the shared embedded browser plus the chrome only this
 * surface has — the header row, the sign-in offer, the selection capture, and
 * the registration that lets the agent's page tools drive it.
 */
export function AiBrowserItemView({ item }: { item: WorkspaceItem }): ReactElement {
  const url = safeHttpUrl(item.url ?? null);
  const [atSignIn, setAtSignIn] = useState(false);
  const [copied, setCopied] = useState(false);

  const [view, setView] = useState<ElectronWebviewElement | null>(null);
  const [picked, setPicked] = useState<PickedBlock | null>(null);
  const [openThread, setOpenThread] = useState<InlineCommentTarget | null>(null);

  const onView = useCallback((next: ElectronWebviewElement | null) => {
    registerWorkspaceWebview(next);
    setView(next);
  }, []);

  const onNavigate = useCallback((next: string) => {
    setAtSignIn(looksLikeSignIn(next));
  }, []);

  const transport = useWebviewTransport(view, {
    onPick: setPicked,
    onMarkClick: (commentId, rect) => {
      if (!rect) {
        requestComments(item.id, commentId);
        return;
      }
      setOpenThread(current => {
        if (current?.commentId === commentId) {
          transport.clearActive?.();
          return null;
        }
        return { commentId, rect };
      });
    },
  });

  const annotate = useAnnotate({
    item,
    url: item.url ?? '',
    editable: !!item.provider && EDITABLE_PROVIDERS.has(item.provider),
    transport,
    picked,
    onPicked: setPicked,
  });

  usePublishViewerAction(() => annotate.toggle, [annotate.picking, annotate.toggle === null]);

  if (!url) return <Centered>Link unavailable</Centered>;

  const isLink = item.kind === 'link';
  const host = linkHost(url);

  const copy = (): void => {
    void navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => setCopied(false));
  };

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground'>
        {isLink ? (
          <span className='grid h-5 w-5 flex-shrink-0 place-items-center text-muted-foreground'>
            {artifactKindIcon('LINK', 'h-3.5 w-3.5')}
          </span>
        ) : null}
        <span className='truncate' title={url}>
          {isLink ? `${providerLabel(item.provider)}${host ? ` · ${host}` : ''}` : url}
        </span>
        {isLink ? (
          <button
            type='button'
            onClick={copy}
            className='ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-secondary/60 hover:text-foreground'
            title='Copy link'
            data-track-category='AskAI'
            data-track-name='workspace-artifact-link-copy'
          >
            <Copy className='h-3.5 w-3.5' aria-hidden='true' />
            {copied ? 'Copied' : null}
          </button>
        ) : null}
        <button
          type='button'
          onClick={event => openLink(url, event, { force: 'external' })}
          className={
            isLink
              ? 'flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-secondary/60 hover:text-foreground'
              : 'ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-secondary/60 hover:text-foreground'
          }
          title='Open in browser'
          data-track-category='AskAI'
          data-track-name='workspace-page-open-external'
        >
          <ExternalLink className='h-3.5 w-3.5' aria-hidden='true' />
        </button>
      </div>

      <div className='min-h-0 flex-1'>
        <EmbeddedBrowser
          url={url}
          title={item.title}
          onView={onView}
          onNavigate={onNavigate}
          banner={view =>
            atSignIn ? (
              <SignInImportBar
                onImported={() => {
                  setAtSignIn(false);
                  void view?.loadURL(url);
                }}
              />
            ) : null
          }
          overlay={() => (
            <>
              {annotate.box}
              {openThread ? (
                <InlineCommentThread
                  item={item}
                  target={openThread}
                  onClose={() => {
                    setOpenThread(null);
                    transport.clearActive?.();
                  }}
                />
              ) : null}
            </>
          )}
        />
      </div>
    </div>
  );
}
