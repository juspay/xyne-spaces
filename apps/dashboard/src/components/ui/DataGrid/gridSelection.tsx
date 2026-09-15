/* eslint-disable local-rules/require-tracking-on-click */
import {
  useEffect,
  useState,
  type ChangeEvent,
  type ComponentType,
  type ReactElement,
} from 'react';
import type { GridApi, ICellRendererParams, IHeaderParams, IRowNode } from 'ag-grid-community';

export interface GridSelectionOptions<T> {
  // Rows that can't be selected (e.g. full-width group headers). Default: all.
  isSelectable?: (node: IRowNode<T>) => boolean;
  // Cap the number of rows select-all picks; over the cap, `onOverflow` fires.
  maxSelectable?: number;
  onOverflow?: (limit: number, total: number) => void;
  tracking: { category: string; selectAll: string; select: string; deselect: string };
  checkIcon: ComponentType<{ className?: string; strokeWidth?: number }>;
}

export interface GridSelectionRenderers<T> {
  IndexHeaderRenderer: (params: IHeaderParams<T>) => ReactElement;
  IndexCellRenderer: (params: ICellRendererParams<T>) => ReactElement | null;
}

// Shared ag-grid "select" column: a header select-all checkbox and a per-row
// index / hover-checkbox / selected-tick cell. Generic over the row type — the
// release table and the ticket board differ only in the options above.
export function createGridSelectionRenderers<T>(
  opts: GridSelectionOptions<T>,
): GridSelectionRenderers<T> {
  const { tracking, checkIcon: CheckIcon } = opts;
  const isSelectable = opts.isSelectable ?? (() => true);
  const maxSelectable = opts.maxSelectable ?? Infinity;

  const selectableNodes = (api: GridApi<T>): IRowNode<T>[] => {
    const nodes: IRowNode<T>[] = [];
    api.forEachNodeAfterFilterAndSort(node => {
      if (isSelectable(node)) nodes.push(node);
    });
    return nodes;
  };

  const IndexHeaderRenderer = (params: IHeaderParams<T>): ReactElement => {
    const [allSelected, setAllSelected] = useState(false);

    const handleSelectAll = (e: ChangeEvent<HTMLInputElement>): void => {
      const checked = e.target.checked;
      if (checked) {
        const nodes = selectableNodes(params.api);
        const capped = nodes.slice(0, maxSelectable);
        params.api.deselectAll();
        params.api.setNodesSelected({ nodes: capped, newValue: true });
        if (nodes.length > capped.length) opts.onOverflow?.(capped.length, nodes.length);
      } else {
        params.api.deselectAll();
      }
      setAllSelected(checked);
    };

    useEffect(() => {
      const onSelectionChanged = (): void => {
        const nodes = selectableNodes(params.api);
        const cap = Math.min(nodes.length, maxSelectable);
        const selected = nodes.filter(node => node.isSelected()).length;
        setAllSelected(cap > 0 && selected >= cap);
      };
      params.api.addEventListener('selectionChanged', onSelectionChanged);
      return () => params.api.removeEventListener('selectionChanged', onSelectionChanged);
    }, [params]);

    return (
      <div className='flex items-center justify-center h-full w-full'>
        <input
          type='checkbox'
          checked={allSelected}
          onChange={handleSelectAll}
          className='w-4 h-4 cursor-pointer'
          onClick={e => e.stopPropagation()}
          data-track-category={tracking.category}
          data-track-name={tracking.selectAll}
        />
      </div>
    );
  };

  const IndexCellRenderer = (params: ICellRendererParams<T>): ReactElement | null => {
    const [isHovered, setIsHovered] = useState(false);
    const [isSelected, setIsSelected] = useState(params.node.isSelected());
    const rowIndex = (params.node.rowIndex ?? 0) + 1;

    useEffect(() => {
      const onSelectionChanged = (): void => setIsSelected(params.node.isSelected());
      params.api.addEventListener('selectionChanged', onSelectionChanged);
      return () => params.api.removeEventListener('selectionChanged', onSelectionChanged);
    }, [params.api, params.node]);

    if (!isSelectable(params.node)) return null;

    return (
      <button
        className='flex items-center justify-center h-full w-full'
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {isSelected ? (
          <button
            className='flex items-center justify-center w-4 h-4 bg-blue-600 rounded cursor-pointer'
            onClick={e => {
              e.stopPropagation();
              params.node.setSelected(false);
            }}
            data-track-category={tracking.category}
            data-track-name={tracking.deselect}
          >
            <CheckIcon className='w-3 h-3 text-white' strokeWidth={3} />
          </button>
        ) : isHovered ? (
          <input
            type='checkbox'
            checked={isSelected}
            onChange={e => params.node.setSelected(e.target.checked)}
            className='w-4 h-4 cursor-pointer'
            onClick={e => e.stopPropagation()}
            data-track-category={tracking.category}
            data-track-name={tracking.select}
          />
        ) : (
          <span className='text-sm text-muted-foreground'>{rowIndex}</span>
        )}
      </button>
    );
  };

  return { IndexHeaderRenderer, IndexCellRenderer };
}
