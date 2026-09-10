import { useMemo, type ReactElement } from 'react';
import { Table2 } from 'lucide-react';
import type { DataSourceTable } from '../../../services/DynamicDashboard/dataSourceSchemaService';

interface TableListProps {
  tables: DataSourceTable[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  search: string;
}

export function TableList({ tables, selectedId, onSelect, search }: TableListProps): ReactElement {
  const q = search.trim().toLowerCase();
  const filtered = useMemo(
    () => tables.filter(t => q === '' || t.tableName.toLowerCase().includes(q)),
    [tables, q],
  );
  const multiSchema = useMemo(() => new Set(tables.map(t => t.schemaName)).size > 1, [tables]);
  const groups = useMemo(() => {
    const map = new Map<string, DataSourceTable[]>();
    for (const t of filtered) {
      const arr = map.get(t.schemaName) ?? [];
      arr.push(t);
      map.set(t.schemaName, arr);
    }
    return [...map.entries()];
  }, [filtered]);

  return (
    <div className='flex flex-col h-full min-h-0'>
      <div className='flex items-center justify-between px-3 h-10 shrink-0 border-b border-border/70'>
        <span className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>
          Tables
        </span>
        <span className='inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-muted text-[10px] font-semibold text-muted-foreground'>
          {filtered.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className='flex-1 flex items-center justify-center px-4 text-center text-[12px] text-muted-foreground'>
          No tables match “{search}”.
        </div>
      ) : (
        <div className='flex-1 min-h-0 overflow-y-auto py-1.5'>
          {groups.map(([schemaName, group]) => (
            <div key={schemaName} className='mb-1'>
              {multiSchema && (
                <div className='px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70'>
                  {schemaName}
                </div>
              )}
              {group.map(t => {
                const active = t.id === selectedId;
                return (
                  <button
                    key={t.id}
                    type='button'
                    onClick={() => onSelect(t.id)}
                    data-track-category='DYNAMIC_DASHBOARD'
                    data-track-name='Db_Browser_Select_Table'
                    className={`group relative w-full flex items-center gap-2.5 pl-3 pr-2 py-[7px] text-left transition-colors ${
                      active ? 'bg-accent' : 'hover:bg-accent/50'
                    }`}
                  >
                    <span
                      className={`absolute left-0 top-1 bottom-1 w-[3px] rounded-r-full transition-opacity ${
                        active ? 'bg-primary opacity-100' : 'opacity-0'
                      }`}
                    />
                    <Table2
                      size={14}
                      className={`shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`}
                    />
                    <span
                      className={`flex-1 truncate text-[13px] ${
                        active ? 'font-semibold text-foreground' : 'font-medium text-foreground/85'
                      }`}
                    >
                      {t.tableName}
                    </span>
                    <span
                      className={`shrink-0 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded text-[10px] font-medium ${
                        active
                          ? 'bg-primary/10 text-primary'
                          : 'bg-muted text-muted-foreground group-hover:bg-background'
                      }`}
                    >
                      {t.columns.length}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
