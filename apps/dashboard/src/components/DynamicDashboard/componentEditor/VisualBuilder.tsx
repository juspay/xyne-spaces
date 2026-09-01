import { QueryVisualizationType } from '@xyne/shared';
import { X } from 'lucide-react';
import type { Dispatch, ReactElement, SetStateAction } from 'react';
import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { DataSourceColumn } from '../../../services/DynamicDashboard/dataSourceSchemaService';
import Input from '../../ui/Input';
import { Field, IconBtn, Section } from './atoms';
import { ColumnMultiSelect, Select } from './formControls';
import {
  AGG_OP_LABEL,
  AGG_OPS,
  type AggregationOp,
  FILTER_OPS_BY_KIND,
  FILTER_OP_LABEL,
  type FilterOp,
  type FilterRow,
  type GroupByRow,
  type JoinRow,
  type MeasureRow,
  type OrderByRow,
  type ScopedColumn,
  TIME_BUCKETS,
  type TimeBucket,
} from './types';
import { isColumnCompatibleWithGroupBy, isColumnCompatibleWithOp, isUnaryOp } from './validation';

function patchById<T extends { id: string }>(
  setter: Dispatch<SetStateAction<T[]>>,
  id: string,
  transform: (row: T) => T,
): void {
  setter(prev => prev.map(row => (row.id === id ? transform(row) : row)));
}

function removeById<T extends { id: string }>(
  setter: Dispatch<SetStateAction<T[]>>,
  id: string,
): void {
  setter(prev => prev.filter(row => row.id !== id));
}

export interface VisualBuilderProps {
  visualType: QueryVisualizationType;
  title: string;
  setTitle: (t: string) => void;
  dataSourceId: string;
  setDataSourceId: (id: string) => void;
  dataSources: Array<{ id: string; name: string; ingestionStatus: string }>;
  tableName: string;
  setTableName: (n: string) => void;
  tables: Array<{ tableName: string; schemaName: string; columns: DataSourceColumn[] }>;
  schemaLoading: boolean;
  columns: DataSourceColumn[];
  inScopeColumns: ScopedColumn[];
  joins: JoinRow[];
  setJoins: Dispatch<SetStateAction<JoinRow[]>>;
  availableJoinEdges: Array<{
    key: string;
    target: string;
    onFromValue: string;
    onToValue: string;
    label: string;
  }>;
  groupBy: GroupByRow[];
  setGroupBy: Dispatch<SetStateAction<GroupByRow[]>>;
  measures: MeasureRow[];
  setMeasures: Dispatch<SetStateAction<MeasureRow[]>>;
  selectCols: string[];
  setSelectCols: Dispatch<SetStateAction<string[]>>;
  filters: FilterRow[];
  setFilters: Dispatch<SetStateAction<FilterRow[]>>;
  orderBy: OrderByRow[];
  setOrderBy: Dispatch<SetStateAction<OrderByRow[]>>;
  take: string;
  setTake: (t: string) => void;
  timeColumn: string;
  setTimeColumn: (c: string) => void;
  wantsGroupBy: boolean;
  wantsMeasures: boolean;
  wantsSelect: boolean;
  wantsTimeBucket: boolean;
}

export const VisualBuilder = ({
  visualType,
  title,
  setTitle,
  dataSourceId,
  setDataSourceId,
  dataSources,
  tableName,
  setTableName,
  tables,
  schemaLoading,
  columns,
  inScopeColumns,
  joins,
  setJoins,
  availableJoinEdges,
  groupBy,
  setGroupBy,
  measures,
  setMeasures,
  selectCols,
  setSelectCols,
  filters,
  setFilters,
  orderBy,
  setOrderBy,
  take,
  setTake,
  timeColumn,
  setTimeColumn,
  wantsGroupBy,
  wantsMeasures,
  wantsSelect,
  wantsTimeBucket,
}: VisualBuilderProps): ReactElement => {
  const removeJoin = useCallback(
    (joinId: string, joinModel: string, joinAlias?: string) => {
      const prefix = (joinAlias ?? joinModel) + '.';
      setJoins(prev => prev.filter(j => j.id !== joinId));
      setGroupBy(prev => prev.filter(g => !g.column.startsWith(prefix)));
      setFilters(prev => prev.filter(f => !f.column.startsWith(prefix)));
      setOrderBy(prev => prev.filter(o => !o.column.startsWith(prefix)));
      setSelectCols(prev => prev.filter(c => !c.startsWith(prefix)));
    },
    [setJoins, setGroupBy, setFilters, setOrderBy, setSelectCols],
  );

  return (
    <div className='p-4 space-y-4'>
      <div className='grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4'>
        <Field label='Title'>
          <Input
            value={title}
            onChange={e => setTitle(e.target.value)}
            data-track-category='COMPONENT_EDITOR'
            data-track-name='Title_Input'
            placeholder='e.g: Revenue by Status'
          />
        </Field>

        <Field label='Data source'>
          <Select
            trackName='Data_Source_Picker'
            value={dataSourceId}
            onChange={setDataSourceId}
            options={dataSources
              .filter(d => d.ingestionStatus === 'complete')
              .map(d => ({ value: d.id, label: d.name }))}
            placeholder='Choose your data source'
          />
        </Field>

        <Field label='Table'>
          {!dataSourceId ? (
            <Select
              trackName='Table_Picker'
              value=''
              onChange={() => undefined}
              options={[]}
              placeholder='Choose your data source'
              disabled
            />
          ) : schemaLoading ? (
            <div className='text-xs text-muted-foreground'>Loading tables…</div>
          ) : (
            <Select
              trackName='Table_Picker'
              value={tableName}
              onChange={setTableName}
              options={tables.map(t => ({
                value: t.tableName,
                label: `${t.schemaName}.${t.tableName}`,
              }))}
              placeholder='Select a table…'
            />
          )}
        </Field>
      </div>

      {tableName && (
        <>
          <Field
            label='Joins'
            description='Single table query. Add join to pull in related data.'
            labelTone='strong'
          >
            {joins.length === 0 && (
              <div className='rounded-lg border border-dashed border-xyne-gray-200 bg-xyne-gray-25 min-h-[160px] flex items-center justify-center text-center px-6'>
                <span className='text-[13px] leading-[18px] text-xyne-gray-400'>
                  No joins added yet
                </span>
              </div>
            )}
            {joins.map(j => {
              const needsColumnPickers = !j.on.from || !j.on.to;
              const fromColOptions: { value: string; label: string }[] = [];
              let toColOptions: { value: string; label: string }[] = [];
              if (needsColumnPickers) {
                const baseTbl = tables.find(t => t.tableName === tableName);
                if (baseTbl) {
                  for (const c of baseTbl.columns) {
                    fromColOptions.push({
                      value: `${baseTbl.tableName}.${c.columnName}`,
                      label: `${baseTbl.tableName}.${c.columnName}`,
                    });
                  }
                }
                for (const prior of joins) {
                  if (prior.id === j.id) break;
                  const tbl = tables.find(t => t.tableName === prior.model);
                  if (!tbl) continue;
                  const alias = prior.alias ?? tbl.tableName;
                  for (const c of tbl.columns) {
                    fromColOptions.push({
                      value: `${alias}.${c.columnName}`,
                      label: `${alias}.${c.columnName}`,
                    });
                  }
                }
                const toTbl = tables.find(t => t.tableName === j.model);
                const toAlias = j.alias ?? j.model;
                toColOptions = (toTbl?.columns ?? []).map(c => ({
                  value: `${toAlias}.${c.columnName}`,
                  label: `${toAlias}.${c.columnName}`,
                }));
              }
              return (
                <div
                  key={j.id}
                  className='flex items-center gap-1.5 text-xs bg-muted/40 border border-border rounded-md px-2 py-1.5'
                >
                  <Select
                    trackName='Join_Type'
                    value={j.type}
                    onChange={v =>
                      patchById(setJoins, j.id, x => ({ ...x, type: v as 'inner' | 'left' }))
                    }
                    options={[
                      { value: 'inner', label: 'inner' },
                      { value: 'left', label: 'left' },
                    ]}
                    className='w-20'
                  />
                  <span className='font-medium text-foreground truncate'>{j.model}</span>
                  {needsColumnPickers ? (
                    <>
                      <span className='text-muted-foreground text-[11px]'>on</span>
                      <Select
                        trackName='Join_From_Column'
                        value={j.on.from}
                        onChange={v =>
                          patchById(setJoins, j.id, x => ({ ...x, on: { ...x.on, from: v } }))
                        }
                        options={fromColOptions}
                        className='flex-1 min-w-[120px]'
                      />
                      <span className='text-muted-foreground text-[11px]'>=</span>
                      <Select
                        trackName='Join_To_Column'
                        value={j.on.to}
                        onChange={v =>
                          patchById(setJoins, j.id, x => ({ ...x, on: { ...x.on, to: v } }))
                        }
                        options={toColOptions}
                        className='flex-1 min-w-[120px]'
                      />
                    </>
                  ) : (
                    <span className='text-muted-foreground text-[11px] truncate'>
                      on {j.on.from} = {j.on.to}
                    </span>
                  )}
                  <IconBtn onClick={() => removeJoin(j.id, j.model, j.alias)}>
                    <X size={12} />
                  </IconBtn>
                </div>
              );
            })}
            {availableJoinEdges.length > 0 && (
              <div className='flex flex-col gap-1 mt-1'>
                <div className='text-[10px] uppercase tracking-wider text-muted-foreground'>
                  Available
                </div>
                {availableJoinEdges.map(edge => (
                  <button
                    key={edge.key}
                    type='button'
                    onClick={() =>
                      setJoins(prev => [
                        ...prev,
                        {
                          id: uuidv4(),
                          model: edge.target,
                          type: 'inner',
                          on: { from: edge.onFromValue, to: edge.onToValue },
                        },
                      ])
                    }
                    className='text-left text-xs px-2 py-1 rounded border border-border hover:bg-accent hover:border-foreground/30 text-foreground/80'
                    data-track-category='COMPONENT_EDITOR'
                    data-track-name='Add_Join'
                  >
                    <span className='font-medium'>+ Join {edge.target}</span>
                    <span className='ml-1.5 text-muted-foreground text-[10px]'>({edge.label})</span>
                  </button>
                ))}
              </div>
            )}
            {availableJoinEdges.length === 0 && joins.length > 0 && (
              <div className='text-[10px] text-muted-foreground italic'>
                No more related tables to join from here.
              </div>
            )}
          </Field>

          {wantsSelect && (
            <Section label='Columns'>
              <ColumnMultiSelect value={selectCols} onChange={setSelectCols} columns={columns} />
            </Section>
          )}

          {wantsGroupBy && (
            <Section
              label='Group by'
              add={() => {
                const defaultAlias =
                  visualType === QueryVisualizationType.LINE_CHART ||
                  visualType === QueryVisualizationType.AREA_CHART
                    ? 'x'
                    : visualType === QueryVisualizationType.SCATTER_CHART
                      ? 'series'
                      : 'label';
                setGroupBy(prev => [...prev, { id: uuidv4(), column: '', alias: defaultAlias }]);
              }}
              addDisabled={!wantsGroupBy}
            >
              {groupBy.length === 0 && (
                <div className='text-xs text-muted-foreground italic'>None — add a dimension</div>
              )}
              {groupBy.map(g => (
                <div key={g.id} className='flex items-center gap-1.5'>
                  <Select
                    trackName='GroupBy_Column'
                    value={g.column}
                    onChange={v =>
                      patchById(setGroupBy, g.id, x => {
                        const nextCol = inScopeColumns.find(c => c.value === v);
                        if (nextCol?.dataTypeCanonical === 'temporal') return { ...x, column: v };
                        const { bucket: _bucket, ...rest } = x;
                        return { ...rest, column: v };
                      })
                    }
                    options={inScopeColumns
                      .filter(c => {
                        if (wantsTimeBucket && groupBy.find(x => x.id === g.id)?.bucket) {
                          return c.dataTypeCanonical === 'temporal';
                        }
                        return isColumnCompatibleWithGroupBy(c.dataTypeCanonical, visualType);
                      })
                      .map(c => ({
                        value: c.value,
                        label: `${c.value} · ${c.dataTypeCanonical}`,
                      }))}
                    placeholder='Column…'
                    className='flex-1'
                  />
                  {wantsTimeBucket &&
                    (inScopeColumns.find(c => c.value === g.column)?.dataTypeCanonical ===
                      'temporal' ||
                      !!g.bucket) && (
                      <Select
                        trackName='GroupBy_Bucket'
                        value={g.bucket ?? ''}
                        onChange={v =>
                          patchById(setGroupBy, g.id, x => ({ ...x, bucket: v as TimeBucket }))
                        }
                        options={TIME_BUCKETS.map(b => ({ value: b, label: b }))}
                        placeholder='bucket'
                        className='w-24'
                      />
                    )}
                  <IconBtn onClick={() => removeById(setGroupBy, g.id)}>
                    <X size={12} />
                  </IconBtn>
                </div>
              ))}
            </Section>
          )}

          {wantsMeasures && (
            <Section
              label='Measures'
              add={() =>
                setMeasures(prev => [
                  ...prev,
                  {
                    id: uuidv4(),
                    column: columns[0]?.columnName ?? '*',
                    op: 'sum',
                    alias: prev.length === 0 ? 'value' : `value_${prev.length}`,
                  },
                ])
              }
            >
              {measures.length === 0 && (
                <div className='text-xs text-muted-foreground italic'>None — add a metric</div>
              )}
              {measures.map(m => (
                <div key={m.id} className='flex items-center gap-1.5'>
                  <Select
                    trackName='Measure_Op'
                    value={m.op}
                    onChange={v => {
                      const nextOp = v as AggregationOp;
                      patchById(setMeasures, m.id, x => {
                        const shouldDropStar = nextOp !== 'count' && x.column === '*';
                        const shouldRestoreStar = nextOp === 'count' && !x.column.trim();
                        const colMeta = inScopeColumns.find(c => c.value === x.column);
                        const shouldClearIncompat =
                          !!x.column &&
                          x.column !== '*' &&
                          colMeta !== undefined &&
                          !isColumnCompatibleWithOp(colMeta.dataTypeCanonical, nextOp);
                        return {
                          ...x,
                          op: nextOp,
                          ...(shouldDropStar ? { column: '' } : {}),
                          ...(shouldRestoreStar ? { column: '*' } : {}),
                          ...(shouldClearIncompat ? { column: '' } : {}),
                        };
                      });
                    }}
                    options={AGG_OPS.map(op => ({ value: op, label: AGG_OP_LABEL[op] }))}
                    className='w-32'
                  />
                  <Select
                    trackName='Measure_Column'
                    value={m.column}
                    onChange={v => patchById(setMeasures, m.id, x => ({ ...x, column: v }))}
                    options={[
                      ...(m.op === 'count' ? [{ value: '*', label: '* (any row)' }] : []),
                      ...inScopeColumns
                        .filter(c => isColumnCompatibleWithOp(c.dataTypeCanonical, m.op))
                        .map(c => ({ value: c.value, label: c.value })),
                    ]}
                    placeholder={
                      m.op === 'count'
                        ? 'Column…'
                        : m.op === 'sum' || m.op === 'avg'
                          ? 'Pick a numeric column…'
                          : m.op === 'min' || m.op === 'max'
                            ? 'Pick a numeric or date column…'
                            : 'Pick a column…'
                    }
                    className='flex-1'
                  />
                  <IconBtn onClick={() => removeById(setMeasures, m.id)}>
                    <X size={12} />
                  </IconBtn>
                </div>
              ))}
            </Section>
          )}

          <Section
            label='Filters'
            add={() =>
              setFilters(prev => [
                ...prev,
                {
                  id: uuidv4(),
                  column: columns[0]?.columnName ?? '',
                  op: 'equals',
                  value: '',
                },
              ])
            }
          >
            {filters.length === 0 && (
              <div className='text-xs text-muted-foreground italic'>
                None — add a filter to scope the data
              </div>
            )}
            {filters.map(f => {
              const col = inScopeColumns.find(c => c.value === f.column);
              const kind = col?.dataTypeCanonical ?? 'unknown';
              const allowedOps = FILTER_OPS_BY_KIND[kind];
              return (
                <div key={f.id} className='flex items-center gap-1.5'>
                  <Select
                    trackName='Filter_Column'
                    value={f.column}
                    onChange={v =>
                      patchById(setFilters, f.id, x => {
                        const nextCol = inScopeColumns.find(c => c.value === v);
                        const nextKind = nextCol?.dataTypeCanonical ?? 'unknown';
                        const nextAllowed = FILTER_OPS_BY_KIND[nextKind];
                        const nextOp = nextAllowed.includes(x.op)
                          ? x.op
                          : (nextAllowed[0] ?? 'equals');
                        return { ...x, column: v, op: nextOp };
                      })
                    }
                    options={inScopeColumns.map(c => ({
                      value: c.value,
                      label: `${c.value} · ${c.dataTypeCanonical}`,
                    }))}
                    placeholder='Column…'
                    className='flex-1 min-w-0'
                  />
                  <Select
                    trackName='Filter_Op'
                    value={f.op}
                    onChange={v => patchById(setFilters, f.id, x => ({ ...x, op: v as FilterOp }))}
                    options={allowedOps.map(op => ({ value: op, label: FILTER_OP_LABEL[op] }))}
                    className='w-28'
                  />
                  {!isUnaryOp(f.op) && (
                    <Input
                      value={f.value}
                      onChange={e =>
                        patchById(setFilters, f.id, x => ({ ...x, value: e.target.value }))
                      }
                      data-track-category='COMPONENT_EDITOR'
                      data-track-name='Filter_Value_Input'
                      placeholder={f.op === 'in' || f.op === 'notIn' ? 'a, b, c' : 'value'}
                      className='w-28 text-xs'
                    />
                  )}
                  <IconBtn onClick={() => removeById(setFilters, f.id)}>
                    <X size={12} />
                  </IconBtn>
                </div>
              );
            })}
          </Section>

          <Section
            label='Order by'
            addDisabled={((): boolean => {
              if (visualType === QueryVisualizationType.DATA_TABLE) {
                return selectCols.length === 0 && inScopeColumns.length === 0;
              }
              const hasMeasureAlias = measures.some(m => m.alias);
              const hasGroupByAlias = groupBy.some(g => g.alias);
              return !hasMeasureAlias && !hasGroupByAlias;
            })()}
            add={() => {
              let defaultCol = '';
              if (visualType === QueryVisualizationType.DATA_TABLE) {
                defaultCol = selectCols[0] ?? inScopeColumns[0]?.value ?? '';
              } else {
                defaultCol =
                  measures.find(m => m.alias)?.alias ?? groupBy.find(g => g.alias)?.alias ?? '';
              }
              if (!defaultCol) return;
              setOrderBy(prev => [...prev, { id: uuidv4(), column: defaultCol, dir: 'desc' }]);
            }}
          >
            {orderBy.length === 0 && (
              <div className='text-xs text-muted-foreground italic'>Default — natural order</div>
            )}
            {orderBy.map(o => {
              const aliasOptions = [
                ...measures.filter(m => m.alias).map(m => m.alias as string),
                ...groupBy.filter(g => g.alias).map(g => g.alias as string),
              ];
              const columnOptions =
                visualType === QueryVisualizationType.DATA_TABLE
                  ? Array.from(
                      new Set(
                        selectCols.length > 0 ? selectCols : inScopeColumns.map(c => c.value),
                      ),
                    )
                  : Array.from(new Set(aliasOptions));
              return (
                <div key={o.id} className='flex items-center gap-1.5'>
                  <Select
                    trackName='OrderBy_Column'
                    value={o.column}
                    onChange={v => patchById(setOrderBy, o.id, x => ({ ...x, column: v }))}
                    options={columnOptions.map(c => ({ value: c, label: c }))}
                    placeholder={
                      columnOptions.length === 0 ? 'Add a measure or group-by first…' : 'Column…'
                    }
                    className='flex-1'
                  />
                  <Select
                    trackName='OrderBy_Direction'
                    value={o.dir}
                    onChange={v =>
                      patchById(setOrderBy, o.id, x => ({ ...x, dir: v as 'asc' | 'desc' }))
                    }
                    options={[
                      { value: 'asc', label: 'asc' },
                      { value: 'desc', label: 'desc' },
                    ]}
                    className='w-20'
                  />
                  <IconBtn onClick={() => removeById(setOrderBy, o.id)}>
                    <X size={12} />
                  </IconBtn>
                </div>
              );
            })}
          </Section>

          <Section label='Limit (take)'>
            <Input
              type='number'
              value={take}
              onChange={e => {
                const raw = e.target.value;
                if (raw === '') {
                  setTake('');
                  return;
                }
                const n = Number(raw);
                if (!Number.isFinite(n)) return;
                setTake(String(Math.min(10000, Math.max(1, Math.floor(n)))));
              }}
              data-track-category='COMPONENT_EDITOR'
              data-track-name='Take_Limit_Input'
              placeholder='no limit'
              min={1}
              max={10000}
              className='w-32 text-sm'
            />
          </Section>

          <Section label='Time column'>
            {((): ReactElement => {
              const temporalCols = inScopeColumns.filter(c => c.dataTypeCanonical === 'temporal');
              if (temporalCols.length === 0) {
                return (
                  <div className='text-xs text-muted-foreground italic'>
                    No temporal columns in the base or joined tables.
                  </div>
                );
              }
              return (
                <>
                  <Select
                    trackName='Time_Column'
                    value={timeColumn}
                    onChange={setTimeColumn}
                    options={[
                      { value: '', label: '(none — ignore dashboard time range)' },
                      ...temporalCols.map(c => ({ value: c.value, label: c.value })),
                    ]}
                    placeholder='(none)'
                  />
                  <p className='text-[10px] text-muted-foreground'>
                    When set, the dashboard&apos;s time-range picker filters this tile on this
                    column.
                  </p>
                </>
              );
            })()}
          </Section>
        </>
      )}
    </div>
  );
};
