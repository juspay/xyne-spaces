import { Fragment, type ReactElement } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

/** What Electron says about a right-click in a page: where, and on what. */
export interface PageMenuParams {
  /** Where in the page, in its own coordinates — Electron reports the window's,
   *  which the host turns into these. */
  x: number;
  y: number;
  linkURL: string;
  pageURL: string;
  srcURL: string;
  mediaType: string;
  hasImageContents: boolean;
  isEditable: boolean;
  selectionText: string;
  /** A misspelled word right-clicked in a field, and the spellchecker's fixes for it. */
  misspelledWord?: string;
  dictionarySuggestions?: string[];
  editFlags: {
    canUndo: boolean;
    canRedo: boolean;
    canCut: boolean;
    canCopy: boolean;
    canPaste: boolean;
    canSelectAll: boolean;
  };
}

/** What the menu can do; the host does each, on the page it was opened on. */
export type PageMenuAction =
  | {
      type:
        | 'back'
        | 'forward'
        | 'reload'
        | 'undo'
        | 'redo'
        | 'cut'
        | 'copy'
        | 'paste'
        | 'selectAll';
    }
  | { type: 'openInTab' | 'openExternally' | 'copyText' | 'replaceMisspelling'; value: string }
  | { type: 'copyImage' | 'inspect'; x: number; y: number }
  | { type: 'savePage' };

interface Entry {
  label: string;
  action: PageMenuAction;
  disabled?: boolean;
  shortcut?: string;
}

const short = (text: string, length: number): string =>
  text.length > length ? `${text.slice(0, length - 1)}…` : text;

/**
 * A page's right-click menu, as a browser's: what was clicked comes first — a link,
 * an image, selected text, a field — then the page itself, at the point clicked.
 * "Save page" is a folder's, where pages can be saved.
 */
function sections(
  params: PageMenuParams,
  page: { canGoBack: boolean; canGoForward: boolean; saveable: boolean; inspectable: boolean },
): Entry[][] {
  const groups: Entry[][] = [];
  if (params.linkURL) {
    groups.push([
      { label: 'Open link in new tab', action: { type: 'openInTab', value: params.linkURL } },
      {
        label: 'Open link in your browser',
        action: { type: 'openExternally', value: params.linkURL },
      },
      { label: 'Copy link address', action: { type: 'copyText', value: params.linkURL } },
    ]);
  }
  if (params.mediaType === 'image' && params.srcURL) {
    groups.push([
      { label: 'Open image in new tab', action: { type: 'openInTab', value: params.srcURL } },
      { label: 'Copy image', action: { type: 'copyImage', x: params.x, y: params.y } },
      { label: 'Copy image address', action: { type: 'copyText', value: params.srcURL } },
    ]);
  }
  // A misspelled word in a field: its fixes first, as in any browser.
  if (params.isEditable && params.misspelledWord) {
    const fixes = (params.dictionarySuggestions ?? []).slice(0, 5);
    groups.push(
      fixes.length > 0
        ? fixes.map(fix => ({ label: fix, action: { type: 'replaceMisspelling', value: fix } }))
        : [
            {
              label: 'No spelling suggestions',
              action: { type: 'replaceMisspelling', value: params.misspelledWord },
              disabled: true,
            },
          ],
    );
  }
  if (params.isEditable) {
    groups.push(
      [
        {
          label: 'Undo',
          action: { type: 'undo' },
          disabled: !params.editFlags.canUndo,
          shortcut: '⌘Z',
        },
        {
          label: 'Redo',
          action: { type: 'redo' },
          disabled: !params.editFlags.canRedo,
          shortcut: '⇧⌘Z',
        },
      ],
      [
        {
          label: 'Cut',
          action: { type: 'cut' },
          disabled: !params.editFlags.canCut,
          shortcut: '⌘X',
        },
        {
          label: 'Copy',
          action: { type: 'copy' },
          disabled: !params.editFlags.canCopy,
          shortcut: '⌘C',
        },
        {
          label: 'Paste',
          action: { type: 'paste' },
          disabled: !params.editFlags.canPaste,
          shortcut: '⌘V',
        },
        {
          label: 'Select all',
          action: { type: 'selectAll' },
          disabled: !params.editFlags.canSelectAll,
          shortcut: '⌘A',
        },
      ],
    );
  } else if (params.selectionText.trim()) {
    const selected = params.selectionText.trim();
    groups.push([
      { label: 'Copy', action: { type: 'copy' }, shortcut: '⌘C' },
      {
        label: `Search Google for “${short(selected, 28)}”`,
        action: {
          type: 'openInTab',
          value: `https://www.google.com/search?q=${encodeURIComponent(selected)}`,
        },
      },
    ]);
  }
  // On the page itself, its way around; on anything else, that thing's own.
  if (groups.length === 0) {
    groups.push([
      { label: 'Back', action: { type: 'back' }, disabled: !page.canGoBack, shortcut: '⌘[' },
      {
        label: 'Forward',
        action: { type: 'forward' },
        disabled: !page.canGoForward,
        shortcut: '⌘]',
      },
      { label: 'Reload', action: { type: 'reload' }, shortcut: '⌘R' },
    ]);
  }
  groups.push([
    ...(page.saveable
      ? [{ label: 'Save page to this folder', action: { type: 'savePage' } } as const]
      : []),
    {
      label: 'Open page in your browser',
      action: { type: 'openExternally', value: params.pageURL },
      disabled: !/^https?:/.test(params.pageURL),
    },
    { label: 'Copy page address', action: { type: 'copyText', value: params.pageURL } },
  ]);
  if (page.inspectable) {
    groups.push([{ label: 'Inspect', action: { type: 'inspect', x: params.x, y: params.y } }]);
  }
  return groups;
}

export function PageContextMenu(props: {
  /** Where it opens, in the window: the page's corner plus the click. */
  at: { x: number; y: number };
  params: PageMenuParams;
  page: { canGoBack: boolean; canGoForward: boolean; saveable: boolean; inspectable: boolean };
  onAction: (action: PageMenuAction) => void;
  onClose: () => void;
  trackCategory: string;
}): ReactElement {
  const groups = sections(props.params, props.page);
  return (
    <DropdownMenu
      open
      onOpenChange={open => {
        if (!open) props.onClose();
      }}
    >
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden='true'
          className='pointer-events-none fixed size-0'
          style={{ left: props.at.x, top: props.at.y }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='start'
        sideOffset={2}
        collisionPadding={8}
        className='min-w-[220px] max-w-[320px]'
      >
        {groups.map((group, index) => (
          <Fragment key={index}>
            {index > 0 && <DropdownMenuSeparator />}
            {group.map(entry => (
              <DropdownMenuItem
                key={entry.label}
                disabled={entry.disabled ?? false}
                onSelect={() => props.onAction(entry.action)}
                className='text-[13px]'
                data-track-category={props.trackCategory}
                data-track-name='EmbeddedPageMenuChosen'
                data-track-metadata={JSON.stringify({ action: entry.action.type })}
              >
                <span className='truncate'>{entry.label}</span>
                {entry.shortcut && (
                  <span className='ml-auto pl-6 text-xs tracking-wide text-muted-foreground'>
                    {entry.shortcut}
                  </span>
                )}
              </DropdownMenuItem>
            ))}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
