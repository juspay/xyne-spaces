import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '../../shared/cn.js';
import { getIcon } from '../icons.js';
import { groupByConnector } from '../../../utils/connector-groups.js';
import type { ConnectorGroup, ConnectorItem } from '../../../utils/connector-groups.js';

/** A headed run of items inside one connector — a step category, say. */
export interface CatalogSection<T> {
  readonly key: string;
  readonly label: string;
  readonly items: readonly T[];
}

export interface ConnectorCatalogProps<T extends ConnectorItem> {
  readonly items: readonly T[];
  /** Singular and lower case — "trigger", "step" — for the search placeholder and counts. */
  readonly noun: string;
  readonly onSelect: (item: T) => void;
  /** The item already chosen, marked in the list. */
  readonly selectedType?: string | undefined;
  /** Splits one connector's items under headings; the headings show only when there are several. */
  readonly sectionsOf?: ((items: readonly T[]) => readonly CatalogSection<T>[]) | undefined;
  readonly autoFocus?: boolean | undefined;
  /**
   * Classes for the root. It is a flex column whose list scrolls, so give it a height
   * (or `flex-1` inside a sized parent) and the search stays put while the list scrolls.
   */
  readonly className?: string | undefined;
}

/**
 * Connectors first, then the opened connector's items: the palette for triggers and steps.
 *
 * With a single connector there is nothing to choose between, so its items show
 * straight away. A search from the connector list looks across every connector
 * and names each match's connector; inside a connector it looks only there.
 *
 * Colours come from the `--wui-*` tokens only, so the host's theme applies.
 */
export function ConnectorCatalog<T extends ConnectorItem>({
  items,
  noun,
  onSelect,
  selectedType,
  sectionsOf,
  autoFocus,
  className,
}: ConnectorCatalogProps<T>) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const groups = useMemo(() => groupByConnector(items), [items]);
  const openGroup = groups.length === 1 ? groups[0] : groups.find((group) => group.connectorId === openId);
  const canGoBack = groups.length > 1 && openGroup !== undefined;

  useEffect(() => {
    if (!canGoBack) return;
    // Capture phase, so this runs before a dialog's own Escape-to-close: Escape leaves
    // the connector first, and only closes the dialog from the connector list.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpenId(null);
      setQuery('');
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [canGoBack]);

  const openConnector = (connectorId: string | null) => {
    setOpenId(connectorId);
    setQuery('');
  };

  const q = query.trim().toLowerCase();
  const matches = (item: T): boolean =>
    q === '' ||
    item.name.toLowerCase().includes(q) ||
    item.description.toLowerCase().includes(q) ||
    item.type.toLowerCase().includes(q);

  const itemRow = (item: T, connectorName?: string) => (
    <ItemRow
      key={item.type}
      item={item}
      connectorName={connectorName}
      selected={item.type === selectedType}
      onSelect={onSelect}
    />
  );

  let body: ReactNode;
  if (openGroup) {
    const visible = openGroup.items.filter(matches);
    const sections = (
      sectionsOf ? sectionsOf(visible) : [{ key: openGroup.connectorId, label: '', items: visible }]
    ).filter((section) => section.items.length > 0);
    body =
      visible.length === 0 ? (
        <EmptyState text={q ? `No ${noun}s found` : `No ${noun}s available`} />
      ) : (
        sections.map((section) => (
          <div key={section.key} className="mb-3 last:mb-0">
            {sections.length > 1 && (
              <div className="mb-1 flex items-center gap-2 px-2.5 pt-1">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--wui-fg-subtle)]">
                  {section.label}
                </span>
                <span className="text-[10px] text-[var(--wui-fg-subtle)]">{section.items.length}</span>
              </div>
            )}
            <div className="space-y-0.5">{section.items.map((item) => itemRow(item))}</div>
          </div>
        ))
      );
  } else if (q) {
    const found = groups.flatMap((group) =>
      group.items.filter(matches).map((item) => ({ item, connectorName: group.connectorName })),
    );
    body =
      found.length === 0 ? (
        <EmptyState text={`No ${noun}s found`} />
      ) : (
        <div className="space-y-0.5">{found.map(({ item, connectorName }) => itemRow(item, connectorName))}</div>
      );
  } else {
    body =
      groups.length === 0 ? (
        <EmptyState text={`No ${noun}s available`} />
      ) : (
        <div className="space-y-0.5">
          {groups.map((group) => (
            <ConnectorRow
              key={group.connectorId}
              group={group}
              noun={noun}
              onOpen={() => openConnector(group.connectorId)}
            />
          ))}
        </div>
      );
  }

  const placeholder = canGoBack ? `Search ${openGroup.connectorName} ${noun}s...` : `Search ${noun}s...`;

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="shrink-0 border-b border-[var(--wui-border)] p-3">
        {canGoBack && (
          <button
            type="button"
            onClick={() => openConnector(null)}
            aria-label="Back to connectors"
            className="mb-2 flex items-center gap-1.5 rounded-[var(--wui-radius-sm)] px-1 py-0.5 text-[12px] font-semibold text-[var(--wui-fg-muted)] transition-colors hover:text-[var(--wui-fg)]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            {openGroup.connectorName}
          </button>
        )}
        <div className="relative">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--wui-fg-subtle)]"
            width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            autoFocus={autoFocus}
            className={cn(
              'w-full rounded-[var(--wui-radius)] border border-[var(--wui-border)] bg-[var(--wui-bg-subtle)] py-2 pl-9 pr-3 text-[13px]',
              'text-[var(--wui-fg)] placeholder:text-[var(--wui-fg-subtle)]',
              'outline-none transition-colors focus:border-[var(--wui-primary)] focus:bg-[var(--wui-surface)] focus:ring-2 focus:ring-[var(--wui-primary-light)]',
            )}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">{body}</div>
    </div>
  );
}

function countLabel(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

const ROW_CLASS =
  'flex w-full items-center gap-3 rounded-[var(--wui-radius)] px-2.5 py-2 text-left transition-colors';

function ConnectorRow<T extends ConnectorItem>({
  group,
  noun,
  onOpen,
}: {
  group: ConnectorGroup<T>;
  noun: string;
  onOpen: () => void;
}) {
  return (
    <button type="button" onClick={onOpen} className={cn(ROW_CLASS, 'hover:bg-[var(--wui-bg-subtle)]')}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--wui-radius)] bg-[var(--wui-bg-muted)] text-[var(--wui-fg)]">
        {getIcon(group.connectorIcon, { size: 16 })}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-[var(--wui-fg)]">{group.connectorName}</span>
        <span className="mt-0.5 block text-[11px] leading-tight text-[var(--wui-fg-muted)]">
          {countLabel(group.items.length, noun)}
        </span>
      </span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-[var(--wui-fg-subtle)]">
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>
  );
}

function ItemRow<T extends ConnectorItem>({
  item,
  connectorName,
  selected,
  onSelect,
}: {
  item: T;
  /** Shown beside the name when results from several connectors are mixed. */
  connectorName?: string | undefined;
  selected: boolean;
  onSelect: (item: T) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      aria-current={selected ? 'true' : undefined}
      className={cn(ROW_CLASS, selected ? 'bg-[var(--wui-primary-light)]' : 'hover:bg-[var(--wui-bg-subtle)]')}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--wui-radius)] bg-[var(--wui-primary-light)] text-[var(--wui-primary)]">
        {getIcon(item.icon, { size: 16 })}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-[13px] font-semibold text-[var(--wui-fg)]">{item.name}</span>
          {connectorName && (
            <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-[var(--wui-fg-subtle)]">
              {connectorName}
            </span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-[11px] leading-tight text-[var(--wui-fg-muted)]">{item.description}</span>
      </span>
      {selected && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="shrink-0 text-[var(--wui-primary)]">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </button>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center py-10">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="mb-2 text-[var(--wui-fg-subtle)]">
        <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
      </svg>
      <p className="text-[13px] text-[var(--wui-fg-muted)]">{text}</p>
    </div>
  );
}
