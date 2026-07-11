import { ReactElement, useMemo, useState } from 'react';
import { AlertCircle, Code2, Database, Inbox, KeyRound, Loader2, Table2, X } from 'lucide-react';
import type { TableData } from '@xyne/shared';
import { Dialog } from '../../../ui/Dialog';
import { SegmentedToggle } from '../../../ui/SegmentedToggle';
import type { DataSourceColumn } from '../../../../services/DynamicDashboard/dataSourceSchemaService';
import type { ComponentDataError } from '../../../../services/DynamicDashboard/componentDataService';
import { TYPE_META } from '../../DatabaseVisualizer/typeMeta';
import TableRenderer from '../renderers/TableRenderer';
import SqlBlock from './SqlBlock';
import JsonBlock from './JsonBlock';
import { formatFetchError, untitledFor } from '../utils';
import type { ComponentTileData } from '../ComponentTile';
import {
  getDataSourceId,
  getInvolvedTables,
  getUsedColumns,
  RAW_ROW_LIMIT,
  useCompiledSql,
  useComponentResultPreview,
  useRawTablePreview,
  useTableColumnsMeta,
  type ColumnRole,
  type InvolvedTable,
} from '../../../../hooks/useComponentPreview';

export interface ComponentPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  component: ComponentTileData;
}

type Tab = 'source' | 'result' | 'query';

const ROLE_LABEL: Record<ColumnRole, string> = {
  dimension: 'group',
  measure: 'metric',
  filter: 'filter',
  sort: 'sort',
  join: 'join',
};

const ComponentPreviewDialog = ({
  open,
  onOpenChange,
  component,
}: ComponentPreviewDialogProps): ReactElement => {
  const dataSourceId = getDataSourceId(component.storedPlan);
  const tables = useMemo(() => getInvolvedTables(component.storedPlan), [component.storedPlan]);
  const usedColumns = useMemo(() => getUsedColumns(component.storedPlan), [component.storedPlan]);

  const [tab, setTab] = useState<Tab>('source');
  const [selectedModel, setSelectedModel] = useState<string>(tables[0]?.model ?? '');
  const selectedTable: InvolvedTable | null =
    tables.find(t => t.model === selectedModel) ?? tables[0] ?? null;

  const rawQuery = useRawTablePreview({
    dataSourceId,
    table: selectedTable,
    enabled: open && tab === 'source',
  });
  const { columns: columnsMeta } = useTableColumnsMeta({
    dataSourceId,
    table: selectedTable,
    enabled: open && tab === 'source',
  });
  const resultQuery = useComponentResultPreview({
    component,
    enabled: open && tab === 'result',
  });
  const sqlQuery = useCompiledSql({
    plan: component.storedPlan ?? null,
    enabled: open && tab === 'query',
  });

  const rowCount = rawQuery.data?.rows.length ?? 0;
  const dataQuery = tab === 'result' ? resultQuery : rawQuery;
  const dataTable: TableData | null = dataQuery.data ?? null;

  const schemaColumns: DataSourceColumn[] = useMemo(() => {
    if (columnsMeta.length > 0) return columnsMeta;
    return (rawQuery.data?.columns ?? []).map((c, i) => ({
      id: `derived-${i}-${c.key}`,
      columnName: c.key,
      dataTypeNative: '',
      dataTypeCanonical: 'unknown',
      isNullable: true,
      isPrimaryKey: false,
      cardinality: null,
    }));
  }, [columnsMeta, rawQuery.data]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Preview — ${component.title || untitledFor(component.visualType)}`}
      className='w-[92vw] max-w-5xl overflow-hidden border border-xyne-gray-200'
    >
      <div className='flex flex-col h-[76vh] min-h-0'>
        <div className='flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-xyne-gray-100'>
          <div className='flex items-center gap-3 min-w-0'>
            <div className='shrink-0 grid place-items-center w-10 h-10 rounded-xl bg-xyne-green-50 border border-xyne-green-100 text-xyne-green-600'>
              <Table2 size={18} />
            </div>
            <div className='min-w-0'>
              <h2 className='text-[15px] font-semibold text-xyne-gray-900 truncate'>
                {component.title || untitledFor(component.visualType)}
              </h2>
              <p className='text-[12px] text-xyne-gray-400'>
                {tab === 'source'
                  ? `Source data · first ${RAW_ROW_LIMIT} rows`
                  : tab === 'result'
                    ? 'Component result'
                    : 'Stored plan & compiled SQL'}
              </p>
            </div>
          </div>
          <button
            type='button'
            onClick={() => onOpenChange(false)}
            aria-label='Close preview'
            className='shrink-0 grid place-items-center w-8 h-8 rounded-lg text-xyne-gray-400 hover:text-xyne-gray-700 hover:bg-xyne-gray-100 transition-colors'
            data-track-category='DYNAMIC_DASHBOARD'
            data-track-name='Close_Component_Preview'
          >
            <X size={16} />
          </button>
        </div>

        <div className='px-6 pt-4'>
          <SegmentedToggle<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: 'source', label: 'Source Tables' },
              { value: 'result', label: 'Component Result' },
              { value: 'query', label: 'Query' },
            ]}
          />
        </div>

        <div className='flex-1 min-h-0 flex flex-col gap-4 px-6 py-4'>
          {tab === 'source' && tables.length > 0 && (
            <div className='flex flex-col gap-3'>
              {tables.length > 1 && (
                <div className='flex flex-wrap items-center gap-1.5'>
                  {tables.map(t => {
                    const active = t.model === selectedTable?.model;
                    return (
                      <button
                        key={t.model}
                        type='button'
                        onClick={() => setSelectedModel(t.model)}
                        className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border text-[12px] font-medium transition-colors ${
                          active
                            ? 'border-xyne-green-300 bg-xyne-green-50 text-xyne-green-700'
                            : 'border-xyne-gray-200 bg-white text-xyne-gray-500 hover:bg-xyne-gray-50'
                        }`}
                        data-track-category='DYNAMIC_DASHBOARD'
                        data-track-name='Preview_Select_Table'
                      >
                        <Database size={12} />
                        {t.model}
                      </button>
                    );
                  })}
                </div>
              )}

              <SchemaPanel
                tableName={selectedTable?.model ?? ''}
                columns={schemaColumns}
                rowCount={rowCount}
                hasTypes={columnsMeta.length > 0}
                usedColumns={usedColumns}
              />
            </div>
          )}

          {tab === 'query' ? (
            <QuerySurface
              plan={component.storedPlan}
              isLoading={sqlQuery.isLoading}
              isError={sqlQuery.isError}
              error={sqlQuery.error}
              sql={sqlQuery.data?.sql ?? null}
              params={sqlQuery.data?.params ?? []}
            />
          ) : (
            <div className='flex-1 min-h-0 rounded-xl border border-xyne-gray-200 bg-white shadow-sm overflow-hidden'>
              {!dataSourceId ? (
                <EmptyState
                  icon={Database}
                  title='No data source'
                  text='This component has no underlying data source to preview.'
                />
              ) : dataQuery.isLoading ? (
                <LoadingState />
              ) : dataQuery.isError ? (
                <EmptyState
                  icon={AlertCircle}
                  tone='error'
                  title='Could not load preview'
                  text={formatFetchError(dataQuery.error)}
                />
              ) : dataTable && dataTable.rows.length > 0 ? (
                <TableRenderer data={dataTable} />
              ) : (
                <EmptyState icon={Inbox} title='No rows' text='This query returned no rows.' />
              )}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
};

interface SchemaPanelProps {
  tableName: string;
  columns: DataSourceColumn[];
  rowCount: number;
  hasTypes: boolean;
  usedColumns: Map<string, ColumnRole[]>;
}

const SchemaPanel = ({
  tableName,
  columns,
  rowCount,
  hasTypes,
  usedColumns,
}: SchemaPanelProps): ReactElement => {
  const decorated = useMemo(
    () =>
      columns.map(col => {
        const roles = usedColumns.get(col.columnName.toLowerCase()) ?? [];
        return {
          col,
          meta: TYPE_META[col.dataTypeCanonical] ?? TYPE_META.unknown,
          roles,
          isUsed: roles.length > 0,
        };
      }),
    [columns, usedColumns],
  );
  const usedCount = decorated.filter(d => d.isUsed).length;
  return (
    <div className='rounded-xl border border-xyne-gray-200 bg-xyne-gray-50/60 px-3.5 py-3'>
      <div className='flex items-center justify-between gap-3 mb-2.5'>
        <div className='flex items-center gap-2 min-w-0'>
          <Database size={13} className='shrink-0 text-xyne-gray-400' />
          <span className='font-mono text-[13px] font-semibold text-xyne-gray-900 truncate'>
            {tableName}
          </span>
        </div>
        <div className='shrink-0 flex items-center gap-1.5 text-[11px] font-medium text-xyne-gray-400'>
          {usedCount > 0 && (
            <>
              <span className='inline-flex items-center gap-1 text-xyne-green-600'>
                <span className='w-1.5 h-1.5 rounded-full bg-xyne-green-500' />
                {usedCount} used
              </span>
              <span className='text-xyne-gray-300'>·</span>
            </>
          )}
          <span>
            {columns.length} {columns.length === 1 ? 'column' : 'columns'}
          </span>
          <span className='text-xyne-gray-300'>·</span>
          <span>
            {rowCount} {rowCount === 1 ? 'row' : 'rows'}
          </span>
        </div>
      </div>
      <div className='flex flex-wrap gap-1.5'>
        {decorated.map(({ col, meta, roles, isUsed }) => {
          const Icon = meta.Icon;
          return (
            <span
              key={col.id}
              title={`${col.columnName}${col.dataTypeNative ? ` · ${col.dataTypeNative}` : ''}${col.isNullable ? '' : ' · not null'}${isUsed ? ` · used as ${roles.map(r => ROLE_LABEL[r]).join(', ')}` : ''}`}
              className={`group inline-flex items-center gap-1.5 rounded-lg border pl-2 pr-2 py-1 transition-colors ${
                isUsed
                  ? 'border-xyne-green-300 bg-xyne-green-50 ring-1 ring-xyne-green-200/60'
                  : 'border-xyne-gray-200 bg-white opacity-70 hover:opacity-100 hover:border-xyne-green-300'
              }`}
            >
              <Icon size={12} className={isUsed ? 'text-xyne-green-600' : meta.className} />
              <span
                className={`font-mono text-[12px] ${isUsed ? 'font-medium text-xyne-gray-900' : 'text-xyne-gray-700'}`}
              >
                {col.columnName}
              </span>
              {col.isPrimaryKey && (
                <KeyRound size={11} className='text-amber-500' aria-label='primary key' />
              )}
              {isUsed ? (
                <span className='inline-flex items-center rounded bg-xyne-green-100 px-1 text-[9px] font-semibold uppercase tracking-wide text-xyne-green-700'>
                  {roles.map(r => ROLE_LABEL[r]).join(' · ')}
                </span>
              ) : (
                hasTypes &&
                col.dataTypeNative && (
                  <span className='text-[10px] uppercase tracking-wide text-xyne-gray-400'>
                    {col.dataTypeNative}
                  </span>
                )
              )}
            </span>
          );
        })}
      </div>
      {usedCount > 0 && (
        <p className='mt-2.5 flex items-center gap-1.5 text-[11px] text-xyne-gray-400'>
          <span className='w-1.5 h-1.5 rounded-full bg-xyne-green-500' />
          Highlighted columns power this component — the rest are available in the table but unused.
        </p>
      )}
    </div>
  );
};

const LoadingState = (): ReactElement => (
  <div className='flex flex-col items-center justify-center h-full gap-3 text-xyne-gray-400'>
    <Loader2 size={22} className='animate-spin text-xyne-green-500' />
    <span className='text-sm'>Loading rows…</span>
  </div>
);

interface QuerySurfaceProps {
  plan?: Record<string, unknown> | undefined;
  isLoading: boolean;
  isError: boolean;
  error: ComponentDataError | null;
  sql: string | null;
  params: unknown[];
}

const panelClass =
  'flex-1 min-h-0 rounded-xl border border-xyne-gray-200 bg-white shadow-sm overflow-hidden';

const QuerySurface = ({
  plan,
  isLoading,
  isError,
  error,
  sql,
  params,
}: QuerySurfaceProps): ReactElement => (
  <div className='flex-1 min-h-0 flex flex-col gap-3'>
    <div className={panelClass}>
      <JsonBlock title='Stored query plan' subtitle='saved in the database' value={plan ?? {}} />
    </div>
    <div className={panelClass}>
      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <EmptyState
          icon={AlertCircle}
          tone='error'
          title='Could not compile query'
          text={error ? formatFetchError(error) : 'Failed to compile the query.'}
        />
      ) : sql ? (
        <SqlBlock sql={sql} params={params} subtitle='generated on the fly' />
      ) : (
        <EmptyState
          icon={Code2}
          title='No SQL query'
          text='This component is computed and runs no SQL against the data source.'
        />
      )}
    </div>
  </div>
);

interface EmptyStateProps {
  icon: typeof Database;
  title: string;
  text: string;
  tone?: 'muted' | 'error';
}

const EmptyState = ({ icon, title, text, tone = 'muted' }: EmptyStateProps): ReactElement => {
  const Icon = icon;
  return (
    <div className='flex flex-col items-center justify-center h-full gap-3 px-8 text-center'>
      <div
        className={`grid place-items-center w-12 h-12 rounded-2xl ${
          tone === 'error' ? 'bg-rose-50 text-rose-500' : 'bg-xyne-gray-100 text-xyne-gray-400'
        }`}
      >
        <Icon size={22} />
      </div>
      <div>
        <p className='text-sm font-semibold text-xyne-gray-700'>{title}</p>
        <p className='mt-1 text-[13px] text-xyne-gray-400 max-w-sm'>{text}</p>
      </div>
    </div>
  );
};

export default ComponentPreviewDialog;
