import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import QueryBuilder, { type RuleGroupType } from 'react-querybuilder';
import 'react-querybuilder/dist/query-builder.css';
import { X, Plus, ChevronLeft, Save } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { useZero } from '../../hooks/useZero';
import { useCachedQuery } from '../../../src/hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { mutators } from '../../zero/mutators';
import { apiInstance } from '../../services/clients/apiClient';
import { Button } from '../../components/ui/Button';
import { useAuth } from '../../hooks/useAuth';
import Input from '../../components/ui/Input/Input';
import QueryResults from '../../components/AnalyticsDashboard/QueryResults';
import { CustomValueEditor } from '../../components/AnalyticsDashboard/CustomValueEditors';
import { FormEntityType } from '@xyne/shared';
import {
  buildFieldsConfig,
  transformQueryToLogicalFilter,
  transformLogicalFilterToQuery,
  LogicalFilter,
  FieldConfig,
} from './QueryBuilderScreen.utils';

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

// Fetch fields from backend API
async function fetchAvailableFields(entityType: string): Promise<AvailableFields> {
  const response = await apiInstance.get<{ success: boolean; data: AvailableFields }>(
    '/analytics-query/fields',
    { params: { entityType } },
  );
  if (!response.data.success) {
    throw new Error('Failed to fetch fields');
  }
  return response.data.data;
}

export const QueryBuilderScreen: React.FC = () => {
  const zero = useZero();
  const navigate = useNavigate();
  const { dashboardId } = useParams<{ dashboardId: string }>();
  const { user } = useAuth();

  const [currentDashboard] = useCachedQuery(
    queries.getDashboardById({ dashboardId: dashboardId || '' }),
  );

  // Delete query - needs useCallback (passed to child)
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

  // Edit query - needs useCallback (passed to child)
  const handleEditQuery = React.useCallback(
    (queryToEdit: { id: string; title: string; queryJson: unknown }): void => {
      const q = queryToEdit.queryJson as {
        entityType: string;
        filters?: LogicalFilter;
        select?: string[];
        orderBy?: Array<{ field: string; direction: 'ASC' | 'DESC' }>;
        limit?: number;
        offset?: number;
        aggregations?: Array<{ function: string; field: string; alias?: string }>;
        groupBy?: string[];
      };
      setEditingQueryId(queryToEdit.id);
      setQueryName(queryToEdit.title);
      setSelectedFields(q.select || []);
      setQueryMode('edit');
      setOrderBy(q.orderBy || []);
      setLimit(q.limit || 50);
      setOffset(q.offset || 0);
      setGroupBy(q.groupBy || []);
      setAggregations(
        (q.aggregations || []).map(a => ({
          function: a.function as 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX',
          field: a.field,
          ...(a.alias ? { alias: a.alias } : {}),
        })),
      );
      setSelectedEntityType(q.entityType as FormEntityType);
      setQuery(
        q.filters ? transformLogicalFilterToQuery(q.filters) : { combinator: 'and', rules: [] },
      );
    },
    [],
  );

  // Reset form state
  const resetForm = (): void => {
    setEditingQueryId(null);
    setQueryName('');
    setSelectedEntityType(FormEntityType.TICKET);
    setSelectedFields([]);
    setQuery(null);
    setFields(null);
    setErrorMessage('');
    setQueryMode('create');
    setOrderBy([]);
    setLimit(50);
    setOffset(0);
    setGroupBy([]);
    setAggregations([]);
  };

  // Save query
  const handleSaveQuery = async (): Promise<void> => {
    if (!query || !currentDashboard) return;
    if (!queryName.trim()) {
      setErrorMessage('Please enter a query name');
      return;
    }
    if (!selectedEntityType) {
      setErrorMessage('Please select an entity type');
      return;
    }
    setErrorMessage('');
    const filters = transformQueryToLogicalFilter(query);
    const queryToSave = {
      entityType: selectedEntityType,
      filters: filters.conditions.length > 0 ? filters : undefined,
      select: selectedFields.length > 0 ? selectedFields : undefined,
      orderBy: orderBy.length > 0 ? orderBy : undefined,
      limit: limit > 0 ? limit : undefined,
      offset: offset > 0 ? offset : undefined,
      aggregations: aggregations.length > 0 ? aggregations : undefined,
      groupBy: groupBy.length > 0 ? groupBy : undefined,
    };
    try {
      const response = await apiInstance.post<{ success: boolean; error?: { message: string } }>(
        '/analytics-query/validate',
        queryToSave,
      );
      if (!response.data.success) {
        setErrorMessage(response.data.error?.message || 'Query validation failed');
        return;
      }
      const queryId = editingQueryId || uuidv4();
      void zero.mutate(
        mutators.query.upsert({
          id: queryId,
          title: queryName,
          queryJson: queryToSave as unknown,
          entityType: selectedEntityType,
          dashboardId: currentDashboard.id,
          createdBy: user?.id || '',
          timestamp: Date.now(),
          mappingId: uuidv4(),
        }),
      );
      resetForm();
    } catch (error: unknown) {
      const axiosError = error as {
        response?: { data?: { error?: { message?: string } } };
        message?: string;
      };
      setErrorMessage(axiosError.response?.data?.error?.message || axiosError.message || 'Failed');
    }
  };

  // Query builder state
  const [fields, setFields] = useState<FieldConfig[] | null>(null);
  const [query, setQuery] = useState<RuleGroupType | null>(null);
  const [queryName, setQueryName] = useState('');
  const [selectedEntityType, setSelectedEntityType] = useState<FormEntityType>(
    FormEntityType.TICKET,
  );
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [queryMode, setQueryMode] = useState<'create' | 'edit'>('create');
  const [editingQueryId, setEditingQueryId] = useState<string | null>(null);
  const [orderBy, setOrderBy] = useState<Array<{ field: string; direction: 'ASC' | 'DESC' }>>([]);
  const [limit, setLimit] = useState<number>(50);
  const [offset, setOffset] = useState<number>(0);
  const [groupBy, setGroupBy] = useState<string[]>([]);
  const [aggregations, setAggregations] = useState<
    Array<{ function: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX'; field: string; alias?: string }>
  >([]);

  // Fetch fields when entity type or query mode changes
  useEffect(() => {
    // Fetch fields from backend API
    fetchAvailableFields(selectedEntityType)
      .then(availableFields => {
        // Convert to FieldOption format
        const fieldOptions = [
          ...availableFields.system.map(f => ({
            name: f.name,
            key: f.name,
            type: f.type,
            isCustom: false,
            ...(f.enumValues ? { enumValues: f.enumValues } : {}),
          })),
          ...availableFields.custom.map(f => ({
            name: f.name,
            key: `custom.${f.fieldId}`,
            type: f.type,
            isCustom: true,
            fieldId: f.fieldId,
            ...(f.enumValues ? { enumValues: f.enumValues } : {}),
          })),
        ];

        if (fieldOptions.length > 0) {
          setFields(buildFieldsConfig(fieldOptions));
        } else {
          setFields([]);
        }
      })
      .catch(() => {
        setFields([]);
      });
  }, [selectedEntityType, queryMode]);

  useEffect(() => {
    if (queryMode === 'create' && !query) {
      setQuery({ combinator: 'AND', rules: [] });
    }
  }, [queryMode, query]);

  // Early return after all hooks
  if (!currentDashboard) {
    return (
      <div className='flex items-center justify-center h-full'>
        <p className='text-muted-foreground'>Loading dashboard...</p>
      </div>
    );
  }

  return (
    <div className='flex flex-col h-full bg-background rounded-lg shadow-sm'>
      {/* Header */}
      <div className='flex items-center justify-between px-4 py-3 border-b border-border'>
        <div className='flex items-center gap-3'>
          <Button
            variant='ghost'
            size='icon'
            onClick={() => void navigate('/analytics-dashboard')}
            data-track-category='QueryBuilder'
            data-track-name='BackToDashboard'
          >
            <ChevronLeft className='w-5 h-5' />
          </Button>
          <h2 className='text-lg font-semibold text-foreground'>{currentDashboard.name}</h2>
        </div>
        <Button
          variant='ghost'
          size='icon'
          onClick={() => void navigate('/analytics-dashboard')}
          data-track-category='QueryBuilder'
          data-track-name='CloseQueryBuilder'
        >
          <X className='w-5 h-5' />
        </Button>
      </div>

      <div className='flex flex-1 overflow-hidden'>
        {/* Left side - Query Builder */}
        <div className='w-[40%] flex flex-col overflow-auto border-r border-border p-4'>
          {/* Query Name */}
          <div className='mb-4'>
            <label htmlFor='queryName' className='block text-sm font-medium text-foreground mb-1'>
              Query Name
            </label>
            <Input
              id='queryName'
              type='text'
              placeholder='Enter query name'
              value={queryName}
              onChange={e => setQueryName(e.target.value)}
            />
          </div>

          {/* Entity Type & Limit/Offset */}
          <div className='mb-4 flex gap-4 items-end'>
            <div>
              <label
                htmlFor='entityType'
                className='block text-sm font-medium text-foreground mb-1'
              >
                Entity Type
              </label>
              <select
                id='entityType'
                value={selectedEntityType}
                onChange={e => {
                  setSelectedEntityType(e.target.value as FormEntityType);
                  setErrorMessage('');
                }}
                data-track-event='change'
                data-track-category='QueryBuilder'
                data-track-name='SelectEntityType'
                className='w-40 px-3 py-2 text-sm border rounded-md'
              >
                <option value=''>Select</option>
                <option value='TICKET'>Ticket</option>
              </select>
            </div>
            <div>
              <label htmlFor='limit' className='block text-sm font-medium text-foreground mb-1'>
                Limit
              </label>
              <Input
                id='limit'
                type='number'
                min={1}
                max={10000}
                value={limit}
                onChange={e => setLimit(Number(e.target.value))}
                className='w-24'
              />
            </div>
            <div>
              <label htmlFor='offset' className='block text-sm font-medium text-foreground mb-1'>
                Offset
              </label>
              <Input
                id='offset'
                type='number'
                min={0}
                value={offset}
                onChange={e => setOffset(Number(e.target.value))}
                className='w-24'
              />
            </div>
          </div>

          {/* Order By */}
          <div className='mb-4'>
            <div className='flex items-center justify-between mb-2'>
              <span className='block text-sm font-medium text-foreground'>Order By</span>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => {
                  const f = fields?.filter(x => !x.isCustom)?.[0];
                  if (f) setOrderBy(p => [...p, { field: f.key, direction: 'ASC' }]);
                }}
                disabled={!fields || fields.filter(x => !x.isCustom).length === 0}
                data-track-category='QueryBuilder'
                data-track-name='AddOrderBy'
              >
                <Plus className='w-3 h-3' /> Add
              </Button>
            </div>
            {orderBy.map((order, i) => (
              <div key={i} className='flex items-center gap-2 mb-2'>
                <select
                  value={order.field}
                  onChange={e =>
                    setOrderBy(prev => {
                      const n = [...prev];
                      n[i] = { ...n[i]!, field: e.target.value };
                      return n;
                    })
                  }
                  data-track-event='change'
                  data-track-category='QueryBuilder'
                  data-track-name='SelectOrderByField'
                  data-track-metadata={JSON.stringify({ index: i })}
                  className='flex-1 px-2 py-1 text-sm border rounded'
                >
                  {fields
                    ?.filter(f => !f.isCustom)
                    .map(f => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                </select>
                <select
                  value={order.direction}
                  onChange={e =>
                    setOrderBy(prev => {
                      const n = [...prev];
                      n[i] = { ...n[i]!, direction: e.target.value as 'ASC' | 'DESC' };
                      return n;
                    })
                  }
                  data-track-event='change'
                  data-track-category='QueryBuilder'
                  data-track-name='SelectOrderByDirection'
                  data-track-metadata={JSON.stringify({ index: i })}
                  className='px-2 py-1 text-sm border rounded'
                >
                  <option value='ASC'>ASC</option>
                  <option value='DESC'>DESC</option>
                </select>
                <Button
                  variant='ghost'
                  size='iconSm'
                  onClick={() => setOrderBy(prev => prev.filter((_, x) => x !== i))}
                  data-track-category='QueryBuilder'
                  data-track-name='RemoveOrderBy'
                >
                  <X className='w-3 h-3' />
                </Button>
              </div>
            ))}
          </div>

          {/* Aggregations */}
          <div className='mb-4'>
            <div className='flex items-center justify-between mb-2'>
              <span className='block text-sm font-medium text-foreground'>Aggregations</span>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => {
                  const f = fields?.filter(
                    x =>
                      x.name.startsWith('custom.') ||
                      ['id', 'priority', 'eta', 'createdAt', 'updatedAt'].includes(x.name),
                  )?.[0];
                  if (f) setAggregations(p => [...p, { function: 'COUNT', field: f.name }]);
                }}
                data-track-category='QueryBuilder'
                data-track-name='AddAggregation'
                disabled={!fields || fields.length === 0}
              >
                <Plus className='w-3 h-3' /> Add
              </Button>
            </div>
            {aggregations.map((agg, i) => (
              <div key={i} className='flex items-center gap-2 mb-2'>
                <select
                  value={agg.function}
                  onChange={e =>
                    setAggregations(prev => {
                      const n = [...prev];
                      n[i] = {
                        ...n[i]!,
                        function: e.target.value as 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX',
                      };
                      return n;
                    })
                  }
                  className='px-2 py-1 text-sm border rounded'
                  data-track-category='QueryBuilder'
                  data-track-name='SelectAggregationFunction'
                >
                  <option value='COUNT'>COUNT</option>
                  <option value='SUM'>SUM</option>
                  <option value='AVG'>AVG</option>
                  <option value='MIN'>MIN</option>
                  <option value='MAX'>MAX</option>
                </select>
                <select
                  value={agg.field}
                  onChange={e =>
                    setAggregations(prev => {
                      const n = [...prev];
                      n[i] = { ...n[i]!, field: e.target.value };
                      return n;
                    })
                  }
                  className='flex-1 px-2 py-1 text-sm border rounded'
                  data-track-category='QueryBuilder'
                  data-track-name='SelectAggregationField'
                >
                  {fields?.map(f => (
                    <option key={f.name} value={f.name}>
                      {f.label}
                    </option>
                  ))}
                </select>
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
                  className='w-24 px-2 py-1 text-sm'
                />
                <Button
                  variant='ghost'
                  size='iconSm'
                  onClick={() => setAggregations(prev => prev.filter((_, x) => x !== i))}
                >
                  <X className='w-3 h-3' />
                </Button>
              </div>
            ))}
          </div>

          {/* Group By */}
          {aggregations.length > 0 && (
            <div className='mb-4'>
              <div className='flex items-center justify-between mb-2'>
                <span className='block text-sm font-medium text-foreground'>Group By</span>
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={() => {
                    const f = fields?.filter(x => !x.name.startsWith('custom.'))?.[0];
                    if (f) setGroupBy(p => [...p, f.name]);
                  }}
                  disabled={
                    !fields || fields.filter(x => !x.name.startsWith('custom.')).length === 0
                  }
                >
                  <Plus className='w-3 h-3' /> Add
                </Button>
              </div>
              {groupBy.map((field, i) => (
                <div key={i} className='flex items-center gap-2 mb-2'>
                  <select
                    value={field}
                    onChange={e =>
                      setGroupBy(prev => {
                        const n = [...prev];
                        n[i] = e.target.value;
                        return n;
                      })
                    }
                    className='flex-1 px-2 py-1 text-sm border rounded'
                    data-track-category='QueryBuilder'
                    data-track-name='SelectGroupBy'
                  >
                    {fields
                      ?.filter(f => !f.name.startsWith('custom.'))
                      .map(f => (
                        <option key={f.name} value={f.name}>
                          {f.label}
                        </option>
                      ))}
                  </select>
                  <Button
                    variant='ghost'
                    size='iconSm'
                    onClick={() => setGroupBy(prev => prev.filter((_, x) => x !== i))}
                  >
                    <X className='w-3 h-3' />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {errorMessage && (
            <div className='mb-4 p-3 bg-red-50 border border-red-200 rounded-md'>
              <p className='text-sm text-red-600'>{errorMessage}</p>
            </div>
          )}

          {/* Select Fields */}
          {fields && fields.length > 0 && (
            <div className='mb-4'>
              <span className='block text-sm font-medium text-foreground mb-1'>Select Fields</span>
              <div className='grid grid-cols-4 gap-2 p-2'>
                {fields.map(field => (
                  <label key={field.name} className='flex items-center gap-2 cursor-pointer'>
                    <input
                      type='checkbox'
                      checked={selectedFields.includes(field.name)}
                      onChange={e => {
                        if (e.target.checked) setSelectedFields(p => [...p, field.name]);
                        else setSelectedFields(p => p.filter(f => f !== field.name));
                      }}
                      className='rounded border-input'
                      data-track-category='QueryBuilder'
                      data-track-name='ToggleField'
                      data-track-metadata={JSON.stringify({ fieldName: field.name })}
                    />
                    <span className='text-sm text-foreground'>{field.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Query Builder */}
          <div className='flex-1 min-h-0 overflow-auto'>
            {fields && query ? (
              <QueryBuilder
                key={editingQueryId ? `edit-${editingQueryId}` : 'create'}
                fields={fields}
                query={query}
                onQueryChange={setQuery}
                controlElements={{ valueEditor: CustomValueEditor }}
              />
            ) : (
              <div className='flex items-center justify-center h-32 text-muted-foreground'>
                {selectedEntityType
                  ? 'Loading query builder...'
                  : 'Select an entity type to start building a query'}
              </div>
            )}
          </div>

          {/* Save/Cancel Buttons */}
          <div className='mt-4 pt-4 border-t border-border'>
            <div className='flex gap-2'>
              {editingQueryId && (
                <Button variant='secondary' className='flex-1' onClick={resetForm}>
                  Cancel
                </Button>
              )}
              <Button
                onClick={() => void handleSaveQuery()}
                disabled={!queryName.trim() || !selectedEntityType}
                className='flex-1'
                data-track-event='BUTTON_CLICK'
                data-track-category='QUERY_BUILDER'
                data-track-name='SAVE_QUERY'
                data-track-metadata={JSON.stringify({
                  entityType: selectedEntityType,
                  isEdit: !!editingQueryId,
                  queryName,
                })}
              >
                <Save className='w-4 h-4' />
                {editingQueryId ? 'Update Query' : 'Save Query'}
              </Button>
            </div>
          </div>
        </div>

        {/* Right side - Query Results */}
        <div className='flex-1 flex flex-col p-4 overflow-auto'>
          <h3 className='text-sm font-medium text-foreground mb-3'>Query Results</h3>
          <QueryResults
            dashboardData={currentDashboard}
            onDeleteQuery={handleDeleteQuery}
            onEditQuery={handleEditQuery}
          />
        </div>
      </div>
    </div>
  );
};

export default React.memo(QueryBuilderScreen);
