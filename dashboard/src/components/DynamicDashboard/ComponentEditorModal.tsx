import { useQuery } from '@tanstack/react-query';
import { QueryVisualizationType, type DashboardToolCall } from '@xyne/shared';
import { AlertTriangle, Database, Loader2 } from 'lucide-react';
import { ReactElement, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { useAuth } from '../../hooks/useAuth';
import { useZero } from '../../hooks/useZero';
import { ComponentDataError } from '../../services/DynamicDashboard/componentDataService';
import { fetchDataSourceSchema } from '../../services/DynamicDashboard/dataSourceSchemaService';
import { listDataSources } from '../../services/DynamicDashboard/dataSourcesService';
import { previewQueryPlan } from '../../services/DynamicDashboard/previewService';
import { mutators } from '../../zero/mutators';
import { ComponentTile, type ComponentTileData, getRendererForType } from './ComponentGrid';
import {
  ALL_TYPES,
  type FilterRow,
  type GroupByRow,
  type JoinRow,
  type MeasureRow,
  type OrderByRow,
  type ScopedColumn,
} from './componentEditor/types';
import { isColumnCompatibleWithOp, isUnaryOp } from './componentEditor/validation';
import {
  defaultSizeFor,
  filterRowToColumnFilter,
  flattenWhereToFilters,
  nextOpenPosition,
} from './componentEditor/queryPlanUtils';
import { ChartTypeSelect } from './componentEditor/ChartTypeSelect';
import { VisualBuilder } from './componentEditor/VisualBuilder';
import { AiSidePanel } from './componentEditor/AiSidePanel';
import { ComponentEditorHeader } from './componentEditor/ComponentEditorHeader';
import { ResetDraftsConfirmOverlay } from './componentEditor/ResetDraftsConfirmOverlay';
import {
  componentDraftReducer,
  initialComponentDraft,
  type ListUpdater,
} from './componentEditor/componentDraftReducer';
import { initialPreviewStatus, previewStatusReducer } from './componentEditor/previewStatusReducer';
import { initialTypeSnapshots, typeSnapshotsReducer } from './componentEditor/typeSnapshotsReducer';
import { applyVisualTypeReshape } from './componentEditor/visualTypeReshape';

const EMPTY_POSITIONS: ReadonlyArray<string> = [];

export interface ComponentEditorModalProps {
  dashboardId: string;
  dashboardName?: string;
  defaultDataSourceId?: string | undefined;
  existingPositions?: ReadonlyArray<string>;
  editingComponent?: {
    id: string;
    visualType: QueryVisualizationType;
    title?: string | null;
    queryJson: Record<string, unknown>;
    config?: string;
  } | null;
  onClose: () => void;
  onSaved?: (componentId: string) => void;
}

export const ComponentEditorModal = ({
  dashboardId,
  dashboardName,
  defaultDataSourceId,
  existingPositions = EMPTY_POSITIONS,
  editingComponent,
  onClose,
  onSaved,
}: ComponentEditorModalProps): ReactElement => {
  const z = useZero();
  const { user } = useAuth();
  const previewSeqRef = useRef(0);
  const isEditing = !!editingComponent;

  const initialFromRow = useMemo(() => {
    if (!editingComponent) return null;
    try {
      const plan = editingComponent.queryJson ?? {};
      const cfg = editingComponent.config
        ? (JSON.parse(editingComponent.config) as Record<string, unknown>)
        : {};
      return { plan, cfg, type: editingComponent.visualType, title: editingComponent.title ?? '' };
    } catch {
      return null;
    }
  }, [editingComponent]);

  const [draft, dispatch] = useReducer(
    componentDraftReducer,
    { initialFromRow, defaultDataSourceId },
    initialComponentDraft,
  );
  const {
    visualType,
    title,
    dataSourceId,
    tableName,
    timeColumn,
    groupBy,
    measures,
    filters,
    orderBy,
    take,
    joins,
    selectCols,
  } = draft;

  const setVisualType = useCallback(
    (value: QueryVisualizationType) => dispatch({ type: 'setVisualType', value }),
    [],
  );
  const setTitle = useCallback((value: string) => dispatch({ type: 'setTitle', value }), []);
  const setDataSourceId = useCallback(
    (value: string) => dispatch({ type: 'setDataSourceId', value }),
    [],
  );
  const setTableName = useCallback(
    (value: string) => dispatch({ type: 'setTableName', value }),
    [],
  );
  const setTimeColumn = useCallback(
    (value: string) => dispatch({ type: 'setTimeColumn', value }),
    [],
  );
  const setTake = useCallback((value: string) => dispatch({ type: 'setTake', value }), []);
  const setGroupBy = useCallback(
    (updater: ListUpdater<GroupByRow>) => dispatch({ type: 'setGroupBy', updater }),
    [],
  );
  const setMeasures = useCallback(
    (updater: ListUpdater<MeasureRow>) => dispatch({ type: 'setMeasures', updater }),
    [],
  );
  const setFilters = useCallback(
    (updater: ListUpdater<FilterRow>) => dispatch({ type: 'setFilters', updater }),
    [],
  );
  const setOrderBy = useCallback(
    (updater: ListUpdater<OrderByRow>) => dispatch({ type: 'setOrderBy', updater }),
    [],
  );
  const setJoins = useCallback(
    (updater: ListUpdater<JoinRow>) => dispatch({ type: 'setJoins', updater }),
    [],
  );
  const setSelectCols = useCallback(
    (updater: ListUpdater<string>) => dispatch({ type: 'setSelectCols', updater }),
    [],
  );

  const [previewStatus, previewDispatch] = useReducer(previewStatusReducer, initialPreviewStatus);
  const { result: previewResult, error: previewError, isPreviewing, isSaving } = previewStatus;

  const dataSourcesQuery = useQuery({
    queryKey: ['dataSources', 'list'],
    queryFn: listDataSources,
  });
  useEffect(() => {
    if (dataSourceId) return;
    const firstComplete = dataSourcesQuery.data?.find(d => d.ingestionStatus === 'complete');
    if (firstComplete) setDataSourceId(firstComplete.id);
  }, [dataSourcesQuery.data, dataSourceId, setDataSourceId]);

  const schemaQuery = useQuery({
    queryKey: ['dataSourceSchema', dataSourceId],
    queryFn: () => fetchDataSourceSchema(dataSourceId),
    enabled: !!dataSourceId,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!schemaQuery.data || tableName) return;
    const first = schemaQuery.data.tables[0];
    if (first) setTableName(first.tableName);
  }, [schemaQuery.data, tableName, setTableName]);

  const selectedTable = useMemo(
    () => schemaQuery.data?.tables.find(t => t.tableName === tableName),
    [schemaQuery.data, tableName],
  );
  const columns = selectedTable?.columns ?? [];
  const relationships = useMemo(() => schemaQuery.data?.relationships ?? [], [schemaQuery.data]);

  const inScopeColumns = useMemo<ScopedColumn[]>(() => {
    if (!selectedTable) return [];
    const out: ScopedColumn[] = selectedTable.columns.map(c => ({
      table: selectedTable.tableName,
      isBase: true,
      columnName: c.columnName,
      dataTypeCanonical: c.dataTypeCanonical,
      value: c.columnName,
    }));
    for (const j of joins) {
      if (!j.model) continue;
      const tbl = schemaQuery.data?.tables.find(t => t.tableName === j.model);
      if (!tbl) continue;
      const alias = j.alias ?? tbl.tableName;
      for (const c of tbl.columns) {
        out.push({
          table: alias,
          isBase: false,
          columnName: c.columnName,
          dataTypeCanonical: c.dataTypeCanonical,
          value: `${alias}.${c.columnName}`,
        });
      }
    }
    return out;
  }, [selectedTable, joins, schemaQuery.data]);

  const columnByName = useMemo(
    () => Object.fromEntries(inScopeColumns.map(c => [c.value, c])),
    [inScopeColumns],
  );

  const inScopeTableNames = useMemo(() => {
    const s = new Set<string>();
    if (tableName) s.add(tableName);
    for (const j of joins) if (j.model) s.add(j.model);
    return s;
  }, [tableName, joins]);

  const availableJoinEdges = useMemo(() => {
    if (!tableName) return [];
    type Edge = {
      key: string;
      target: string;
      onFromValue: string;
      onToValue: string;
      label: string;
    };
    const out: Edge[] = [];
    const seen = new Set<string>();
    for (const r of relationships) {
      const fromInScope = inScopeTableNames.has(r.fromTable);
      const toInScope = inScopeTableNames.has(r.toTable);
      if (fromInScope === toInScope) continue;
      const target = fromInScope ? r.toTable : r.fromTable;
      const left = fromInScope ? r.fromTable : r.toTable;
      const leftCol = fromInScope ? r.fromColumn : r.toColumn;
      const rightCol = fromInScope ? r.toColumn : r.fromColumn;
      const key = `${left}.${leftCol}->${target}.${rightCol}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key,
        target,
        onFromValue: `${left}.${leftCol}`,
        onToValue: `${target}.${rightCol}`,
        label: `${left}.${leftCol} = ${target}.${rightCol}`,
      });
    }

    if (schemaQuery.data?.sourceType === 'clickhouse') {
      for (const t of schemaQuery.data.tables) {
        if (inScopeTableNames.has(t.tableName)) continue;
        out.push({
          key: `ch:${t.tableName}`,
          target: t.tableName,
          onFromValue: '',
          onToValue: '',
          label: '',
        });
      }
    }

    return out;
  }, [tableName, relationships, inScopeTableNames, schemaQuery.data]);

  const wantsGroupBy =
    visualType === QueryVisualizationType.BAR_CHART ||
    visualType === QueryVisualizationType.PIE_CHART ||
    visualType === QueryVisualizationType.LINE_CHART ||
    visualType === QueryVisualizationType.AREA_CHART ||
    visualType === QueryVisualizationType.SCATTER_CHART;
  const wantsMeasures = visualType !== QueryVisualizationType.DATA_TABLE;
  const wantsSelect = visualType === QueryVisualizationType.DATA_TABLE;
  const wantsTimeBucket =
    visualType === QueryVisualizationType.LINE_CHART ||
    visualType === QueryVisualizationType.AREA_CHART;

  useEffect(() => {
    previewDispatch({ type: 'reset' });
  }, [visualType]);

  const [typeSnapshots, typeSnapshotsDispatch] = useReducer(
    typeSnapshotsReducer,
    visualType,
    initialTypeSnapshots,
  );
  const { visited: visitedTypes } = typeSnapshots;

  const resetSchemaScopedState = useCallback((): void => {
    setJoins([]);
    setFilters([]);
    setMeasures([]);
    setGroupBy([]);
    setOrderBy([]);
    setSelectCols([]);
    setTimeColumn('');
    typeSnapshotsDispatch({ type: 'reset', visualType });
    previewDispatch({ type: 'reset' });
  }, [
    visualType,
    setJoins,
    setFilters,
    setMeasures,
    setGroupBy,
    setOrderBy,
    setSelectCols,
    setTimeColumn,
  ]);

  const draftedTypeLabels = useMemo(() => {
    const labelFor = (t: QueryVisualizationType): string =>
      ALL_TYPES.find(at => at.value === t)?.label ?? t;
    const out: string[] = [];
    const currentHasContent = measures.length > 0 || groupBy.length > 0 || selectCols.length > 0;
    for (const t of visitedTypes) {
      if (t === visualType) {
        if (currentHasContent) out.push(labelFor(t));
      } else {
        out.push(labelFor(t));
      }
    }
    return out;
  }, [visitedTypes, visualType, measures, groupBy, selectCols]);

  const [pendingFieldChange, setPendingFieldChange] = useState<{
    fieldName: string;
    apply: () => void;
  } | null>(null);

  const requestSharedFieldChange = useCallback(
    (fieldName: string, apply: () => void): void => {
      if (draftedTypeLabels.length === 0) {
        apply();
        return;
      }
      setPendingFieldChange({ fieldName, apply });
    },
    [draftedTypeLabels],
  );

  const switchType = useCallback(
    (next: QueryVisualizationType) => {
      if (next === visualType) return;
      typeSnapshotsDispatch({
        type: 'snapshotAndVisit',
        from: visualType,
        to: next,
        snapshot: { measures, groupBy, orderBy, selectCols },
      });
      const restored = typeSnapshots.snapshots[next];
      if (restored) {
        setMeasures(restored.measures);
        setGroupBy(restored.groupBy);
        setOrderBy(restored.orderBy);
        setSelectCols(restored.selectCols);
      } else {
        setMeasures([]);
        setGroupBy([]);
        setOrderBy([]);
        setSelectCols([]);
      }
      setVisualType(next);
    },
    [
      visualType,
      measures,
      groupBy,
      orderBy,
      selectCols,
      typeSnapshots.snapshots,
      setMeasures,
      setGroupBy,
      setOrderBy,
      setSelectCols,
      setVisualType,
    ],
  );

  const columnsRef = useRef(columns);
  const selectColsRef = useRef(selectCols);
  const wantsTimeBucketRef = useRef(wantsTimeBucket);
  useEffect(() => {
    columnsRef.current = columns;
    selectColsRef.current = selectCols;
    wantsTimeBucketRef.current = wantsTimeBucket;
  });

  useEffect(() => {
    applyVisualTypeReshape(
      visualType,
      {
        columns: columnsRef.current,
        wantsTimeBucket: wantsTimeBucketRef.current,
        selectColsLength: selectColsRef.current.length,
      },
      {
        setMeasures: updater => setMeasures(updater),
        setGroupBy: updater => setGroupBy(updater),
        setSelectCols: next => setSelectCols(next),
      },
    );
  }, [visualType, tableName, dataSourceId, setMeasures, setGroupBy, setSelectCols]);

  const builtPlan = useMemo(() => {
    const plan: Record<string, unknown> = {
      dataSourceId,
      model: tableName,
    };
    if (joins.length > 0) {
      plan['joins'] = joins
        .filter(j => j.model && j.on.from && j.on.to)
        .map(j => ({
          model: j.model,
          type: j.type,
          on: { from: j.on.from, to: j.on.to },
          ...(j.alias ? { alias: j.alias } : {}),
        }));
    }
    if (wantsGroupBy && groupBy.length > 0) {
      plan['groupBy'] = groupBy
        .filter(g => g.column)
        .map(g => {
          const col = columnByName[g.column];
          const includeBucket = !!g.bucket && col?.dataTypeCanonical === 'temporal';
          return {
            column: g.column,
            ...(g.alias ? { alias: g.alias } : {}),
            ...(includeBucket ? { bucket: g.bucket } : {}),
          };
        });
    }
    if (wantsMeasures && measures.length > 0) {
      plan['measures'] = measures
        .filter(m => m.column && m.op)
        .map(m => ({
          column: m.column,
          op: m.op,
          ...(m.alias ? { alias: m.alias } : {}),
          ...(m.filter !== undefined ? { filter: m.filter } : {}),
        }));
    }
    if (wantsSelect && selectCols.length > 0) {
      if (joins.length > 0) {
        const joinedColNames = new Set(
          inScopeColumns.filter(c => !c.isBase).map(c => c.columnName),
        );
        plan['select'] = selectCols.map(col =>
          !col.includes('.') && joinedColNames.has(col) ? `${tableName}.${col}` : col,
        );
      } else {
        plan['select'] = selectCols;
      }
    }

    const activeFilters = filters.filter(f => f.column && (isUnaryOp(f.op) || f.value !== ''));
    if (activeFilters.length > 0) {
      const clauses = activeFilters
        .map(f => filterRowToColumnFilter(f, columnByName[f.column]))
        .filter((c): c is Record<string, unknown> => c !== null)
        .map(filter => ({ filter }));
      if (clauses.length > 0) {
        plan['where'] = { AND: clauses };
      }
    }
    if (orderBy.length > 0) {
      plan['orderBy'] = orderBy.filter(o => o.column).map(o => ({ column: o.column, dir: o.dir }));
    }
    if (take && Number(take) > 0) {
      plan['take'] = Number(take);
    }
    return plan;
  }, [
    dataSourceId,
    tableName,
    joins,
    inScopeColumns,
    wantsGroupBy,
    groupBy,
    wantsMeasures,
    measures,
    wantsSelect,
    selectCols,
    filters,
    orderBy,
    take,
    columnByName,
  ]);

  const invalidMeasure = useMemo(
    () =>
      measures.find(m => {
        if (!m.column.trim()) return true;
        if (m.op !== 'count' && m.column === '*') return true;
        if (m.column !== '*') {
          const meta = inScopeColumns.find(c => c.value === m.column);
          if (meta && !isColumnCompatibleWithOp(meta.dataTypeCanonical, m.op)) {
            return true;
          }
        }
        return false;
      }) ?? null,
    [measures, inScopeColumns],
  );

  const invalidOrderBy = useMemo(() => {
    if (orderBy.length === 0) return null;
    if (visualType === QueryVisualizationType.DATA_TABLE) {
      const allowed = new Set<string>(
        selectCols.length > 0 ? selectCols : inScopeColumns.map(c => c.value),
      );
      return orderBy.find(o => !allowed.has(o.column)) ?? null;
    }
    const allowed = new Set<string>([
      ...measures.map(m => m.alias).filter((a): a is string => !!a),
      ...groupBy.map(g => g.alias).filter((a): a is string => !!a),
    ]);
    return orderBy.find(o => !allowed.has(o.column)) ?? null;
  }, [orderBy, visualType, measures, groupBy, selectCols, inScopeColumns]);

  const planIsValid = useMemo(() => {
    if (!dataSourceId || !tableName) return false;
    if (invalidMeasure) return false;
    if (invalidOrderBy) return false;
    const measureAliases = new Set(measures.map(m => m.alias).filter(Boolean));
    const groupByAliases = new Set(groupBy.map(g => g.alias).filter(Boolean));
    switch (visualType) {
      case QueryVisualizationType.BAR_CHART:
      case QueryVisualizationType.PIE_CHART:
        return groupByAliases.has('label') && measureAliases.has('value');
      case QueryVisualizationType.LINE_CHART:
      case QueryVisualizationType.AREA_CHART:
        return groupByAliases.has('x') && measureAliases.has('y');
      case QueryVisualizationType.SCATTER_CHART:
        return measureAliases.has('x') && measureAliases.has('y');
      case QueryVisualizationType.KPI:
        return measureAliases.has('value');
      case QueryVisualizationType.KPI_COMPARE:
        return measureAliases.has('current') && measureAliases.has('previous');
      case QueryVisualizationType.DATA_TABLE:
        return true;
      default:
        return true;
    }
  }, [dataSourceId, tableName, visualType, measures, groupBy, invalidMeasure, invalidOrderBy]);

  const invalidPlanMessage = useMemo(() => {
    if (dataSourceId && !tableName) return 'Pick a table to preview this component.';
    if (!dataSourceId || !tableName) return 'Pick a data source and table first.';

    if (invalidMeasure) {
      if (!invalidMeasure.column.trim()) {
        return `The "${invalidMeasure.op}" measure has no column — pick one above.`;
      }
      if (invalidMeasure.column === '*') {
        return `The "${invalidMeasure.op}" aggregation can't use * — only "count" can. Pick a real column.`;
      }
      const expected =
        invalidMeasure.op === 'sum' || invalidMeasure.op === 'avg'
          ? 'a numeric column'
          : 'a numeric or date column';
      return `"${invalidMeasure.op}" doesn't work on column "${invalidMeasure.column}". Pick ${expected} instead.`;
    }
    if (invalidOrderBy) {
      return visualType === QueryVisualizationType.DATA_TABLE
        ? `Order-by references "${invalidOrderBy.column}" which isn't in the selected columns. Pick one of those.`
        : `Order-by references "${invalidOrderBy.column}" which isn't a measure or group-by alias. Pick one of those.`;
    }

    if (
      visualType === QueryVisualizationType.LINE_CHART ||
      visualType === QueryVisualizationType.AREA_CHART
    ) {
      const hasTemporal = inScopeColumns.some(c => c.dataTypeCanonical === 'temporal');
      if (!hasTemporal) {
        return 'Selected table has no temporal column for a time-series chart. Use Bar/Pie/Table or join a table with a date/time column.';
      }
    }

    return 'Complete the required fields for this chart type to preview.';
  }, [dataSourceId, tableName, visualType, inScopeColumns, invalidMeasure, invalidOrderBy]);

  const handlePreview = useCallback(async () => {
    if (!planIsValid) {
      previewDispatch({
        type: 'setError',
        error: new ComponentDataError({
          status: 0,
          code: 'IncompletePlan',
          message: invalidPlanMessage,
        }),
      });
      return;
    }
    const seq = ++previewSeqRef.current;
    previewDispatch({ type: 'previewStart' });
    try {
      const result = await previewQueryPlan({ plan: builtPlan, visualType });
      if (seq !== previewSeqRef.current) return;
      previewDispatch({ type: 'previewSuccess', result });
    } catch (e) {
      if (seq !== previewSeqRef.current) return;
      previewDispatch({ type: 'previewFailure', error: e as ComponentDataError });
    } finally {
      if (seq === previewSeqRef.current) previewDispatch({ type: 'previewSettled' });
    }
  }, [builtPlan, visualType, planIsValid, invalidPlanMessage]);

  useEffect(() => {
    if (!planIsValid) return;
    const id = window.setTimeout(() => {
      void handlePreview();
    }, 500);
    return (): void => window.clearTimeout(id);
  }, [builtPlan, planIsValid, handlePreview]);

  const handleSave = useCallback(() => {
    if (!z) {
      toast.error('Zero client unavailable');
      return;
    }
    if (!planIsValid) {
      toast.error(invalidPlanMessage);
      return;
    }
    previewDispatch({ type: 'saveStart' });

    const onFailure = (detail?: string): void => {
      toast.error('Failed to save component', {
        ...(detail ? { description: detail } : {}),
      });
    };
    const onSuccess = (savedId: string, message: string): void => {
      toast.success(message);
      onSaved?.(savedId);
      onClose();
    };
    const handleResult = (
      result: ReturnType<typeof z.mutate>,
      savedId: string,
      successMessage: string,
    ): void => {
      result.server
        .then(r => {
          if (r.type === 'error') {
            onFailure(r.error instanceof Error ? r.error.message : undefined);
            return;
          }
          onSuccess(savedId, successMessage);
        })
        .catch((e: unknown) => onFailure(e instanceof Error ? e.message : undefined))
        .finally(() => previewDispatch({ type: 'saveDone' }));
    };

    try {
      const componentConfig = timeColumn ? { timeColumn } : {};
      if (isEditing && editingComponent) {
        handleResult(
          z.mutate(
            mutators.dashboardComponent.update({
              id: editingComponent.id,
              visualType,
              title: title.trim() || undefined,
              queryJson: builtPlan,
              config: JSON.stringify(componentConfig),
              timestamp: Date.now(),
            }),
          ),
          editingComponent.id,
          'Component updated',
        );
      } else {
        if (!user?.id) {
          toast.error('Not signed in');
          previewDispatch({ type: 'saveDone' });
          return;
        }
        const id = uuidv4();
        const position = JSON.stringify(
          nextOpenPosition(existingPositions, defaultSizeFor(visualType)),
        );
        handleResult(
          z.mutate(
            mutators.dashboardComponent.create({
              id,
              dashboardId,
              visualType,
              title: title.trim() || undefined,
              queryJson: builtPlan,
              position,
              config: JSON.stringify(componentConfig),
              createdBy: user.id,
              mappingId: uuidv4(),
              timestamp: Date.now(),
            }),
          ),
          id,
          'Component saved',
        );
      }
    } catch (e) {
      onFailure(e instanceof Error ? e.message : undefined);
      previewDispatch({ type: 'saveDone' });
    }
  }, [
    z,
    user,
    planIsValid,
    isEditing,
    editingComponent,
    visualType,
    existingPositions,
    dashboardId,
    title,
    timeColumn,
    builtPlan,
    onSaved,
    onClose,
    invalidPlanMessage,
  ]);

  const populateFromToolCall = useCallback(
    (call: DashboardToolCall) => {
      if (call.tool !== 'add_component') return;
      const args = call.args;
      if (!getRendererForType(args.visualType)) {
        toast.error(`Unsupported visual type "${args.visualType}"`, {
          description: 'Ask the AI for a different chart type.',
        });
        return;
      }
      setVisualType(args.visualType);
      setTitle(args.title);
      setTimeColumn(args.componentConfig?.timeColumn ?? '');
      const plan = args.queryPlan;
      setDataSourceId(plan.dataSourceId);
      setTableName(plan.model);
      setSelectCols((plan.select ?? []).map(s => (typeof s === 'string' ? s : s.column)));
      setJoins(
        (plan.joins ?? []).map(
          (j): JoinRow => ({
            id: uuidv4(),
            model: j.model,
            type: j.type ?? 'inner',
            on: { from: j.on.from, to: j.on.to },
            ...(j.alias !== undefined ? { alias: j.alias } : {}),
          }),
        ),
      );
      setGroupBy(
        (plan.groupBy ?? []).map((g): GroupByRow => {
          if (typeof g === 'string') return { id: uuidv4(), column: g };
          return {
            id: uuidv4(),
            column: g.column,
            ...(g.alias !== undefined ? { alias: g.alias } : {}),
            ...(g.bucket !== undefined ? { bucket: g.bucket } : {}),
          };
        }),
      );
      setMeasures(
        (plan.measures ?? []).map(
          (m): MeasureRow => ({
            id: uuidv4(),
            column: m.column,
            op: m.op,
            ...(m.alias !== undefined ? { alias: m.alias } : {}),
            ...(m.filter !== undefined ? { filter: m.filter } : {}),
          }),
        ),
      );
      setOrderBy(
        (plan.orderBy ?? []).map(o => ({
          id: uuidv4(),
          column: o.column,
          dir: o.dir,
        })),
      );
      setTake(plan.take ? String(plan.take) : '');
      setFilters(flattenWhereToFilters(plan.where));
      typeSnapshotsDispatch({ type: 'reset', visualType: args.visualType });
    },
    [
      setVisualType,
      setTitle,
      setTimeColumn,
      setDataSourceId,
      setTableName,
      setSelectCols,
      setJoins,
      setGroupBy,
      setMeasures,
      setOrderBy,
      setTake,
      setFilters,
    ],
  );

  const formattedPreviewError = useMemo((): string | null => {
    if (!previewError) return null;
    const baseMessage = previewError.message || previewError.code || 'Preview failed';
    const issues = previewError.details?.issues;
    if (previewError.status === 422 && issues && issues.length > 0) {
      const first = issues[0];
      const path = (first?.path ?? []).join('.') || '<root>';
      return `${baseMessage} — at ${path}: ${first?.message ?? 'unknown reason'}`;
    }
    return baseMessage;
  }, [previewError]);

  const previewTile: ComponentTileData | null = useMemo(() => {
    if (previewError) {
      return {
        id: 'preview',
        visualType,
        title: title.trim() || `Preview ${visualType}`,
        error: formattedPreviewError ?? previewError.message,
      };
    }
    if (!previewResult) {
      return planIsValid
        ? {
            id: 'preview',
            visualType,
            title: title.trim() || `Preview ${visualType}`,
            loading: true,
          }
        : null;
    }
    return {
      id: 'preview',
      visualType,
      title: title.trim() || `Preview ${visualType}`,
      data: previewResult.data,
    };
  }, [visualType, title, previewResult, previewError, planIsValid, formattedPreviewError]);

  return (
    <div className='w-full flex flex-col h-full bg-white'>
      <ComponentEditorHeader
        dashboardName={dashboardName ?? 'Dashboard'}
        title={title}
        isPreviewing={isPreviewing}
        isSaving={isSaving}
        planIsValid={planIsValid}
        hasPreviewError={!!previewError}
        onRefresh={() => void handlePreview()}
        onCancel={onClose}
        onSave={handleSave}
      />

      <div className='flex flex-1 min-h-0'>
        <div className='flex-1 min-w-0 flex flex-col overflow-auto'>
          <div className='px-6 pt-5 pb-3'>
            <div className='relative h-[400px] rounded-xl border border-xyne-gray-200 bg-white overflow-hidden'>
              <div className='absolute inset-2 rounded-lg border border-dashed border-xyne-primary-200 pointer-events-none' />
              <div className='absolute top-3 left-4 z-10 text-[13px] leading-[18px] font-medium text-xyne-gray-900'>
                Live Preview
              </div>
              <div className='absolute top-2.5 right-3 z-10'>
                <ChartTypeSelect
                  value={visualType}
                  onChange={switchType}
                  inScopeColumns={inScopeColumns}
                />
              </div>
              <div className='absolute inset-0 pt-12 pb-4 px-4'>
                {previewTile ? (
                  <div className='h-full rounded-lg overflow-hidden'>
                    <ComponentTile component={previewTile} />
                  </div>
                ) : (
                  <div className='flex flex-col items-center justify-center h-full text-center text-sm text-xyne-gray-500'>
                    <Database size={28} className='mb-3 opacity-50' />
                    {invalidPlanMessage}
                  </div>
                )}
              </div>
              {isPreviewing && (
                <div className='absolute top-3 right-32 z-10'>
                  <Loader2 size={14} className='animate-spin text-xyne-gray-500' />
                </div>
              )}
            </div>
          </div>

          {draftedTypeLabels.length > 0 && (
            <div className='mx-6 mb-3 flex items-start gap-2 text-xs text-xyne-gray-900/80 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2'>
              <AlertTriangle size={14} className='mt-0.5 shrink-0 text-amber-600' />
              <span className='leading-relaxed'>
                You&apos;ve built{' '}
                <span className='font-semibold'>{draftedTypeLabels.join(', ')}</span>{' '}
                {draftedTypeLabels.length === 1 ? 'draft' : 'drafts'} for this component. Changing
                the data source or table will reset {draftedTypeLabels.length === 1 ? 'it' : 'them'}
                .
              </span>
            </div>
          )}

          <div className='px-6 pb-6'>
            <VisualBuilder
              visualType={visualType}
              title={title}
              setTitle={setTitle}
              dataSourceId={dataSourceId}
              setDataSourceId={dsId => {
                requestSharedFieldChange('data source', () => {
                  setDataSourceId(dsId);
                  setTableName('');
                  resetSchemaScopedState();
                });
              }}
              dataSources={dataSourcesQuery.data ?? []}
              tableName={tableName}
              setTableName={t => {
                requestSharedFieldChange('table', () => {
                  setTableName(t);
                  resetSchemaScopedState();
                });
              }}
              tables={schemaQuery.data?.tables ?? []}
              schemaLoading={schemaQuery.isLoading}
              columns={columns}
              inScopeColumns={inScopeColumns}
              joins={joins}
              setJoins={setJoins}
              availableJoinEdges={availableJoinEdges}
              groupBy={groupBy}
              setGroupBy={setGroupBy}
              measures={measures}
              setMeasures={setMeasures}
              selectCols={selectCols}
              setSelectCols={setSelectCols}
              filters={filters}
              setFilters={setFilters}
              orderBy={orderBy}
              setOrderBy={setOrderBy}
              take={take}
              setTake={setTake}
              timeColumn={timeColumn}
              setTimeColumn={setTimeColumn}
              wantsGroupBy={wantsGroupBy}
              wantsMeasures={wantsMeasures}
              wantsSelect={wantsSelect}
              wantsTimeBucket={wantsTimeBucket}
            />
          </div>
        </div>

        <aside className='w-[360px] shrink-0 border-l border-xyne-gray-200 bg-white flex flex-col'>
          <AiSidePanel
            dashboardName={dashboardName ?? 'Dashboard'}
            dataSourceId={dataSourceId}
            setDataSourceId={dsId => {
              requestSharedFieldChange('data source', () => {
                setDataSourceId(dsId);
                setTableName('');
                resetSchemaScopedState();
              });
            }}
            dataSources={dataSourcesQuery.data ?? []}
            lastError={formattedPreviewError ?? previewError?.message ?? null}
            onToolCall={populateFromToolCall}
          />
        </aside>
      </div>

      {pendingFieldChange && (
        <ResetDraftsConfirmOverlay
          fieldName={pendingFieldChange.fieldName}
          draftedTypeLabels={draftedTypeLabels}
          onCancel={() => setPendingFieldChange(null)}
          onConfirm={() => {
            pendingFieldChange.apply();
            setPendingFieldChange(null);
          }}
        />
      )}
    </div>
  );
};

export default ComponentEditorModal;
