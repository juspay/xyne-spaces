import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { AlertCircle, ArrowRight, Inbox, KeyRound, Link2, Loader2, Table2 } from 'lucide-react';
import type {
  DataSourceColumn,
  DataSourceRelationship,
  DataSourceTable,
} from '../../../services/DynamicDashboard/dataSourceSchemaService';
import { SegmentedToggle } from '../../ui/SegmentedToggle/SegmentedToggle';
import TableRenderer from '../ComponentGrid/renderers/TableRenderer';
import { useRawTablePreview } from '../../../hooks/useComponentPreview';
import { TYPE_META } from './typeMeta';

type DetailTab = 'structure' | 'data' | 'relations';

interface TableDetailPanelProps {
  table: DataSourceTable;
  tables: DataSourceTable[];
  dataSourceId: string;
  relationships: DataSourceRelationship[];
  onSelectTable: (id: string) => void;
}

function Center({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className='flex flex-col items-center justify-center gap-2.5 h-full text-sm text-muted-foreground'>
      {children}
    </div>
  );
}

export function TableDetailPanel({
  table,
  tables,
  dataSourceId,
  relationships,
  onSelectTable,
}: TableDetailPanelProps): ReactElement {
  const [tab, setTab] = useState<DetailTab>('structure');

  const pkCols = useMemo(
    () => table.columns.filter(c => c.isPrimaryKey).map(c => c.columnName),
    [table],
  );
  const fkByColumn = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of relationships) {
      if (r.fromSchema === table.schemaName && r.fromTable === table.tableName) {
        map.set(r.fromColumn, `${r.toTable}.${r.toColumn}`);
      }
    }
    return map;
  }, [relationships, table]);
  const outgoing = useMemo(
    () =>
      relationships.filter(
        r => r.fromSchema === table.schemaName && r.fromTable === table.tableName,
      ),
    [relationships, table],
  );
  const incoming = useMemo(
    () =>
      relationships.filter(r => r.toSchema === table.schemaName && r.toTable === table.tableName),
    [relationships, table],
  );
  const tableIdByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tables) map.set(`${t.schemaName}.${t.tableName}`, t.id);
    return map;
  }, [tables]);

  const relCount = outgoing.length + incoming.length;

  return (
    <div className='flex flex-col h-full min-h-0'>
      <div className='px-5 pt-4 pb-3 border-b border-border shrink-0'>
        <div className='flex items-center gap-3'>
          <span className='shrink-0 flex items-center justify-center w-9 h-9 rounded-lg bg-muted'>
            <Table2 size={17} className='text-muted-foreground' />
          </span>
          <div className='min-w-0'>
            <h3 className='font-mono text-[16px] font-semibold text-foreground truncate leading-tight'>
              {table.tableName}
            </h3>
            <div className='flex items-center gap-2 mt-1 text-[11px] text-muted-foreground'>
              <span>{table.schemaName}</span>
              <span className='w-1 h-1 rounded-full bg-border' />
              <span>{table.columns.length} columns</span>
              {pkCols.length > 0 && (
                <>
                  <span className='w-1 h-1 rounded-full bg-border' />
                  <span className='inline-flex items-center gap-1'>
                    <KeyRound size={11} className='text-amber-500' />
                    {pkCols.join(', ')}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className='mt-3.5'>
          <SegmentedToggle
            options={[
              { value: 'structure', label: 'Structure' },
              { value: 'data', label: 'Data' },
              { value: 'relations', label: relCount > 0 ? `Relations · ${relCount}` : 'Relations' },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>
      </div>

      <div className='flex-1 min-h-0 overflow-hidden'>
        {tab === 'structure' ? (
          <StructurePanel columns={table.columns} fkByColumn={fkByColumn} />
        ) : tab === 'data' ? (
          <DataPanel dataSourceId={dataSourceId} table={table} />
        ) : (
          <RelationsPanel
            outgoing={outgoing}
            incoming={incoming}
            tableIdByName={tableIdByName}
            onSelectTable={onSelectTable}
          />
        )}
      </div>
    </div>
  );
}

function StructurePanel({
  columns,
  fkByColumn,
}: {
  columns: DataSourceColumn[];
  fkByColumn: Map<string, string>;
}): ReactElement {
  return (
    <div className='h-full overflow-auto p-4'>
      <div className='rounded-xl border border-border overflow-hidden'>
        <table className='w-full border-collapse text-[12px]'>
          <thead className='sticky top-0 z-10'>
            <tr className='bg-muted/80 backdrop-blur supports-[backdrop-filter]:bg-muted/60'>
              <th className='text-left font-semibold text-[10px] uppercase tracking-wider text-muted-foreground px-4 py-2.5'>
                Column
              </th>
              <th className='text-left font-semibold text-[10px] uppercase tracking-wider text-muted-foreground px-3 py-2.5'>
                Type
              </th>
              <th className='text-left font-semibold text-[10px] uppercase tracking-wider text-muted-foreground px-3 py-2.5'>
                Nullable
              </th>
              <th className='text-left font-semibold text-[10px] uppercase tracking-wider text-muted-foreground px-3 py-2.5'>
                Key
              </th>
            </tr>
          </thead>
          <tbody>
            {columns.map(c => {
              const meta = TYPE_META[c.dataTypeCanonical] ?? TYPE_META.unknown;
              const fk = fkByColumn.get(c.columnName);
              return (
                <tr
                  key={c.id}
                  className='border-t border-border/60 hover:bg-accent/40 transition-colors'
                >
                  <td className='px-4 py-2'>
                    <span className='inline-flex items-center gap-2'>
                      {c.isPrimaryKey ? (
                        <KeyRound size={12} className='shrink-0 text-amber-500' />
                      ) : fk ? (
                        <Link2 size={12} className='shrink-0 text-primary' />
                      ) : (
                        <span className='w-3 shrink-0' />
                      )}
                      <span
                        className={`font-mono ${
                          c.isPrimaryKey ? 'font-semibold text-foreground' : 'text-foreground/90'
                        }`}
                      >
                        {c.columnName}
                      </span>
                    </span>
                  </td>
                  <td className='px-3 py-2'>
                    <span className='inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-muted/70 border border-border/60'>
                      <meta.Icon size={11} className={meta.className} />
                      <span className='font-mono text-[11px] text-foreground/80'>
                        {c.dataTypeNative}
                      </span>
                    </span>
                  </td>
                  <td className='px-3 py-2'>
                    <span className='text-[11px] text-muted-foreground'>
                      {c.isNullable ? 'nullable' : 'not null'}
                    </span>
                  </td>
                  <td className='px-3 py-2'>
                    {c.isPrimaryKey ? (
                      <span className='inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200/70 text-[10px] font-semibold text-amber-700'>
                        PK
                      </span>
                    ) : fk ? (
                      <span className='inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-[10px] font-medium text-primary'>
                        <ArrowRight size={9} />
                        {fk}
                      </span>
                    ) : (
                      <span className='text-muted-foreground/40'>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DataPanel({
  dataSourceId,
  table,
}: {
  dataSourceId: string;
  table: DataSourceTable;
}): ReactElement {
  const query = useRawTablePreview({
    dataSourceId,
    table: { model: table.tableName, schema: table.schemaName },
    enabled: true,
    limit: 50,
  });
  if (query.isLoading) {
    return (
      <Center>
        <Loader2 size={18} className='animate-spin' />
        Loading rows…
      </Center>
    );
  }
  if (query.isError) {
    return (
      <Center>
        <AlertCircle size={18} className='text-rose-500' />
        <span>Couldn&apos;t load rows.</span>
        <button
          type='button'
          onClick={() => void query.refetch()}
          data-track-category='DYNAMIC_DASHBOARD'
          data-track-name='Db_Browser_Data_Retry'
          className='mt-1 text-sm text-primary hover:underline'
        >
          Retry
        </button>
      </Center>
    );
  }
  if (!query.data || query.data.rows.length === 0) {
    return (
      <Center>
        <Inbox size={20} className='text-muted-foreground/60' />
        No rows.
      </Center>
    );
  }
  return (
    <div className='h-full overflow-hidden p-3'>
      <TableRenderer data={query.data} />
    </div>
  );
}

function RelGroup({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}): ReactElement {
  return (
    <div className='space-y-1.5'>
      <div className='flex items-center gap-1.5'>
        <span className='text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'>
          {title}
        </span>
        <span className='inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-muted text-[9px] font-semibold text-muted-foreground'>
          {count}
        </span>
      </div>
      <div className='space-y-1.5'>{children}</div>
    </div>
  );
}

function RelRow({ label, onClick }: { label: string; onClick: () => void }): ReactElement {
  return (
    <button
      type='button'
      onClick={onClick}
      data-track-category='DYNAMIC_DASHBOARD'
      data-track-name='Db_Browser_Jump_Relation'
      className='group w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card hover:bg-accent hover:border-primary/40 text-left text-[12px] text-foreground transition-colors'
    >
      <Link2 size={13} className='shrink-0 text-primary' />
      <span className='flex-1 truncate font-mono text-[11.5px]'>{label}</span>
      <ArrowRight
        size={13}
        className='shrink-0 text-muted-foreground opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all'
      />
    </button>
  );
}

function RelationsPanel({
  outgoing,
  incoming,
  tableIdByName,
  onSelectTable,
}: {
  outgoing: DataSourceRelationship[];
  incoming: DataSourceRelationship[];
  tableIdByName: Map<string, string>;
  onSelectTable: (id: string) => void;
}): ReactElement {
  if (outgoing.length === 0 && incoming.length === 0) {
    return (
      <Center>
        <Link2 size={20} className='text-muted-foreground/60' />
        No foreign keys.
      </Center>
    );
  }
  const jump = (schemaName: string, tableName: string): void => {
    const id = tableIdByName.get(`${schemaName}.${tableName}`);
    if (id) onSelectTable(id);
  };
  return (
    <div className='h-full overflow-auto p-4 space-y-5'>
      {outgoing.length > 0 && (
        <RelGroup title='References' count={outgoing.length}>
          {outgoing.map(r => (
            <RelRow
              key={r.id}
              label={`${r.fromColumn} → ${r.toTable}.${r.toColumn}`}
              onClick={() => jump(r.toSchema, r.toTable)}
            />
          ))}
        </RelGroup>
      )}
      {incoming.length > 0 && (
        <RelGroup title='Referenced by' count={incoming.length}>
          {incoming.map(r => (
            <RelRow
              key={r.id}
              label={`${r.fromTable}.${r.fromColumn} → ${r.toColumn}`}
              onClick={() => jump(r.fromSchema, r.fromTable)}
            />
          ))}
        </RelGroup>
      )}
    </div>
  );
}
