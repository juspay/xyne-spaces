import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Command } from 'cmdk';
import { Hashtag, LockClose, CheckTickSingle } from '@xyne/icons';
import { ChannelScopeType } from '@xyne/shared';
import {
  COMMAND_SECTION_LABELS,
  COMMAND_SECTION_ORDER,
  type CommandDef,
} from '@xyne/shared/commands';
import { cn } from '../../utils/classNames';
import { searchMentionableChannels, useAllVisibleChannels } from '../../hooks/useChannels';
import { MenuScrollRootContext, RowHoverCard, useScrollFade } from '../MentionMenu/MentionMenu';
import type { PickedContext } from './Composer.types';
import { pickFromChannel, refKey } from './Composer.utils';

interface MenuProps {
  query: string;
  pickedRefs: ReadonlySet<string>;
  /** Attaches the item, or takes it off when it is already attached. True
   *  only when it was newly attached. */
  onPick: (item: PickedContext) => boolean;
}

/**
 * The menu shell: one cmdk list whose highlighted row the editor moves with
 * the arrow keys (it forwards them — focus never leaves the text). The row the
 * results open on is always the first, so Enter after typing takes the best
 * match. The composer's menu box caps the height; the list fills it and
 * scrolls.
 */
function MenuList({
  children,
  header,
  resetKey,
  empty,
  className,
}: {
  children: ReactNode;
  header?: ReactNode;
  /** Changes whenever the result set does; the highlight snaps back to the top. */
  resetKey: string;
  empty?: ReactNode;
  className?: string | undefined;
}): ReactElement {
  const listRef = useRef<HTMLDivElement | null>(null);
  // In state too: rows' hover cards close when this list scrolls.
  const [listEl, setListEl] = useState<HTMLDivElement | null>(null);
  const [value, setValue] = useState('');
  // Measured on [cmdk-list] itself: cmdk wraps the rows in a sizer, so that
  // is what scrolls.
  const fade = useScrollFade<HTMLDivElement>();
  const setFadeRef = fade.ref;
  const setListRef = useCallback(
    (el: HTMLDivElement | null): void => {
      listRef.current = el;
      setListEl(el);
      setFadeRef(el);
    },
    [setFadeRef],
  );

  useEffect(() => {
    const first = listRef.current?.querySelector<HTMLElement>('[cmdk-item]');
    setValue(first?.getAttribute('data-value') ?? '');
    listRef.current?.scrollTo({ top: 0 });
  }, [resetKey]);

  return (
    <Command
      shouldFilter={false}
      loop
      value={value}
      onValueChange={setValue}
      className='flex min-h-0 flex-1 flex-col'
    >
      {header}
      <Command.List
        ref={setListRef}
        className={cn(
          'min-h-0 flex-1 overflow-y-auto scrollbar-minimal px-2 pb-2',
          fade.fadeBottom && 'mask-fade-bottom',
          className,
        )}
      >
        <MenuScrollRootContext.Provider value={listEl}>
          {empty}
          {children}
        </MenuScrollRootContext.Provider>
      </Command.List>
    </Command>
  );
}

const EmptyRow = ({ children }: { children: ReactNode }): ReactElement => (
  <div className='px-3 py-6 text-center text-sm text-muted-foreground'>{children}</div>
);

// ── # — channels ────────────────────────────────────────────────────────────

/** "#" — the channels you can mention, filtered as you type. */
export function ChannelMenu({ query, pickedRefs, onPick }: MenuProps): ReactElement {
  const allChannels = useAllVisibleChannels();
  const items = useMemo(
    () =>
      searchMentionableChannels(
        allChannels.filter(
          ch => ch.scopeType !== ChannelScopeType.DM && ch.scopeType !== ChannelScopeType.GROUP_DM,
        ),
        query,
        12,
      ),
    [allChannels, query],
  );
  return (
    <MenuList
      header={<MenuHeading>Channels</MenuHeading>}
      resetKey={`${query}|${items.length}`}
      empty={items.length === 0 ? <EmptyRow>No channels match “{query}”</EmptyRow> : null}
    >
      {items.map(channel => {
        const pick = pickFromChannel(channel, channel.name);
        const isPrivate = pick.kind === 'channel' && pick.isPrivate;
        return (
          <Command.Item
            key={channel.id}
            value={`channel-${channel.id}`}
            onSelect={() => onPick(pick)}
            className={MENU_ROW_CLASS}
            data-track-category='XyneAI'
            data-track-name='COMPOSER_CHANNEL_PICK'
          >
            <span className='grid size-5 shrink-0 place-items-center text-muted-foreground'>
              {isPrivate ? <LockClose size={14} /> : <Hashtag size={14} />}
            </span>
            <span className='min-w-0 flex-1 truncate'>{channel.name}</span>
            {pickedRefs.has(refKey(pick)) && <PickedTick />}
          </Command.Item>
        );
      })}
    </MenuList>
  );
}

// ── / — commands ────────────────────────────────────────────────────────────

/** "/" — the commands claw agents run, filtered as you type. */
export function CommandList({
  query,
  commands,
  onSelect,
}: {
  query: string;
  commands: readonly CommandDef[];
  onSelect: (command: CommandDef) => void;
}): ReactElement {
  const q = query.toLowerCase();
  const filtered = commands.filter(
    c =>
      !q ||
      c.name.includes(q) ||
      (c.aliases ?? []).some(a => a.includes(q)) ||
      c.label.toLowerCase().includes(q),
  );
  // A name that starts with the query beats one that merely contains it.
  const ranked = [...filtered].sort(
    (a, b) => Number(!a.name.startsWith(q)) - Number(!b.name.startsWith(q)),
  );
  const sections = q
    ? [{ section: null, items: ranked }]
    : COMMAND_SECTION_ORDER.map(section => ({
        section,
        items: ranked.filter(c => c.section === section),
      })).filter(group => group.items.length > 0);

  return (
    <MenuList
      header={q ? <MenuHeading>Commands</MenuHeading> : undefined}
      resetKey={`${query}|${ranked.length}`}
      empty={ranked.length === 0 ? <EmptyRow>No commands match “/{query}”</EmptyRow> : null}
      className={q ? undefined : 'pt-3'}
    >
      {sections.map(({ section, items }) => (
        <Command.Group
          key={section ?? 'matches'}
          {...(section ? { heading: COMMAND_SECTION_LABELS[section] } : {})}
          className='[&_[cmdk-group-heading]]:flex [&_[cmdk-group-heading]]:h-9 [&_[cmdk-group-heading]]:items-center [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:text-sm [&_[cmdk-group-heading]]:text-muted-foreground'
        >
          {items.map(command => (
            // The row cuts the description short; resting on it shows it whole.
            <RowHoverCard
              key={command.name}
              trigger={
                <Command.Item
                  value={`command-${command.name}`}
                  onSelect={() => onSelect(command)}
                  className={MENU_ROW_CLASS}
                  data-track-category='XyneAI'
                  data-track-name='COMPOSER_COMMAND_PICK'
                  data-track-metadata={JSON.stringify({ command: command.name })}
                >
                  <span className='shrink-0 text-foreground'>/{command.name}</span>
                  {command.argsHint && (
                    <span className='shrink-0 text-[13px] text-foreground/40'>
                      {command.argsHint}
                    </span>
                  )}
                  <span className='min-w-0 truncate text-foreground/80'>{command.help}</span>
                </Command.Item>
              }
            >
              <CommandCard command={command} />
            </RowHoverCard>
          ))}
        </Command.Group>
      ))}
    </MenuList>
  );
}

/** A command beside the "/" list: its name, what it takes and its whole description. */
function CommandCard({ command }: { command: CommandDef }): ReactElement {
  const aliases = command.aliases ?? [];
  return (
    <>
      <div className='flex items-baseline gap-2'>
        <span className='text-base text-foreground'>/{command.name}</span>
        {command.argsHint && <span className='text-sm text-foreground/40'>{command.argsHint}</span>}
      </div>
      <p className='mt-2 text-sm leading-[1.25] text-foreground'>{command.help}</p>
      {aliases.length > 0 && (
        <p className='mt-2 text-xs text-muted-foreground'>
          Also {aliases.map(alias => `/${alias}`).join(', ')}
        </p>
      )}
    </>
  );
}

// ── Shared bits ─────────────────────────────────────────────────────────────

// scroll-mb-12: arrowing down stops short of the list's faded last 48px.
const MENU_ROW_CLASS =
  'flex h-9 scroll-mb-12 cursor-pointer items-center gap-2 rounded-[10px] px-2.5 text-sm text-foreground aria-selected:bg-accent';

const MenuHeading = ({ children }: { children: ReactNode }): ReactElement => (
  <div className='flex h-9 shrink-0 items-center px-4 text-sm text-muted-foreground'>
    {children}
  </div>
);

const PickedTick = (): ReactElement => (
  <span className='grid size-4 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground'>
    <CheckTickSingle size={10} />
  </span>
);
