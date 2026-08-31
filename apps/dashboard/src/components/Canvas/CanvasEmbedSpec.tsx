import { createReactBlockSpec } from '@blocknote/react';
import { Copy, ExternalLink, Link2, Trash2, Unlink } from 'lucide-react';
import type { ReactElement } from 'react';
import { toast } from 'sonner';
import { useClipboard } from '../../hooks/useClipboard';
import { resolveVideoEmbed } from './videoEmbedUrl';

export const CANVAS_EMBED_TYPE = 'embed';

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Inside a block's render BlockNote narrows `editor` to that block's own schema,
 * so handing replaceBlocks a paragraph does not typecheck. The call is valid at
 * runtime — the editor is the whole canvas — so it is typed here rather than
 * widened to any, which this package treats as an error.
 */
interface BlockReplacer {
  replaceBlocks: (
    replace: readonly unknown[],
    withBlocks: ReadonlyArray<{
      type: 'paragraph';
      content: ReadonlyArray<{ type: 'link'; href: string; content: string }>;
    }>,
  ) => void;
}

const openInNewTab = (url: string): void => {
  window.open(url, '_blank', 'noopener,noreferrer');
};

interface EmbedActionsProps {
  url: string;
  onUnembed: () => void;
  onDelete: () => void;
  editable: boolean;
}

/**
 * Hover actions for an embed. The editor owns clicks inside its content, so every
 * one of these fires on mousedown — by the time click lands the editor has taken
 * the selection back and the button never hears it.
 */
function EmbedActions({ url, onUnembed, onDelete, editable }: EmbedActionsProps): ReactElement {
  const { copy } = useClipboard();

  const action =
    (run: () => void) =>
    (event: React.MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      run();
    };

  const buttonClass =
    'grid size-6 place-items-center rounded text-muted-foreground transition-colors ' +
    'hover:bg-muted hover:text-foreground';

  return (
    <div
      contentEditable={false}
      className='absolute right-2 top-2 z-10 flex items-center gap-0.5 rounded-md border border-border bg-popover/95 p-0.5 opacity-0 shadow-sm backdrop-blur transition-opacity group-hover:opacity-100 focus-within:opacity-100'
    >
      <button
        type='button'
        title='Open in new tab'
        className={buttonClass}
        onMouseDown={action(() => openInNewTab(url))}
      >
        <ExternalLink size={13} />
      </button>
      <button
        type='button'
        title='Copy link'
        className={buttonClass}
        onMouseDown={action(() => {
          void copy(url);
          toast.success('Link copied');
        })}
      >
        <Copy size={13} />
      </button>
      {editable && (
        <>
          <button
            type='button'
            title='Convert back to link'
            className={buttonClass}
            onMouseDown={action(onUnembed)}
          >
            <Unlink size={13} />
          </button>
          <button
            type='button'
            title='Delete'
            className={buttonClass}
            onMouseDown={action(onDelete)}
          >
            <Trash2 size={13} />
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Anything we have no player for. Deliberately built from the URL alone — the
 * title, description and image chat shows come from metadata the backend fetches
 * and stores on the message, and no equivalent exists for canvas documents.
 */
function GenericEmbedCard({ url }: { url: string }): ReactElement {
  return (
    <div
      contentEditable={false}
      role='button'
      tabIndex={0}
      aria-label={`Open ${hostOf(url)}`}
      onMouseDown={event => {
        event.preventDefault();
        event.stopPropagation();
        openInNewTab(url);
      }}
      onKeyDown={event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        openInNewTab(url);
      }}
      className='flex w-full cursor-pointer items-center gap-3 rounded-lg border border-border bg-muted/30 p-3 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
    >
      <span className='grid size-9 shrink-0 place-items-center rounded-md bg-background text-muted-foreground'>
        <Link2 size={16} />
      </span>
      <span className='min-w-0 flex-1'>
        <span className='block truncate text-sm font-medium text-foreground'>{hostOf(url)}</span>
        <span className='block truncate text-xs text-muted-foreground'>{url}</span>
      </span>
    </div>
  );
}

function PlayerEmbed({ embedUrl, provider }: { embedUrl: string; provider: string }): ReactElement {
  return (
    <div
      className='relative w-full overflow-hidden rounded-lg border border-border pt-[56.25%]'
      data-embed-provider={provider}
      contentEditable={false}
    >
      <iframe
        src={embedUrl}
        title='Embedded video'
        className='absolute inset-0 h-full w-full'
        allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture'
        // The frame runs scripts and reaches its own origin — a player cannot
        // work otherwise — but it may not navigate the document hosting it.
        sandbox='allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox'
        referrerPolicy='strict-origin-when-cross-origin'
        allowFullScreen
      />
    </div>
  );
}

/**
 * A link the reader asked to see in place rather than follow.
 *
 * Services like YouTube only play inside a frame, so BlockNote's own video block
 * — which renders `<video src>`, meaning a video *file* — shows nothing when
 * handed a watch page. Where we know the service, this plays it; where we do not,
 * it degrades to a card rather than failing silently.
 */
export const canvasEmbedSpec = createReactBlockSpec(
  {
    type: CANVAS_EMBED_TYPE,
    propSchema: {
      url: { default: '' },
    },
    content: 'none',
  },
  {
    render: ({ block, editor }) => {
      const url = String(block.props.url ?? '');
      const video = resolveVideoEmbed(url);
      const editable = editor.isEditable;

      return (
        <div className='group relative my-1 w-full'>
          {video ? (
            <PlayerEmbed embedUrl={video.embedUrl} provider={video.provider} />
          ) : (
            <GenericEmbedCard url={url} />
          )}
          <EmbedActions
            url={url}
            editable={editable}
            onUnembed={() =>
              (editor as unknown as BlockReplacer).replaceBlocks(
                [block],
                [{ type: 'paragraph', content: [{ type: 'link', href: url, content: url }] }],
              )
            }
            onDelete={() => editor.removeBlocks([block])}
          />
        </div>
      );
    },
  },
)();
