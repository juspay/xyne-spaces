import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { DataSourceSchema } from '../../../services/DynamicDashboard/dataSourceSchemaService';
import { TableList } from './TableList';
import { TableDetailPanel } from './TableDetailPanel';

interface SchemaBrowserProps {
  schema: DataSourceSchema;
  dataSourceId: string;
  search: string;
}

export function SchemaBrowser({ schema, dataSourceId, search }: SchemaBrowserProps): ReactElement {
  const tables = useMemo(() => schema.tables ?? [], [schema]);
  const [selectedId, setSelectedId] = useState<string | null>(schema.tables?.[0]?.id ?? null);

  useEffect(() => {
    setSelectedId(schema.tables?.[0]?.id ?? null);
  }, [schema]);

  const selected = useMemo(
    () => tables.find(t => t.id === selectedId) ?? tables[0] ?? null,
    [tables, selectedId],
  );
  const relationships = schema.relationships ?? [];

  return (
    <div className='flex h-full min-h-0'>
      <div className='w-[250px] shrink-0 border-r border-border min-h-0 bg-muted/20'>
        <TableList
          tables={tables}
          selectedId={selected?.id ?? null}
          onSelect={setSelectedId}
          search={search}
        />
      </div>
      <div className='flex-1 min-w-0 min-h-0'>
        {selected ? (
          <TableDetailPanel
            table={selected}
            tables={tables}
            dataSourceId={dataSourceId}
            relationships={relationships}
            onSelectTable={setSelectedId}
          />
        ) : (
          <div className='flex items-center justify-center h-full text-sm text-muted-foreground'>
            No tables.
          </div>
        )}
      </div>
    </div>
  );
}
