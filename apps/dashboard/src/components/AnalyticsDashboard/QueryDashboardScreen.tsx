import { ArrowLeft, BarChart3, ChevronLeft, Plus, Save, X } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { useAuth } from '../../hooks/useAuth';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useZero } from '../../hooks/useZero';
import {
  buildFieldsConfig,
  FieldConfig,
  filterGroupToLogicalFilter,
  LogicalFilter,
  logicalFilterToFilterGroup,
} from '../../routes/QueryBuilderScreen/QueryBuilderScreen.utils';
import { apiInstance } from '../../services/clients/apiClient';
import type { FilterGroup } from '../../utils/queryBuilder';
import { mutators } from '../../zero/mutators';
import { queries } from '../../zero/queries';
import { FilterRuleBuilder } from '../QueryBuilderComponents/FilterRuleBuilder';
import {
  getVisualizationConstraints,
  VisualizationSelector,
} from '../QueryBuilderComponents/VisualizationSelector';
import {
  defaultSizeForVisualType,
  nextOpenPosition,
  serializePosition,
} from '../DynamicDashboard/componentEditor/queryPlanUtils';
import { getBarChartPreview } from '../QueryVisualizations/BarChart';
import { getDataTablePreview } from '../QueryVisualizations/DataTable';
import { getDonutChartPreview } from '../QueryVisualizations/DonutChart';
import { getFunnelPreview } from '../QueryVisualizations/Funnel';
import { getHeatmapPreview } from '../QueryVisualizations/Heatmap';
import { getKPIPreview } from '../QueryVisualizations/KPICard';
import { getLineChartPreview } from '../QueryVisualizations/LineChart';
import { getPieChartPreview } from '../QueryVisualizations/PieChart';
import { QueryVisualization } from '../QueryVisualizations/QueryVisualization';
import { QueryVisualizationType } from '../QueryVisualizations/types';
import { Button } from '../ui/Button';
import { EntityMultiSelector } from '../ui/EntitySelector/EntityMultiSelector';
import { EntitySelector } from '../ui/EntitySelector/EntitySelector';
import Input from '../ui/Input/Input';
import QueryResults, { type DashboardWithQueries } from './QueryResults';

interface FieldInfo {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'select';
  sortable: boolean;
  filterable: boolean;
  aggregatable: boolean;
  description?: string;
  enumType?: string;
  enumValues?: string[];
  fieldId?: string;
  isCustom?: boolean;
}

interface AvailableFields {
  system: FieldInfo[];
  custom: FieldInfo[];
}

export const QueryDashboardScreen: React.FC = () => {
  const { dashboardId } = useParams<{ dashboardId: string }>();
  const zero = useZero();
  const navigate = useNavigate();
  const { user } = useAuth();
  // Main screen state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingQueryId, setEditingQueryId] = useState<string | null>(null);

  // Query builder state
  const [fields, setFields] = useState<FieldConfig[] | null>(null);
  const [queryName, setQueryName] = useState('');
  const [selectedEntityType, setSelectedEntityType] = useState('TICKET');
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [orderBy, setOrderBy] = useState<Array<{ field: string; direction: 'ASC' | 'DESC' }>>([]);
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [groupBy, setGroupBy] = useState<string[]>([]);
  const [aggregations, setAggregations] = useState<
    Array<{ function: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX'; field: string; alias?: string }>
  >([]);
  const [dateGranularity, setDateGranularity] = useState<'hour' | 'day' | 'week' | 'month'>('day');
  const [query, setQuery] = useState<FilterGroup>({ id: '', combinator: 'AND', conditions: [] });
  const [visualizationType, setVisualizationType] = useState<QueryVisualizationType | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [previewData, setPreviewData] = useState<Record<string, unknown>[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [currentDashboard] = useCachedQuery(
    queries.getDashboardById({ dashboardId: dashboardId || '' }),
    { enabled: !!dashboardId },
  );

  useEffect(() => {}, [showCreateModal]);

  useEffect(() => {
    if (editingQueryId && currentDashboard) {
      const dashboard = (
        Array.isArray(currentDashboard) ? currentDashboard[0] : currentDashboard
      ) as {
        queryMappings?: {
          query?: {
            id: string;
            title: string;
            queryJson: {
              entityType?: string;
              select?: string[];
              orderBy?: Array<{ field: string; direction: 'ASC' | 'DESC' }>;
              limit?: number;
              offset?: number;
              aggregations?: Array<{ function: string; field: string; alias?: string }>;
              groupBy?: string[];
              visualizationType?: string;
            };
          };
        }[];
      };
      if (dashboard?.queryMappings) {
        const queryMappings = dashboard.queryMappings;
        const mapping = queryMappings.find(m => m.query?.id === editingQueryId);
        const editQuery = mapping?.query;

        if (editQuery) {
          setQueryName(editQuery.title || '');
          const queryJson = editQuery.queryJson as Record<string, unknown>;
          setSelectedFields((queryJson['select'] as string[]) || []);
          setOrderBy(
            (queryJson['orderBy'] as Array<{ field: string; direction: 'ASC' | 'DESC' }>) || [],
          );
          setLimit((queryJson['limit'] as number) || 50);
          setOffset((queryJson['offset'] as number) || 0);
          setGroupBy((queryJson['groupBy'] as string[]) || []);
          setAggregations(
            (
              (queryJson['aggregations'] as Array<{
                function: string;
                field: string;
                alias?: string;
              }>) || []
            ).map(a => ({
              function: a.function as 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX',
              field: a.field,
              ...(a.alias ? { alias: a.alias } : {}),
            })),
          );
          setDateGranularity(
            (queryJson['dateGranularity'] as 'hour' | 'day' | 'week' | 'month') || 'day',
          );
          setSelectedEntityType((queryJson['entityType'] as string) || 'TICKET');
          setVisualizationType(
            (queryJson['visualizationType'] as string as QueryVisualizationType) || null,
          );

          // Load filters and transform from backend's LogicalFilter format to FilterGroup format
          if (queryJson['filters']) {
            try {
              const filtersData = queryJson['filters'] as unknown;
              // Convert to FilterGroup
              if (
                filtersData &&
                typeof filtersData === 'object' &&
                'operator' in filtersData &&
                'conditions' in filtersData
              ) {
                const filterGroup = logicalFilterToFilterGroup(filtersData as LogicalFilter);
                setQuery(filterGroup);
              } else if (
                filtersData &&
                typeof filtersData === 'object' &&
                'combinator' in filtersData &&
                'conditions' in filtersData
              ) {
                // Already in FilterGroup format
                setQuery(filtersData as FilterGroup);
              } else {
                setQuery({ id: '', combinator: 'AND', conditions: [] });
              }
            } catch {
              setQuery({ id: '', combinator: 'AND', conditions: [] });
            }
          } else {
            // Reset to default if no filters
            setQuery({ id: '', combinator: 'AND', conditions: [] });
          }
        }
      }
    }
  }, [editingQueryId, currentDashboard]);

  useEffect(() => {
    let stale = false;
    const loadFields = async () => {
      try {
        const url = `/analytics-query/fields?entityType=${selectedEntityType}`;
        const response = await apiInstance.get<{ data: AvailableFields }>(url);
        if (stale) return;

        if (response.data.data) {
          const systemFields = response.data.data.system.map(f => ({
            name: f.name,
            key: f.name,
            type: f.type,
            isCustom: false,
            aggregatable: f.aggregatable,
            ...(f.enumValues ? { enumValues: f.enumValues } : {}),
          }));
          const customFields = response.data.data.custom.map(f => ({
            name: f.name,
            key: `custom.${f.fieldId}`,
            type: f.type,
            isCustom: true,
            fieldId: f.fieldId,
            aggregatable: f.aggregatable,
            ...(f.enumValues ? { enumValues: f.enumValues } : {}),
          }));
          const config = buildFieldsConfig([...systemFields, ...customFields]);
          setFields(config);
        } else {
          setFields([]);
        }
      } catch {
        if (!stale) {
          setFields([]);
        }
      }
    };

    if (showCreateModal) {
      void loadFields();
    }

    return () => {
      stale = true;
    };
  }, [selectedEntityType, showCreateModal]);

  const resetForm = () => {
    setQueryName('');
    setSelectedEntityType('TICKET');
    setSelectedFields([]);
    setFields(null);
    setOrderBy([]);
    setLimit(50);
    setOffset(0);
    setGroupBy([]);
    setAggregations([]);
    setVisualizationType(null);
    setErrorMessage('');
    setPreviewData(null);
    setEditingQueryId(null);
  };

  useEffect(() => {
    if (!showCreateModal) {
      resetForm();
    }
  }, [showCreateModal]);

  useEffect(() => {
    if (!visualizationType) return;
    const constraints = getVisualizationConstraints(visualizationType);

    if (constraints.requiresAggregation && aggregations.length === 0) {
      const f = fields?.find(x => x.aggregatable);
      setAggregations([{ function: 'COUNT', field: f?.name ?? '' }]);
    } else if (!constraints.requiresAggregation && aggregations.length > 0) {
      setAggregations([]);
    }

    if (constraints.allowsGroupBy && groupBy.length === 0) {
      const f = fields?.find(x => !x.name.startsWith('custom.'));
      setGroupBy([f?.name ?? '']);
    } else if (!constraints.allowsGroupBy && groupBy.length > 0) {
      setGroupBy([]);
    }
  }, [visualizationType]);

  const handleSaveQuery = async () => {
    if (!queryName.trim()) {
      setErrorMessage('Please enter a query name');
      return;
    }
    if (!selectedEntityType) {
      setErrorMessage('Please select an entity type');
      return;
    }
    if (!visualizationType) {
      setErrorMessage('Please select a visualization type');
      return;
    }

    const constraints = getVisualizationConstraints(visualizationType);

    if (constraints.requiresAggregation && aggregations.length === 0) {
      setErrorMessage(`${visualizationType} requires at least one aggregation`);
      return;
    }

    setErrorMessage('');
    // Build query object for validation - only include entityType and optional fields (no undefined values)
    const queryValidation: Record<string, unknown> = {
      entityType: selectedEntityType,
    };

    if (selectedFields.length > 0) queryValidation['select'] = selectedFields;
    if (orderBy.length > 0) queryValidation['orderBy'] = orderBy;
    if (limit > 0) queryValidation['limit'] = limit;
    if (offset > 0) queryValidation['offset'] = offset;
    if (aggregations.length > 0) queryValidation['aggregations'] = aggregations;
    if (groupBy.length > 0) queryValidation['groupBy'] = groupBy;
    if (groupBy.length > 0) queryValidation['dateGranularity'] = dateGranularity;

    // Transform FilterGroup format to backend's LogicalFilter format
    if (query && query.conditions && query.conditions.length > 0) {
      const logicalFilter = filterGroupToLogicalFilter(query);
      queryValidation['filters'] = logicalFilter;
    }

    try {
      const response = await apiInstance.post<{ success: boolean; error?: { message: string } }>(
        '/analytics-query/validate',
        queryValidation,
      );

      if (!response.data.success) {
        setErrorMessage(response.data.error?.message || 'Query validation failed');
        return;
      }

      const queryId = editingQueryId || uuidv4();

      let mappingId = uuidv4();
      if (editingQueryId && currentDashboard) {
        const dashboard = (
          Array.isArray(currentDashboard) ? currentDashboard[0] : currentDashboard
        ) as { queryMappings?: { id: string; queryId: string }[] };
        const existingMapping = dashboard?.queryMappings?.find(m => m.queryId === editingQueryId);
        if (existingMapping) {
          mappingId = existingMapping.id;
        }
      }

      // Build full query object for storage (includes visualizationType)
      const queryToSave: Record<string, unknown> = { ...queryValidation, visualizationType };

      let position: string | undefined;
      if (!editingQueryId && currentDashboard) {
        const dashboard = (
          Array.isArray(currentDashboard) ? currentDashboard[0] : currentDashboard
        ) as {
          queryMappings?: Array<{ query?: { position?: string } }>;
        };
        const existingPositions = (dashboard?.queryMappings ?? [])
          .map(m => m.query?.position)
          .filter((p): p is string => typeof p === 'string' && p.length > 0);
        const gridPos = nextOpenPosition(
          existingPositions,
          defaultSizeForVisualType(visualizationType),
        );
        position = serializePosition(gridPos);
      }

      void zero.mutate(
        mutators.query.upsert({
          id: queryId,
          title: queryName,
          queryJson: queryToSave,
          targetEntity: selectedEntityType,
          visualType: visualizationType || undefined,
          ...(position !== undefined && { position }),
          dashboardId: dashboardId || currentDashboard?.id || '',
          createdBy: user?.id || '',
          timestamp: Date.now(),
          mappingId,
        }),
      );

      resetForm();
      setShowCreateModal(false);
    } catch (error: unknown) {
      if (error instanceof Error) {
        setErrorMessage(error.message || 'Failed to validate query');
      } else {
        setErrorMessage('Failed to validate query');
      }
    }
  };

  // Auto-load preview whenever form changes
  useEffect(() => {
    if (!showCreateModal) return;

    const timer = setTimeout(() => {
      void loadPreview();
    }, 300); // Debounce to avoid too many updates

    return () => clearTimeout(timer);
  }, [showCreateModal, visualizationType, aggregations, groupBy]);

  // Generate sample data based on visualization type
  const generateSampleData = (): Record<string, unknown>[] => {
    if (!visualizationType) {
      return [];
    }

    switch (visualizationType) {
      case QueryVisualizationType.PIE_CHART:
        return getPieChartPreview() as unknown as Record<string, unknown>[];

      case QueryVisualizationType.DONUT_CHART:
        return getDonutChartPreview() as unknown as Record<string, unknown>[];

      case QueryVisualizationType.BAR_CHART:
        return getBarChartPreview() as unknown as Record<string, unknown>[];

      case QueryVisualizationType.LINE_CHART:
        return getLineChartPreview() as unknown as Record<string, unknown>[];

      case QueryVisualizationType.KPI:
        return getKPIPreview();

      case QueryVisualizationType.FUNNEL:
        return getFunnelPreview() as unknown as Record<string, unknown>[];

      case QueryVisualizationType.HEATMAP:
        return getHeatmapPreview();

      case QueryVisualizationType.DATA_TABLE:
      default:
        return getDataTablePreview();
    }
  };

  const loadPreview = () => {
    setPreviewLoading(true);
    try {
      // Use sample data from visualization components
      const sampleData = generateSampleData();
      setPreviewData(sampleData);
    } catch {
      // Silently handle preview errors
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleDeleteQuery = React.useCallback(
    (queryId: string) => {
      if (!dashboardId) return;
      void zero.mutate(
        mutators.query.delete({
          id: queryId,
        }),
      );
    },
    [zero, dashboardId],
  );

  const handleEditQuery = React.useCallback(
    (queryToEdit: {
      id: string;
      title: string;
      queryJson: unknown;
      visualType?: string | null;
    }): void => {
      setEditingQueryId(queryToEdit.id);
      setShowCreateModal(true);
    },
    [],
  );

  const handleCloseModal = () => {
    setShowCreateModal(false);
    resetForm();
  };

  if (!currentDashboard) {
    return (
      <div className='flex items-center justify-center h-full'>
        <p className='text-muted-foreground'>Loading dashboard...</p>
      </div>
    );
  }

  const dashboardData = (
    Array.isArray(currentDashboard) ? currentDashboard[0] : currentDashboard
  ) as DashboardWithQueries;

  return (
    <div className='h-full bg-gradient-to-br from-background via-background to-muted/5 flex flex-col'>
      {/* Header */}
      <div className='shrink-0 border-b border-border/40 bg-gradient-to-r from-background via-background to-muted/20 backdrop-blur-sm shadow-sm'>
        <div className='px-6 py-4 flex items-center justify-between'>
          <div className='flex items-center gap-3'>
            <button
              onClick={() => void navigate('/analytics-dashboard')}
              className='flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 px-3 py-1.5 rounded-md transition-all duration-200 group'
              data-track-category='ANALYTICS'
              data-track-name='Navigate_Back_To_Dashboards'
            >
              <ArrowLeft className='w-4 h-4 group-hover:-translate-x-0.5 transition-transform' />
              <span>Dashboards</span>
            </button>
            <span className='text-muted-foreground/30'>/</span>
            <div className='flex items-center gap-2'>
              <div className='flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-primary/20 to-primary/10 border border-primary/20 shadow-sm'>
                <BarChart3 className='w-4 h-4 text-primary' />
              </div>
              <h1 className='text-base font-bold bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text text-transparent'>
                {dashboardData?.name ?? 'Analytics Dashboard'}
              </h1>
            </div>
          </div>
          <Button
            size='sm'
            onClick={() => {
              resetForm();
              setShowCreateModal(true);
            }}
            className='bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white gap-1.5 shadow-lg hover:shadow-xl transition-all duration-200 font-medium'
            data-track-category='ANALYTICS'
            data-track-name='Open_Create_Query_Modal'
          >
            <Plus size={16} />
            Create Query
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className='flex-1 min-h-0 overflow-y-auto px-6 py-6 bg-gradient-to-b from-transparent to-muted/5'>
        {/* Queries Display */}
        <QueryResults
          dashboardData={dashboardData}
          onDeleteQuery={handleDeleteQuery}
          onEditQuery={handleEditQuery}
        />
      </div>

      {/* Create/Edit Query Modal */}
      {showCreateModal && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm'>
          <div className='bg-background flex flex-col w-[95vw] h-[90vh] rounded-xl shadow-2xl overflow-hidden border border-border/40 bg-gradient-to-br from-background to-background/95'>
            {/* Header */}
            <div className='flex items-center justify-between px-6 py-4 border-b border-border/30 bg-gradient-to-r from-background/80 to-background/60 backdrop-blur-sm'>
              <div className='flex items-center gap-3'>
                <Button
                  onClick={handleCloseModal}
                  data-track-category='ANALYTICS'
                  data-track-name='CLOSE_QUERY_MODAL'
                  variant='ghost'
                  size='iconSm'
                  className='text-foreground hover:bg-muted/60 rounded-lg transition-colors'
                >
                  <ChevronLeft size={20} />
                </Button>
                <span className='font-bold text-lg bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent'>
                  {editingQueryId ? 'Edit Query' : 'Create Query'}
                </span>
              </div>
              <div className='flex items-center gap-3'>
                <Button
                  variant='secondary'
                  onClick={handleCloseModal}
                  data-track-category='ANALYTICS'
                  data-track-name='CLOSE_QUERY_MODAL'
                  className='hover:bg-muted/70 border-border/50 transition-all'
                >
                  Cancel
                </Button>
                <Button
                  className='bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white shadow-lg hover:shadow-xl transition-all duration-200 font-medium'
                  onClick={() => void handleSaveQuery()}
                  data-track-category='ANALYTICS'
                  data-track-name='Save_Query'
                >
                  <Save size={16} />
                  Save Query
                </Button>
              </div>
            </div>

            {/* Main Content */}
            <div className='flex-1 min-h-0 overflow-hidden flex'>
              {/* Left Panel - Query Builder */}
              <div className='flex-1 min-h-0 overflow-y-auto border-r border-border/30 p-6 space-y-6 bg-gradient-to-b from-background/50 to-background'>
                {/* Query Name */}
                <div className='space-y-2'>
                  <label htmlFor='query-name' className='text-sm font-semibold text-foreground'>
                    Query Name
                  </label>
                  <Input
                    id='query-name'
                    value={queryName}
                    onChange={e => setQueryName(e.target.value)}
                    placeholder='Enter query name'
                    className='border-border/50 bg-background/80 hover:bg-background focus:bg-background focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all rounded-lg shadow-sm'
                  />
                </div>

                {/* Entity Type Selection */}
                <div className='space-y-2'>
                  <label htmlFor='entity-type' className='text-sm font-semibold text-foreground'>
                    Entity Type
                  </label>
                  <select
                    id='entity-type'
                    value={selectedEntityType}
                    onChange={e => setSelectedEntityType(e.target.value)}
                    className='w-full px-4 py-2.5 border border-border/50 rounded-lg bg-background/80 text-foreground hover:bg-background focus:bg-background focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all shadow-sm font-medium'
                    data-track-category='ANALYTICS'
                    data-track-name='Select_Entity_Type'
                  >
                    <option value='TICKET'>Ticket</option>
                    <option value='USER_WORKLOAD_MAPPING'>User Workload Mapping</option>
                  </select>
                </div>

                {/* Visualization Type Selection */}
                <VisualizationSelector
                  selected={visualizationType}
                  onChange={setVisualizationType}
                />

                {/* Select Fields */}
                {visualizationType &&
                  getVisualizationConstraints(visualizationType).allowsSelectFields &&
                  fields &&
                  fields.length > 0 && (
                    <div className='space-y-2'>
                      <label
                        htmlFor='select-fields'
                        className='text-sm font-semibold text-foreground'
                      >
                        Select Fields
                      </label>
                      <div
                        id='select-fields'
                        className='flex flex-wrap gap-2 p-3 rounded-lg border border-border/30 bg-muted/20 backdrop-blur-sm'
                      >
                        <EntityMultiSelector
                          options={fields.map(f => ({ value: f.name, label: f.label, icon: null }))}
                          selectedValues={selectedFields}
                          onMultiSelect={setSelectedFields}
                          placeholder='Search fields...'
                          searchPlaceholder='Search fields...'
                          showSearch={true}
                          width='100%'
                          disableClientFiltering={false}
                        />
                      </div>
                    </div>
                  )}

                {/* Aggregations */}
                {visualizationType &&
                  getVisualizationConstraints(visualizationType).requiresAggregation && (
                    <>
                      <div className='p-3 bg-gradient-to-r from-blue-50/50 to-cyan-50/50 dark:from-blue-900/20 dark:to-cyan-900/20 border border-blue-200/50 dark:border-blue-800/50 rounded-lg shadow-sm backdrop-blur-sm'>
                        <p className='text-xs text-blue-700 dark:text-blue-300 font-semibold'>
                          ℹ️ This visualization requires at least one aggregation
                        </p>
                      </div>
                      <div className='space-y-2'>
                        <div className='flex items-center justify-between'>
                          <label
                            htmlFor='aggregations'
                            className='text-sm font-semibold text-foreground'
                          >
                            Aggregations
                          </label>
                          <Button
                            variant='ghost'
                            size='sm'
                            onClick={() => {
                              const f = fields?.filter(x => x.aggregatable)?.[0];
                              if (f)
                                setAggregations(p => [...p, { function: 'COUNT', field: f.name }]);
                            }}
                            disabled={
                              !fields ||
                              fields.length === 0 ||
                              (visualizationType === QueryVisualizationType.KPI &&
                                aggregations.length >= 1)
                            }
                            data-track-category='ANALYTICS'
                            data-track-name='Add_Aggregation'
                          >
                            <Plus className='w-3 h-3' /> Add
                          </Button>
                        </div>
                        {visualizationType === QueryVisualizationType.KPI &&
                          aggregations.length >= 1 && (
                            <p className='text-xs text-muted-foreground'>
                              Only one aggregation is allowed for KPI Card
                            </p>
                          )}
                        {aggregations.map((agg, i) => (
                          <div
                            key={i}
                            className='flex items-center gap-2 p-3 rounded-lg bg-muted/30 border border-border/30 hover:border-border/50 transition-colors'
                          >
                            <EntitySelector
                              options={[
                                { value: 'COUNT', label: 'COUNT', icon: null },
                                { value: 'SUM', label: 'SUM', icon: null },
                                { value: 'AVG', label: 'AVG', icon: null },
                                { value: 'MIN', label: 'MIN', icon: null },
                                { value: 'MAX', label: 'MAX', icon: null },
                              ]}
                              selectedValue={agg.function || null}
                              onSelect={value => {
                                if (value) {
                                  setAggregations(prev => {
                                    const n = [...prev];
                                    n[i] = {
                                      ...n[i]!,
                                      function: value as 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX',
                                    };
                                    return n;
                                  });
                                }
                              }}
                              placeholder='Select function...'
                              searchPlaceholder='Search functions...'
                              showSearch={false}
                              width='auto'
                            />
                            <EntitySelector
                              options={
                                fields?.map(f => ({
                                  value: f.name,
                                  label: f.label,
                                  icon: null,
                                })) || []
                              }
                              selectedValue={agg.field || null}
                              onSelect={value => {
                                if (value) {
                                  setAggregations(prev => {
                                    const n = [...prev];
                                    n[i] = { ...n[i]!, field: value };
                                    return n;
                                  });
                                }
                              }}
                              placeholder='Select field...'
                              searchPlaceholder='Search fields...'
                              showSearch={true}
                              width='100%'
                            />
                            <Input
                              placeholder='alias'
                              value={agg.alias || ''}
                              onChange={e =>
                                setAggregations(prev => {
                                  const n = [...prev];
                                  if (e.target.value) {
                                    n[i] = { ...n[i]!, alias: e.target.value };
                                  } else {
                                    const { alias: _, ...rest } = n[i]!;
                                    n[i] = rest;
                                  }
                                  return n;
                                })
                              }
                              className='w-24 px-3 py-1.5 text-sm border-border/50 bg-background/80 hover:bg-background focus:bg-background focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all rounded-md'
                            />
                            <Button
                              variant='ghost'
                              size='icon'
                              onClick={() =>
                                setAggregations(prev => prev.filter((_, x) => x !== i))
                              }
                              data-track-category='ANALYTICS'
                              data-track-name='Remove_Aggregation'
                            >
                              <X className='w-3 h-3' />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                {/* Group By */}
                {visualizationType &&
                  getVisualizationConstraints(visualizationType).allowsGroupBy &&
                  aggregations.length > 0 && (
                    <div className='space-y-2'>
                      <div className='flex items-center justify-between'>
                        <label htmlFor='group-by' className='text-sm font-semibold text-foreground'>
                          Group By
                        </label>
                        <Button
                          variant='ghost'
                          size='sm'
                          onClick={() => {
                            const f = fields?.filter(x => !x.name.startsWith('custom.'))?.[0];
                            if (f) setGroupBy(p => [...p, f.name]);
                          }}
                          disabled={
                            !fields ||
                            fields.filter(x => !x.name.startsWith('custom.')).length === 0 ||
                            (visualizationType === QueryVisualizationType.HEATMAP &&
                              groupBy.length >= 2)
                          }
                          data-track-category='ANALYTICS'
                          data-track-name='Add_Group_By'
                        >
                          <Plus className='w-3 h-3' /> Add
                        </Button>
                      </div>
                      {visualizationType === QueryVisualizationType.HEATMAP &&
                        groupBy.length >= 2 && (
                          <p className='text-xs text-muted-foreground'>
                            Maximum 2 group bys are allowed for Heatmap
                          </p>
                        )}
                      {groupBy.map((field, i) => {
                        const fieldConfig = fields?.find(f => f.name === field);
                        const isDateField = fieldConfig?.type === 'date';
                        return (
                          <div
                            key={i}
                            className='flex flex-col gap-2 p-3 rounded-lg bg-muted/30 border border-border/30 hover:border-border/50 transition-colors'
                          >
                            <div className='flex items-center gap-2'>
                              <EntitySelector
                                options={
                                  fields
                                    ?.filter(f => !f.name.startsWith('custom.'))
                                    .map(f => ({
                                      value: f.name,
                                      label: f.label,
                                      icon: null,
                                    })) || []
                                }
                                selectedValue={field || null}
                                onSelect={value => {
                                  if (value) {
                                    setGroupBy(prev => {
                                      const n = [...prev];
                                      n[i] = value;
                                      return n;
                                    });
                                  }
                                }}
                                placeholder='Select field...'
                                searchPlaceholder='Search fields...'
                                showSearch={true}
                                width='100%'
                              />
                              <Button
                                variant='ghost'
                                size='icon'
                                onClick={() => setGroupBy(prev => prev.filter((_, x) => x !== i))}
                                data-track-category='ANALYTICS'
                                data-track-name='Remove_Group_By'
                              >
                                <X className='w-3 h-3' />
                              </Button>
                            </div>
                            {isDateField && (
                              <div className='flex items-center gap-1'>
                                <span className='text-[10px] text-muted-foreground uppercase tracking-wide mr-1'>
                                  Granularity
                                </span>
                                {(['hour', 'day', 'week', 'month'] as const).map(g => (
                                  <button
                                    key={g}
                                    type='button'
                                    onClick={() => setDateGranularity(g)}
                                    className={`px-2 py-0.5 text-[10px] rounded-full capitalize transition-colors ${
                                      dateGranularity === g
                                        ? 'bg-primary text-primary-foreground'
                                        : 'bg-muted text-muted-foreground hover:bg-muted/80'
                                    }`}
                                    data-track-category='ANALYTICS'
                                    data-track-name='Set_Date_Granularity'
                                  >
                                    {g}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                {/* Order By */}
                {visualizationType &&
                  getVisualizationConstraints(visualizationType).allowsOrderBy && (
                    <div className='space-y-2'>
                      <div className='flex items-center justify-between'>
                        <label htmlFor='order-by' className='text-sm font-semibold text-foreground'>
                          Order By
                        </label>
                        <Button
                          variant='ghost'
                          size='sm'
                          onClick={() => {
                            const f = fields?.filter(x => !x.isCustom)?.[0];
                            if (f) setOrderBy(p => [...p, { field: f.key, direction: 'ASC' }]);
                          }}
                          disabled={!fields || fields.filter(x => !x.isCustom).length === 0}
                          data-track-category='ANALYTICS'
                          data-track-name='Add_Order_By'
                        >
                          <Plus className='w-3 h-3' /> Add
                        </Button>
                      </div>
                      {orderBy.map((order, i) => (
                        <div
                          key={i}
                          className='flex items-center gap-2 p-3 rounded-lg bg-muted/30 border border-border/30 hover:border-border/50 transition-colors'
                        >
                          <EntitySelector
                            options={
                              fields
                                ?.filter(f => !f.isCustom)
                                .map(f => ({
                                  value: f.key,
                                  label: f.label,
                                  icon: null,
                                })) || []
                            }
                            selectedValue={order.field || null}
                            onSelect={value => {
                              if (value) {
                                setOrderBy(prev => {
                                  const n = [...prev];
                                  n[i] = { ...n[i]!, field: value };
                                  return n;
                                });
                              }
                            }}
                            placeholder='Select field...'
                            searchPlaceholder='Search fields...'
                            showSearch={true}
                            width='100%'
                          />
                          <EntitySelector
                            options={[
                              { value: 'ASC', label: 'ASC', icon: null },
                              { value: 'DESC', label: 'DESC', icon: null },
                            ]}
                            selectedValue={order.direction || null}
                            onSelect={value => {
                              if (value) {
                                setOrderBy(prev => {
                                  const n = [...prev];
                                  n[i] = { ...n[i]!, direction: value as 'ASC' | 'DESC' };
                                  return n;
                                });
                              }
                            }}
                            placeholder='Select direction...'
                            searchPlaceholder='Search directions...'
                            showSearch={false}
                            width='auto'
                          />
                          <Button
                            variant='ghost'
                            size='icon'
                            onClick={() => setOrderBy(prev => prev.filter((_, x) => x !== i))}
                            data-track-category='ANALYTICS'
                            data-track-name='Remove_Order_By'
                          >
                            <X className='w-3 h-3' />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                {/* Error Message */}
                {errorMessage && (
                  <div className='p-4 bg-gradient-to-r from-red-50/50 to-pink-50/50 dark:from-red-900/20 dark:to-pink-900/20 border border-red-200/50 dark:border-red-800/50 rounded-lg shadow-sm backdrop-blur-sm'>
                    <p className='text-sm text-red-700 dark:text-red-300 font-medium'>
                      {errorMessage}
                    </p>
                  </div>
                )}

                {/* Filters */}
                <div className='space-y-2'>
                  <label htmlFor='filters' className='text-sm font-semibold text-foreground'>
                    Filters
                  </label>
                  <div
                    id='filters'
                    className='min-h-[200px] border border-border/30 rounded-lg p-4 bg-muted/10 backdrop-blur-sm hover:border-border/50 transition-colors shadow-sm'
                  >
                    {fields && query && (
                      <FilterRuleBuilder
                        key={editingQueryId ? `edit-${editingQueryId}` : 'create'}
                        fields={fields}
                        filters={query}
                        onChange={setQuery}
                      />
                    )}
                  </div>
                </div>
              </div>

              {/* Right Panel - Preview */}
              <div className='flex-1 min-h-0 overflow-y-auto p-6 bg-gradient-to-br from-muted/30 via-background to-muted/20 backdrop-blur-sm'>
                <div className='space-y-4'>
                  {previewLoading && (
                    <div className='flex items-center justify-center h-32 rounded-lg border border-border/30 bg-muted/20 backdrop-blur-sm'>
                      <p className='text-muted-foreground text-sm font-medium'>
                        Loading preview...
                      </p>
                    </div>
                  )}
                  {previewData && previewData.length > 0 && visualizationType && (
                    <div className='rounded-lg border border-border/30 bg-white/50 dark:bg-background/50 backdrop-blur-sm shadow-sm p-4 hover:border-border/50 transition-colors'>
                      <QueryVisualization
                        title='Preview'
                        data={previewData}
                        visualizationType={visualizationType}
                        isLoading={previewLoading}
                      />
                    </div>
                  )}
                  {previewData && previewData.length === 0 && (
                    <div className='flex items-center justify-center h-32 rounded-lg border border-border/30 bg-muted/20 backdrop-blur-sm'>
                      <p className='text-muted-foreground text-sm font-medium'>No data returned</p>
                    </div>
                  )}
                  {!previewData && !previewLoading && (
                    <div className='flex items-center justify-center h-32 rounded-lg border border-border/30 bg-gradient-to-br from-muted/30 to-muted/10 backdrop-blur-sm'>
                      <p className='text-muted-foreground text-sm font-medium'>
                        Select visualization type to see preview
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default React.memo(QueryDashboardScreen);
