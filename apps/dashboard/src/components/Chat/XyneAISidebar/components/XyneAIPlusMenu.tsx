import type { ReactElement, ReactNode } from 'react';
import { ChevronRight, FilePlus, FocusTarget, Globe, Notebook, PaperclipSlant } from '@xyne/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../ui/dropdown-menu';
import { Switch } from '../../../ui/Switch';

// `--accent` and `--muted` resolve to the same value in both themes, so the
// wrapper's default `focus:bg-accent` hover is exactly the Switch's off-track
// colour and the switch vanishes under it. Halving the hover keeps the row
// legible while leaving the switch a step darker than its background.
const ITEM_CLASS =
  "gap-2.5 rounded-[10px] p-2 text-sm font-medium leading-5 tracking-[-0.14px] font-['Inter'] focus:bg-accent/50";
const ICON_CLASS = 'w-4 h-4 shrink-0 text-muted-foreground';

const NOOP = (): void => {};

/**
 * Presentational switch. The row owns activation — Radix fires the menu item's
 * `onSelect` on click, so a live switch here would toggle a second time and
 * cancel itself out. State is announced by the item's `aria-label` instead.
 */
const ReadonlySwitch = ({ checked }: { checked: boolean }): ReactElement => (
  <div className='pointer-events-none' aria-hidden>
    <Switch checked={checked} onCheckedChange={NOOP} />
  </div>
);

/** Row whose right edge carries a control (chevron, switch) rather than nothing. */
const SplitRow = ({
  children,
  trailing,
}: {
  children: ReactNode;
  trailing: ReactNode;
}): ReactElement => (
  <>
    <div className='flex items-center gap-2.5 min-w-0'>{children}</div>
    <div className='shrink-0'>{trailing}</div>
  </>
);

export interface XyneAIPlusMenuProps {
  /** Opens the OS file picker. */
  onAttachFiles: () => void;
  /** Opens the knowledge-base / collection picker. */
  onOpenCollections: () => void;

  onCreateCanvasToggle?: () => void;
  createCanvasEnabled?: boolean;

  onWebSearchToggle?: () => void;
  webSearchEnabled?: boolean;
  webSearchAccessible?: boolean;

  onDeepResearchToggle?: () => void;
  deepResearchEnabled?: boolean;
  deepResearchAccessible?: boolean;

  /** The trigger — rendered as the menu's anchor. */
  children: ReactNode;
}

/**
 * The composer's "+" menu — Figma node 2493:55148.
 *
 * Consolidates what used to be four separate toolbar buttons (attach,
 * collections, create canvas, web/deep search) behind one trigger. The two
 * search rows carry switches and so must not dismiss the menu on activation;
 * everything else is a one-shot action that closes it.
 */
export const XyneAIPlusMenu = ({
  onAttachFiles,
  onOpenCollections,
  onCreateCanvasToggle,
  createCanvasEnabled = false,
  onWebSearchToggle,
  webSearchEnabled = false,
  webSearchAccessible = false,
  onDeepResearchToggle,
  deepResearchEnabled = false,
  deepResearchAccessible = false,
  children,
}: XyneAIPlusMenuProps): ReactElement => {
  const hasSearchRow = !!onWebSearchToggle || !!onDeepResearchToggle;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      {/* Anchored above the composer, which sits at the bottom of the sidebar. */}
      <DropdownMenuContent
        align='start'
        side='top'
        sideOffset={8}
        className='min-w-[232px] rounded-2xl p-2 shadow-lg'
      >
        <DropdownMenuItem
          className={ITEM_CLASS}
          onSelect={onAttachFiles}
          data-track-category='XyneAI'
          data-track-name='ATTACH_FILES'
        >
          <PaperclipSlant className={ICON_CLASS} />
          Attach files
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          className={`${ITEM_CLASS} justify-between`}
          onSelect={onOpenCollections}
          data-track-category='XyneAI'
          data-track-name='OPEN_COLLECTION_SELECTOR'
        >
          <SplitRow trailing={<ChevronRight className={ICON_CLASS} />}>
            <Notebook className={ICON_CLASS} />
            Collections
          </SplitRow>
        </DropdownMenuItem>

        {onCreateCanvasToggle && (
          <DropdownMenuItem
            className={`${ITEM_CLASS} ${createCanvasEnabled ? 'text-primary' : ''}`}
            onSelect={onCreateCanvasToggle}
            data-track-category='XyneAI'
            data-track-name='TOGGLE_CREATE_CANVAS'
            data-track-metadata={JSON.stringify({ enabled: createCanvasEnabled })}
          >
            <FilePlus className={`${ICON_CLASS} ${createCanvasEnabled ? 'text-primary' : ''}`} />
            Create canvas
          </DropdownMenuItem>
        )}

        {hasSearchRow && <DropdownMenuSeparator />}

        {onWebSearchToggle && (
          // `preventDefault` keeps the menu open — a switch the user can't see
          // land in its new position reads as a failed click.
          <DropdownMenuItem
            className={`${ITEM_CLASS} justify-between`}
            disabled={!webSearchAccessible}
            onSelect={e => {
              e.preventDefault();
              onWebSearchToggle();
            }}
            aria-label={
              webSearchAccessible
                ? webSearchEnabled
                  ? 'Disable web search'
                  : 'Enable web search'
                : 'Web search not available'
            }
            {...(!webSearchAccessible && { title: "You don't have access to web search." })}
            data-track-category='XyneAI'
            data-track-name='TOGGLE_WEB_SEARCH'
            data-track-metadata={JSON.stringify({ enabled: webSearchEnabled })}
          >
            <SplitRow trailing={<ReadonlySwitch checked={webSearchEnabled} />}>
              <Globe className={ICON_CLASS} />
              Web Search
            </SplitRow>
          </DropdownMenuItem>
        )}

        {onDeepResearchToggle && (
          <DropdownMenuItem
            className={`${ITEM_CLASS} justify-between`}
            disabled={!deepResearchAccessible}
            onSelect={e => {
              e.preventDefault();
              onDeepResearchToggle();
            }}
            aria-label={
              deepResearchAccessible
                ? deepResearchEnabled
                  ? 'Disable deep search'
                  : 'Enable deep search'
                : 'Deep search not available'
            }
            {...(!deepResearchAccessible && { title: "You don't have access to deep research." })}
            data-track-category='XyneAI'
            data-track-name='TOGGLE_DEEP_RESEARCH'
            data-track-metadata={JSON.stringify({ enabled: deepResearchEnabled })}
          >
            <SplitRow trailing={<ReadonlySwitch checked={deepResearchEnabled} />}>
              <FocusTarget className={ICON_CLASS} />
              Deep search
            </SplitRow>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
