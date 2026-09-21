import type { ReactElement, ReactNode } from 'react';
import { EmbeddedBrowser } from './EmbeddedBrowser';
import { Centered, FileView, HtmlDocView, MarkdownView, SandboxedFrame } from './primitives';
import { detectFileType } from '../FileViewer/utils';
import { isBrowsableItem, type WorkspaceItem, type WorkspaceItemKind } from './itemDescriptor';

/**
 * What a surface must supply, because only it knows how to render these:
 * a canvas needs the canvas editor, an app needs its pane, a diff needs the
 * patch its own store holds.
 */
export interface ItemViewSlots {
  canvas?: (item: WorkspaceItem) => ReactNode;
  design?: (item: WorkspaceItem) => ReactNode;
  reactApp?: (item: WorkspaceItem) => ReactNode;
  diff?: (item: WorkspaceItem) => ReactNode;
  /** Replaces the shared browser, for a surface that hosts pages its own way. */
  browser?: (item: WorkspaceItem) => ReactNode;
  /** Shown for a file this app cannot preview, instead of a bare message. */
  fileFallback?: (item: WorkspaceItem) => ReactNode;
}

export interface ItemViewProps {
  item: WorkspaceItem;
  slots?: ItemViewSlots;
  /** Wraps the embedded browser, so a surface can add its own chrome. */
  browserBanner?: EmbeddedBrowserExtras['banner'];
  browserOverlay?: EmbeddedBrowserExtras['overlay'];
}

type EmbeddedBrowserExtras = Parameters<typeof EmbeddedBrowser>[0];

const NEEDS_SLOT: Partial<Record<WorkspaceItemKind, keyof ItemViewSlots>> = {
  canvas: 'canvas',
  design: 'design',
  'react-app': 'reactApp',
  diff: 'diff',
};

export function ItemView({
  item,
  slots,
  browserBanner,
  browserOverlay,
}: ItemViewProps): ReactElement {
  if (item.stale) {
    return <Centered>This item is no longer available where it was stored.</Centered>;
  }

  const slotName = NEEDS_SLOT[item.kind];
  if (slotName) {
    const render = slots?.[slotName];
    const rendered = render?.(item);
    if (rendered) return <>{rendered}</>;
    return <Centered>This surface cannot show a {item.kind.replace('-', ' ')} yet.</Centered>;
  }

  if (isBrowsableItem(item)) {
    const own = slots?.browser?.(item);
    if (own) return <>{own}</>;
    if (!item.url) return <Centered>Link unavailable</Centered>;
    return (
      <EmbeddedBrowser
        url={item.url}
        title={item.title}
        {...(browserBanner ? { banner: browserBanner } : {})}
        {...(browserOverlay ? { overlay: browserOverlay } : {})}
      />
    );
  }

  const contentUrl = item.contentUrl ?? item.url;
  if (!contentUrl) return <Centered>This item has nothing to show.</Centered>;

  if (item.kind === 'html-doc') return <HtmlDocView url={contentUrl} title={item.title} />;
  if (item.kind === 'spec') return <MarkdownView url={contentUrl} title={item.title} />;
  if (item.kind === 'preview') return <SandboxedFrame url={contentUrl} title={item.title} />;

  if (!detectFileType(item.mimeType ?? '', item.title)) {
    const fallback = slots?.fileFallback?.(item);
    if (fallback) return <>{fallback}</>;
  }

  return (
    <FileView
      url={contentUrl}
      title={item.title}
      {...(item.mimeType ? { mimeType: item.mimeType } : {})}
    />
  );
}
