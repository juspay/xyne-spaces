import { Fragment, useCallback, useEffect, useRef, useState, type FC, type RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChevronDown, Filter, Plus, Search, X } from 'lucide-react';
import { Input } from '../ui/Input';

const TABLE_FILTER_ID_ATTR = 'data-canvas-table-filter-id';
const TABLE_FILTER_HIGHLIGHT_NAME = 'canvas-table-filter-match';
const ALL_COLUMNS_VALUE = 'all';
const FILTERS_PER_ROW = 3;
const MAX_TABLE_FILTERS = 6;
const MAX_AUTOCOMPLETE_OPTIONS = 50;
const MAX_FILTER_DISPLAY_CHARS = 60;
const TABLE_FILTER_READY_PADDING_CLASS = '!pt-12';
const TABLE_FILTER_OPEN_PADDING_CLASS = '!pt-36';
const TABLE_FILTER_MOUNT_CLASS = 'pointer-events-none absolute right-7 top-2 z-20';

let nextTableFilterId = 1;
let nextWidgetFilterId = 1;
const tableHighlightRanges = new Map<string, Range[]>();

interface RegisteredTableFilter {
  blockContent: HTMLElement;
  mount: HTMLDivElement;
  reactRoot: Root;
  table: HTMLTableElement;
  wrapper: HTMLElement;
}

interface TableFilterWidgetProps {
  blockContent: HTMLElement;
  table: HTMLTableElement;
  wrapper: HTMLElement;
}

interface MatchCount {
  total: number;
  visible: number;
}

interface ColumnOption {
  value: string;
  label: string;
}

type AutocompleteOptionsByColumn = Record<string, string[]>;

interface TableMetadata {
  autocompleteOptionsByColumn: AutocompleteOptionsByColumn;
  columnOptions: ColumnOption[];
}

interface TableFilterState {
  id: string;
  column: string;
  query: string;
}

interface ActiveTableFilter {
  columnIndex: number | null;
  normalizedQuery: string;
  query: string;
}

type TableFilterMode = 'and' | 'or';

interface DomPosition {
  node: Text;
  offset: number;
}

interface NormalizedCharPosition {
  end: DomPosition;
  start: DomPosition;
}

const normalizeRowText = (value: string | null): string =>
  (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

const normalizeCellText = (value: string | null): string =>
  (value ?? '').replace(/\s+/g, ' ').trim();

const createTableFilter = (): TableFilterState => {
  const filter: TableFilterState = {
    id: `table-filter-${nextWidgetFilterId}`,
    column: ALL_COLUMNS_VALUE,
    query: '',
  };
  nextWidgetFilterId += 1;
  return filter;
};

const getTableFilterId = (blockContent: HTMLElement): string => {
  const existingId = blockContent.getAttribute(TABLE_FILTER_ID_ATTR);
  if (existingId) return existingId;

  const id = `canvas-table-filter-${nextTableFilterId}`;
  nextTableFilterId += 1;
  blockContent.setAttribute(TABLE_FILTER_ID_ATTR, id);
  return id;
};

const getSameTagIndex = (element: Element): number => {
  const tagName = element.tagName;
  const parent = element.parentElement;
  if (!parent) return 1;

  return (
    Array.from(parent.children)
      .filter(child => child.tagName === tagName)
      .indexOf(element) + 1
  );
};

const getCellColspan = (cell: HTMLTableCellElement): number => {
  const colspan = Number(cell.getAttribute('colspan') ?? cell.colSpan ?? 1);
  return Number.isFinite(colspan) && colspan > 0 ? colspan : 1;
};

const getRowColumnCount = (row: HTMLTableRowElement): number =>
  Array.from(row.cells).reduce((count, cell) => count + getCellColspan(cell), 0);

const getCellAtColumn = (
  row: HTMLTableRowElement,
  columnIndex: number,
): HTMLTableCellElement | null => {
  let currentColumn = 0;

  for (const cell of Array.from(row.cells)) {
    const colspan = getCellColspan(cell);
    if (columnIndex >= currentColumn && columnIndex < currentColumn + colspan) {
      return cell;
    }
    currentColumn += colspan;
  }

  return null;
};

const getFilterableRows = (table: HTMLTableElement): HTMLTableRowElement[] => {
  const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>('tr'));
  const headerRow = rows[0]?.querySelector('th') ? rows[0] : null;
  return rows.filter(row => row !== headerRow);
};

const formatColumnLabel = (index: number, label?: string): string => {
  const normalizedLabel = label?.replace(/\s+/g, ' ').trim();
  const fallback = `Column ${index + 1}`;
  if (!normalizedLabel) return fallback;
  return truncateFilterDisplayText(normalizedLabel);
};

const truncateFilterDisplayText = (value: string, maxLength = MAX_FILTER_DISPLAY_CHARS): string => {
  const normalizedValue = value.replace(/\s+/g, ' ').trim();
  if (normalizedValue.length <= maxLength) return normalizedValue;
  return `${normalizedValue.slice(0, maxLength - 3)}...`;
};

const getColumnOptions = (table: HTMLTableElement): ColumnOption[] => {
  const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>('tr'));
  const headerRow = rows[0]?.querySelector('th') ? rows[0] : null;
  const columnCount = Math.max(0, ...rows.map(getRowColumnCount));

  return Array.from({ length: columnCount }, (_, index) => ({
    value: String(index),
    label: formatColumnLabel(
      index,
      headerRow ? getCellAtColumn(headerRow, index)?.textContent : undefined,
    ),
  }));
};

const areColumnOptionsEqual = (left: ColumnOption[], right: ColumnOption[]): boolean =>
  left.length === right.length &&
  left.every((option, index) => {
    const rightOption = right[index];
    return rightOption?.value === option.value && rightOption.label === option.label;
  });

const addAutocompleteOption = (
  optionsByColumn: AutocompleteOptionsByColumn,
  seenValuesByColumn: Map<string, Set<string>>,
  column: string,
  value: string,
): void => {
  const options = optionsByColumn[column];
  if (!options || !value) return;

  const normalizedValue = value.toLowerCase();
  const seenValues = seenValuesByColumn.get(column);
  if (!seenValues || seenValues.has(normalizedValue)) return;

  seenValues.add(normalizedValue);
  options.push(value);
};

const getAutocompleteOptions = (
  table: HTMLTableElement,
  columnOptions: ColumnOption[],
): AutocompleteOptionsByColumn => {
  const optionsByColumn: AutocompleteOptionsByColumn = {};
  const seenValuesByColumn = new Map<string, Set<string>>();

  for (const option of columnOptions) {
    optionsByColumn[option.value] = [];
    seenValuesByColumn.set(option.value, new Set());
  }

  for (const row of getFilterableRows(table)) {
    for (const option of columnOptions) {
      const columnIndex = Number.parseInt(option.value, 10);
      const cell = getCellAtColumn(row, columnIndex);
      addAutocompleteOption(
        optionsByColumn,
        seenValuesByColumn,
        option.value,
        normalizeCellText(cell?.textContent ?? ''),
      );
    }
  }

  return optionsByColumn;
};

const getTableMetadata = (table: HTMLTableElement): TableMetadata => {
  const columnOptions = getColumnOptions(table);
  return {
    autocompleteOptionsByColumn: getAutocompleteOptions(table, columnOptions),
    columnOptions,
  };
};

const getVisibleAutocompleteOptions = (options: string[], query: string): string[] => {
  const normalizedQuery = normalizeRowText(query);
  if (!normalizedQuery) return options.slice(0, MAX_AUTOCOMPLETE_OPTIONS);

  const startsWithMatches: string[] = [];
  const containsMatches: string[] = [];

  for (const option of options) {
    const normalizedOption = normalizeRowText(option);
    if (!normalizedOption.includes(normalizedQuery)) continue;

    if (normalizedOption.startsWith(normalizedQuery)) {
      startsWithMatches.push(option);
    } else {
      containsMatches.push(option);
    }

    if (startsWithMatches.length >= MAX_AUTOCOMPLETE_OPTIONS) break;
  }

  return [...startsWithMatches, ...containsMatches].slice(0, MAX_AUTOCOMPLETE_OPTIONS);
};

const areAutocompleteOptionsEqual = (
  left: AutocompleteOptionsByColumn,
  right: AutocompleteOptionsByColumn,
): boolean => {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(key => {
      const leftOptions = left[key] ?? [];
      const rightOptions = right[key] ?? [];
      return (
        rightKeys.includes(key) &&
        leftOptions.length === rightOptions.length &&
        leftOptions.every((option, index) => option === rightOptions[index])
      );
    })
  );
};

const getHiddenRowSelector = (
  tableId: string,
  table: HTMLTableElement,
  row: HTMLTableRowElement,
): string | null => {
  const parent = row.parentElement;
  if (!parent) return null;

  const rowIndex = Array.from(parent.children)
    .filter((element): element is HTMLTableRowElement => element.tagName === 'TR')
    .indexOf(row);

  if (rowIndex < 0) return null;

  const rowSelector = `tr:nth-of-type(${rowIndex + 1})`;
  const tableSelector = `[${TABLE_FILTER_ID_ATTR}="${tableId}"] .tableWrapper-inner table`;

  if (parent === table) {
    return `${tableSelector} > ${rowSelector}`;
  }

  const parentTag = parent.tagName.toLowerCase();
  if (!['thead', 'tbody', 'tfoot'].includes(parentTag)) {
    return null;
  }

  const sectionIndex = getSameTagIndex(parent);
  return `${tableSelector} > ${parentTag}:nth-of-type(${sectionIndex}) > ${rowSelector}`;
};

const syncTableFilterHighlights = (): void => {
  if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return;

  const ranges = Array.from(tableHighlightRanges.values()).flat();
  if (ranges.length === 0) {
    CSS.highlights.delete(TABLE_FILTER_HIGHLIGHT_NAME);
    return;
  }

  CSS.highlights.set(TABLE_FILTER_HIGHLIGHT_NAME, new Highlight(...ranges));
};

const setTableHighlightRanges = (tableId: string, ranges: Range[]): void => {
  if (ranges.length === 0) {
    tableHighlightRanges.delete(tableId);
  } else {
    tableHighlightRanges.set(tableId, ranges);
  }

  syncTableFilterHighlights();
};

const createNormalizedTextIndex = (
  textNodes: Text[],
): { positions: NormalizedCharPosition[]; text: string } => {
  const positions: NormalizedCharPosition[] = [];
  let text = '';
  let pendingWhitespace: NormalizedCharPosition | null = null;

  const appendChar = (value: string, position: NormalizedCharPosition): void => {
    for (const char of value) {
      text += char;
      positions.push(position);
    }
  };

  const appendPendingWhitespace = (): void => {
    if (!pendingWhitespace || text.length === 0) {
      pendingWhitespace = null;
      return;
    }

    appendChar(' ', pendingWhitespace);
    pendingWhitespace = null;
  };

  for (const node of textNodes) {
    const nodeText = node.textContent ?? '';

    for (let offset = 0; offset < nodeText.length; offset += 1) {
      const char = nodeText.charAt(offset);
      const position = {
        start: { node, offset },
        end: { node, offset: offset + 1 },
      };

      if (/\s/.test(char)) {
        if (!pendingWhitespace && text.length > 0) {
          pendingWhitespace = position;
        } else if (pendingWhitespace) {
          pendingWhitespace.end = position.end;
        }
        continue;
      }

      appendPendingWhitespace();
      appendChar(char.toLowerCase(), position);
    }
  }

  return { positions, text };
};

const createHighlightRanges = (element: Element, query: string): Range[] => {
  const normalizedQuery = normalizeRowText(query);
  if (!normalizedQuery) return [];

  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node: Node | null;

  while ((node = walker.nextNode())) {
    if (node.textContent) textNodes.push(node as Text);
  }

  const { positions, text: normalizedText } = createNormalizedTextIndex(textNodes);
  const ranges: Range[] = [];
  let matchIndex = normalizedText.indexOf(normalizedQuery);

  while (matchIndex !== -1) {
    const start = positions[matchIndex]?.start;
    const end = positions[matchIndex + normalizedQuery.length - 1]?.end;

    if (start && end) {
      const range = document.createRange();
      try {
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        ranges.push(range);
      } catch {
        // Live editor DOM can shift while typing; next pass rebuilds ranges.
      }
    }

    matchIndex = normalizedText.indexOf(normalizedQuery, matchIndex + normalizedQuery.length);
  }

  return ranges;
};

const getHighlightTargets = (row: HTMLTableRowElement, columnIndex: number | null): Element[] => {
  if (columnIndex !== null) {
    const cell = getCellAtColumn(row, columnIndex);
    return cell ? [cell] : [];
  }

  return Array.from(row.cells);
};

const getSafeColumnIndex = (column: string, columnOptions: ColumnOption[]): number | null => {
  if (column === ALL_COLUMNS_VALUE) return null;

  const columnIndex = Number.parseInt(column, 10);
  return Number.isInteger(columnIndex) && columnIndex >= 0 && columnIndex < columnOptions.length
    ? columnIndex
    : null;
};

const getPanelWidthClass = (filtersInLongestRow: number): string => {
  if (filtersInLongestRow <= 1) return 'w-[360px]';
  if (filtersInLongestRow === 2) return 'w-[620px]';
  return 'w-[900px]';
};

const getFilterRowGridClass = (filterCount: number): string => {
  if (filterCount <= 1) return 'grid-cols-[minmax(0,1fr)]';
  if (filterCount === 2) return 'grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]';
  return 'grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]';
};

const CanvasTableFilterWidget: FC<TableFilterWidgetProps> = ({ blockContent, table, wrapper }) => {
  const initialMetadataRef = useRef<TableMetadata | null>(null);
  const getInitialMetadata = (): TableMetadata => {
    initialMetadataRef.current ??= getTableMetadata(table);
    return initialMetadataRef.current;
  };

  const [isOpen, setIsOpen] = useState(false);
  const [filters, setFilters] = useState<TableFilterState[]>(() => [createTableFilter()]);
  const [filterMode, setFilterMode] = useState<TableFilterMode>('and');
  const [focusedFilterId, setFocusedFilterId] = useState<string | null>(null);
  const [openColumnFilterId, setOpenColumnFilterId] = useState<string | null>(null);
  const [columnOptions, setColumnOptions] = useState<ColumnOption[]>(
    () => getInitialMetadata().columnOptions,
  );
  const [autocompleteOptionsByColumn, setAutocompleteOptionsByColumn] =
    useState<AutocompleteOptionsByColumn>(() => getInitialMetadata().autocompleteOptionsByColumn);
  const [matchCount, setMatchCount] = useState<MatchCount>({ total: 0, visible: 0 });
  const columnOptionsRef = useRef<ColumnOption[]>(columnOptions);
  const styleRef = useRef<HTMLStyleElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputRefsRef = useRef<Map<string, HTMLInputElement>>(new Map());
  const animationFrameRef = useRef<number | null>(null);

  const refreshTableMetadata = useCallback(() => {
    const nextMetadata = getTableMetadata(table);
    columnOptionsRef.current = nextMetadata.columnOptions;

    setColumnOptions(previous =>
      areColumnOptionsEqual(previous, nextMetadata.columnOptions)
        ? previous
        : nextMetadata.columnOptions,
    );
    setAutocompleteOptionsByColumn(previous =>
      areAutocompleteOptionsEqual(previous, nextMetadata.autocompleteOptionsByColumn)
        ? previous
        : nextMetadata.autocompleteOptionsByColumn,
    );
  }, [table]);

  const applyFilter = useCallback(() => {
    const tableId = getTableFilterId(blockContent);
    const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>('tr'));
    const currentColumnOptions = columnOptionsRef.current;
    const activeFilters: ActiveTableFilter[] = filters
      .map(filter => ({
        columnIndex: getSafeColumnIndex(filter.column, currentColumnOptions),
        normalizedQuery: normalizeRowText(filter.query),
        query: filter.query,
      }))
      .filter(filter => filter.normalizedQuery.length > 0);
    const headerRow = rows[0]?.querySelector('th') ? rows[0] : null;
    const filterableRows = getFilterableRows(table);
    const hiddenSelectors: string[] = [];
    const highlightRanges: Range[] = [];
    let visible = filterableRows.length;

    if (activeFilters.length > 0) {
      visible = 0;

      for (const row of rows) {
        if (row === headerRow) continue;

        const filterMatchesRow = (filter: ActiveTableFilter): boolean => {
          const searchTarget =
            filter.columnIndex === null ? row : getCellAtColumn(row, filter.columnIndex);
          return normalizeRowText(searchTarget?.textContent ?? '').includes(filter.normalizedQuery);
        };

        const rowMatches =
          filterMode === 'and'
            ? activeFilters.every(filterMatchesRow)
            : activeFilters.some(filterMatchesRow);

        if (rowMatches) {
          visible += 1;
          for (const filter of activeFilters) {
            for (const target of getHighlightTargets(row, filter.columnIndex)) {
              highlightRanges.push(...createHighlightRanges(target, filter.query));
            }
          }
          continue;
        }

        const selector = getHiddenRowSelector(tableId, table, row);
        if (selector) hiddenSelectors.push(selector);
      }
    }

    if (styleRef.current) {
      styleRef.current.textContent =
        hiddenSelectors.length > 0
          ? `${hiddenSelectors.join(',')} { display: none !important; }`
          : '';
    }

    setTableHighlightRanges(tableId, highlightRanges);

    setMatchCount(previous =>
      previous.total === filterableRows.length && previous.visible === visible
        ? previous
        : { total: filterableRows.length, visible },
    );
  }, [blockContent, filterMode, filters, table]);

  const scheduleApplyFilter = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = null;
      refreshTableMetadata();
      applyFilter();
    });
  }, [applyFilter, refreshTableMetadata]);

  useEffect(() => {
    applyFilter();
  }, [applyFilter]);

  useEffect(() => {
    const observer = new MutationObserver(scheduleApplyFilter);
    observer.observe(table, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [scheduleApplyFilter, table]);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    } else {
      setOpenColumnFilterId(null);
      setFocusedFilterId(null);
    }
    wrapper.classList.remove(TABLE_FILTER_READY_PADDING_CLASS);
    wrapper.classList.remove(TABLE_FILTER_OPEN_PADDING_CLASS);

    return () => {
      wrapper.classList.remove(TABLE_FILTER_OPEN_PADDING_CLASS);
      wrapper.classList.remove(TABLE_FILTER_READY_PADDING_CLASS);
    };
  }, [isOpen, wrapper]);

  useEffect(() => {
    setFilters(previous => {
      let didChange = false;
      const nextFilters = previous.map(filter => {
        if (
          filter.column === ALL_COLUMNS_VALUE ||
          columnOptions.some(option => option.value === filter.column)
        ) {
          return filter;
        }

        didChange = true;
        return { ...filter, column: ALL_COLUMNS_VALUE };
      });

      return didChange ? nextFilters : previous;
    });
  }, [columnOptions]);

  useEffect(() => {
    return () => {
      const tableId = blockContent.getAttribute(TABLE_FILTER_ID_ATTR);
      if (tableId?.startsWith('canvas-table-filter-')) {
        setTableHighlightRanges(tableId, []);
        blockContent.removeAttribute(TABLE_FILTER_ID_ATTR);
      }
    };
  }, [blockContent]);

  const activeFilterCount = filters.filter(filter => filter.query.trim().length > 0).length;
  const hasActiveFilters = activeFilterCount > 0;
  const hasMaxFilters = filters.length >= MAX_TABLE_FILTERS;
  const hasMultipleFilters = filters.length > 1;

  const updateFilter = (id: string, patch: Partial<Omit<TableFilterState, 'id'>>): void => {
    setFilters(previous =>
      previous.map(filter => (filter.id === id ? { ...filter, ...patch } : filter)),
    );
  };

  const removeFilter = (id: string): void => {
    setOpenColumnFilterId(previous => (previous === id ? null : previous));
    setFilters(previous => {
      const firstFilter = previous[0];
      if (!firstFilter) return [createTableFilter()];

      if (previous.length === 1) {
        return [{ ...firstFilter, column: ALL_COLUMNS_VALUE, query: '' }];
      }

      return previous.filter(filter => filter.id !== id);
    });
  };

  const resetFilters = (shouldFocus = true): void => {
    setOpenColumnFilterId(null);
    setFilters([createTableFilter()]);
    if (shouldFocus) inputRef.current?.focus();
  };

  const addFilter = (): void => {
    setOpenColumnFilterId(null);
    setFilters(previous =>
      previous.length >= MAX_TABLE_FILTERS ? previous : [...previous, createTableFilter()],
    );
  };

  const focusFilterInput = (id: string): void => {
    requestAnimationFrame(() => {
      inputRefsRef.current.get(id)?.focus();
    });
  };

  const renderFilterConnector = () => (
    <span
      className='self-center px-0.5 text-[10px] font-bold leading-none tracking-normal text-muted-foreground'
      aria-label={`Table filters joined by ${filterMode.toUpperCase()}`}
    >
      {filterMode.toUpperCase()}
    </span>
  );

  const filterRows = Array.from(
    { length: Math.ceil(filters.length / FILTERS_PER_ROW) },
    (_, rowIndex) => filters.slice(rowIndex * FILTERS_PER_ROW, (rowIndex + 1) * FILTERS_PER_ROW),
  );
  const panelWidthClass = getPanelWidthClass(Math.min(filters.length, FILTERS_PER_ROW));

  return (
    <div
      className='pointer-events-auto flex items-center text-xs leading-4 tracking-normal text-popover-foreground'
      contentEditable={false}
      data-track-category='CANVAS'
      data-track-name='table_filter_event_boundary'
      role='presentation'
      onClick={event => event.stopPropagation()}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key !== 'Escape') return;

        if (openColumnFilterId) {
          setOpenColumnFilterId(null);
          return;
        }

        setIsOpen(false);
      }}
      onMouseDown={event => event.stopPropagation()}
      onPointerDown={event => event.stopPropagation()}
    >
      <style ref={styleRef} />
      {!isOpen ? (
        <button
          type='button'
          className='inline-flex size-7 cursor-pointer items-center justify-center rounded-md border bg-popover text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground data-[active=true]:border-ring/30 data-[active=true]:bg-accent data-[active=true]:text-foreground'
          data-active={hasActiveFilters ? 'true' : 'false'}
          data-track-category='CANVAS'
          data-track-name='table_filter_open'
          aria-label='Filter table rows'
          aria-pressed={hasActiveFilters}
          title='Filter table rows'
          onMouseDown={event => event.preventDefault()}
          onClick={() => setIsOpen(true)}
        >
          <Filter size={14} strokeWidth={2} />
        </button>
      ) : (
        <div
          className={`flex ${panelWidthClass} max-w-[calc(100vw-96px)] flex-col items-stretch gap-[7px] overflow-visible rounded-md border bg-popover p-2 text-popover-foreground shadow-md`}
        >
          <div className='flex items-center gap-1.5'>
            <div className='flex min-w-0 flex-1 items-center gap-1.5 font-medium'>
              <Search size={14} strokeWidth={2} className='shrink-0 text-muted-foreground' />
              {hasActiveFilters && (
                <span
                  className='shrink-0 whitespace-nowrap text-muted-foreground tabular-nums'
                  aria-live='polite'
                >
                  {matchCount.visible}/{matchCount.total}
                </span>
              )}
            </div>
            {hasMultipleFilters && (
              <div
                className='inline-flex shrink-0 overflow-hidden rounded-[5px] border bg-muted/50'
                role='group'
                aria-label='Table filter mode'
              >
                <button
                  type='button'
                  className='h-6 min-w-10 cursor-pointer border-0 bg-transparent text-[11px] font-semibold leading-4 tracking-normal text-muted-foreground data-[active=true]:bg-popover data-[active=true]:text-foreground'
                  data-active={filterMode === 'and' ? 'true' : 'false'}
                  data-track-category='CANVAS'
                  data-track-name='table_filter_mode_and'
                  aria-pressed={filterMode === 'and'}
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => setFilterMode('and')}
                >
                  AND
                </button>
                <button
                  type='button'
                  className='h-6 min-w-10 cursor-pointer border-0 bg-transparent text-[11px] font-semibold leading-4 tracking-normal text-muted-foreground data-[active=true]:bg-popover data-[active=true]:text-foreground'
                  data-active={filterMode === 'or' ? 'true' : 'false'}
                  data-track-category='CANVAS'
                  data-track-name='table_filter_mode_or'
                  aria-pressed={filterMode === 'or'}
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => setFilterMode('or')}
                >
                  OR
                </button>
              </div>
            )}
            <span
              className='inline-flex shrink-0'
              title={hasMaxFilters ? 'Capped at 6 max filters' : undefined}
            >
              <button
                type='button'
                className='inline-flex size-6 cursor-pointer items-center justify-center rounded-md border bg-popover text-muted-foreground shadow-none transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:cursor-default disabled:opacity-[0.45]'
                data-track-category='CANVAS'
                data-track-name='table_filter_add'
                aria-label='Add table filter'
                title={hasMaxFilters ? undefined : 'Add table filter'}
                disabled={hasMaxFilters}
                onMouseDown={event => event.preventDefault()}
                onClick={addFilter}
              >
                <Plus size={14} strokeWidth={2} />
              </button>
            </span>
            <button
              type='button'
              className='inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md border bg-popover text-muted-foreground shadow-none transition-colors hover:bg-accent hover:text-foreground'
              data-track-category='CANVAS'
              data-track-name='table_filter_close'
              aria-label={
                hasActiveFilters ? 'Clear and close table filters' : 'Close table filters'
              }
              title={hasActiveFilters ? 'Clear and close table filters' : 'Close table filters'}
              onMouseDown={event => event.preventDefault()}
              onClick={() => {
                if (hasActiveFilters) {
                  resetFilters(false);
                }

                setIsOpen(false);
              }}
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>
          <div className='flex w-full flex-col gap-1.5 overflow-visible'>
            {filterRows.map((rowFilters, rowIndex) => (
              <div
                key={rowFilters.map(filter => filter.id).join('-')}
                className={`grid w-full ${getFilterRowGridClass(rowFilters.length)} items-center gap-1.5 overflow-visible`}
              >
                {rowFilters.map((filter, columnIndex) => {
                  const index = rowIndex * FILTERS_PER_ROW + columnIndex;
                  const columnSelectorOptions = [
                    { value: ALL_COLUMNS_VALUE, label: 'All columns' },
                    ...columnOptions,
                  ];
                  const selectedColumnLabel =
                    columnSelectorOptions.find(option => option.value === filter.column)?.label ??
                    'All columns';
                  const autocompleteOptions =
                    filter.column === ALL_COLUMNS_VALUE
                      ? []
                      : getVisibleAutocompleteOptions(
                          autocompleteOptionsByColumn[filter.column] ?? [],
                          filter.query,
                        );
                  const showAutocomplete =
                    focusedFilterId === filter.id && autocompleteOptions.length > 0;

                  return (
                    <Fragment key={filter.id}>
                      {columnIndex > 0 && renderFilterConnector()}
                      <div className='relative flex h-8 min-w-0 items-center gap-1.5 rounded-md border bg-muted/40 p-[3px]'>
                        <div className='relative flex-none'>
                          <button
                            type='button'
                            className='inline-flex h-[26px] w-36 min-w-36 max-w-36 cursor-pointer items-center justify-between gap-1 rounded-md border-0 bg-popover px-2 text-left text-xs leading-4 tracking-normal text-popover-foreground shadow-none transition-colors hover:bg-accent hover:text-accent-foreground'
                            data-track-category='CANVAS'
                            data-track-name='table_filter_column_menu_open'
                            aria-label='Filter table column'
                            aria-haspopup='listbox'
                            aria-expanded={openColumnFilterId === filter.id}
                            onMouseDown={event => event.preventDefault()}
                            onClick={() => {
                              setFocusedFilterId(null);
                              setOpenColumnFilterId(previous =>
                                previous === filter.id ? null : filter.id,
                              );
                            }}
                          >
                            <span className='min-w-0 flex-1 truncate'>{selectedColumnLabel}</span>
                            <ChevronDown
                              size={14}
                              strokeWidth={2}
                              className='shrink-0 text-muted-foreground'
                            />
                          </button>
                          {openColumnFilterId === filter.id && (
                            <div
                              className='absolute left-0 top-8 z-[110] max-h-44 w-44 overflow-y-auto overscroll-contain rounded-md border bg-popover p-1 text-popover-foreground shadow-md'
                              role='listbox'
                              aria-label='Filter table column'
                            >
                              {columnSelectorOptions.map(option => (
                                <button
                                  key={option.value}
                                  type='button'
                                  className='flex w-full min-w-0 cursor-pointer items-center rounded-sm px-2 py-1.5 text-left text-xs leading-4 tracking-normal hover:bg-accent hover:text-accent-foreground data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground'
                                  data-selected={option.value === filter.column ? 'true' : 'false'}
                                  data-track-category='CANVAS'
                                  data-track-name='table_filter_column_select'
                                  role='option'
                                  aria-selected={option.value === filter.column}
                                  title={option.label}
                                  onMouseDown={event => event.preventDefault()}
                                  onClick={() => {
                                    updateFilter(filter.id, { column: option.value });
                                    setOpenColumnFilterId(null);
                                    setFocusedFilterId(filter.id);
                                    focusFilterInput(filter.id);
                                  }}
                                >
                                  <span className='min-w-0 whitespace-normal break-words'>
                                    {option.label}
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className='relative flex min-w-0 flex-1 items-center gap-1.5'>
                          <div className='min-w-0 flex-1'>
                            <Input
                              ref={node => {
                                if (node) {
                                  inputRefsRef.current.set(filter.id, node);
                                } else {
                                  inputRefsRef.current.delete(filter.id);
                                }

                                if (index === 0) inputRef.current = node;
                              }}
                              value={filter.query}
                              className='h-[26px] min-w-0 border-0 bg-transparent px-0.5 text-xs leading-4 tracking-normal text-popover-foreground shadow-none outline-none placeholder:text-muted-foreground placeholder:opacity-80 focus-visible:border-0 focus-visible:ring-0'
                              placeholder='Filter rows'
                              aria-label='Filter table rows'
                              onFocus={() => {
                                setOpenColumnFilterId(null);
                                setFocusedFilterId(filter.id);
                              }}
                              onBlur={() =>
                                setFocusedFilterId(previous =>
                                  previous === filter.id ? null : previous,
                                )
                              }
                              onChange={event =>
                                updateFilter(filter.id, { query: event.target.value })
                              }
                            />
                          </div>
                          <button
                            type='button'
                            className='inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md border border-transparent bg-transparent text-muted-foreground shadow-none transition-colors hover:bg-accent hover:text-foreground'
                            data-track-category='CANVAS'
                            data-track-name='table_filter_remove'
                            aria-label='Remove table filter'
                            title='Remove table filter'
                            onMouseDown={event => event.preventDefault()}
                            onClick={() => removeFilter(filter.id)}
                          >
                            <X size={14} strokeWidth={2} />
                          </button>
                          {showAutocomplete && (
                            <div className='absolute left-0 top-8 z-[100] max-h-44 w-full overflow-y-auto overscroll-contain rounded-md border bg-popover p-1 text-popover-foreground shadow-md'>
                              {autocompleteOptions.map(option => (
                                <button
                                  key={option}
                                  type='button'
                                  className='flex w-full min-w-0 cursor-pointer items-center rounded-sm px-2 py-1.5 text-left text-xs leading-4 tracking-normal hover:bg-accent hover:text-accent-foreground'
                                  data-track-category='CANVAS'
                                  data-track-name='table_filter_autocomplete_select'
                                  title={option}
                                  onMouseDown={event => {
                                    event.preventDefault();
                                    updateFilter(filter.id, { query: option });
                                    setFocusedFilterId(null);
                                  }}
                                >
                                  <span className='min-w-0 whitespace-normal break-words'>
                                    {truncateFilterDisplayText(option)}
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </Fragment>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const cleanupRegistration = (registration: RegisteredTableFilter): void => {
  registration.reactRoot.unmount();
  registration.mount.remove();
  registration.wrapper.classList.remove(TABLE_FILTER_READY_PADDING_CLASS);
  registration.wrapper.classList.remove(TABLE_FILTER_OPEN_PADDING_CLASS);
};

export const useCanvasTableFilters = (containerRef: RefObject<HTMLElement | null>): void => {
  const registrationsRef = useRef<Map<HTMLElement, RegisteredTableFilter>>(new Map());
  const animationFrameRef = useRef<number | null>(null);

  const syncFilters = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const tableBlocks = Array.from(
      container.querySelectorAll<HTMLElement>('.bn-block-content[data-content-type="table"]'),
    );
    const activeWrappers = new Set<HTMLElement>();

    for (const blockContent of tableBlocks) {
      const wrapper = blockContent.querySelector<HTMLElement>(':scope > .tableWrapper');
      const table = wrapper?.querySelector<HTMLTableElement>('.tableWrapper-inner table');

      if (!wrapper || !table) continue;

      activeWrappers.add(wrapper);

      const existing = registrationsRef.current.get(wrapper);
      if (existing) {
        const isSameTableRegistration =
          existing.table === table && existing.blockContent === blockContent;
        const isMountAttached = existing.mount.parentElement === blockContent;

        if (isSameTableRegistration && isMountAttached) continue;

        cleanupRegistration(existing);
        registrationsRef.current.delete(wrapper);
      }

      // On the block, not the wrapper: the wrapper scrolls sideways for a wide
      // table and would carry the button off with it.
      const mount = document.createElement('div');
      mount.className = TABLE_FILTER_MOUNT_CLASS;
      blockContent.appendChild(mount);

      const reactRoot = createRoot(mount);
      reactRoot.render(
        <CanvasTableFilterWidget blockContent={blockContent} table={table} wrapper={wrapper} />,
      );

      registrationsRef.current.set(wrapper, {
        blockContent,
        mount,
        reactRoot,
        table,
        wrapper,
      });
    }

    for (const [wrapper, registration] of registrationsRef.current.entries()) {
      if (!activeWrappers.has(wrapper) || !container.contains(wrapper)) {
        cleanupRegistration(registration);
        registrationsRef.current.delete(wrapper);
      }
    }
  }, [containerRef]);

  const scheduleSyncFilters = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = null;
      syncFilters();
    });
  }, [syncFilters]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    syncFilters();

    const observer = new MutationObserver(scheduleSyncFilters);
    observer.observe(container, {
      childList: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();

      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }

      for (const registration of registrationsRef.current.values()) {
        cleanupRegistration(registration);
      }
      registrationsRef.current.clear();
    };
  }, [containerRef, scheduleSyncFilters, syncFilters]);
};
