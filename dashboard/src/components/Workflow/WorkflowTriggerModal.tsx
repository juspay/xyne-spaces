import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/Button';
import { MultiSelect } from '../ui/MultiSelect';
import { SelectMenuAlignment, SingleSelect } from '@juspay/blend-design-system';
import { useForm, Controller, type SubmitHandler, type Path } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { createWorkflow } from '../../services/Workflow/workflowService';
import { queries } from '../../zero/queries';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useWorkflowTypes, type WorkflowType } from '../../hooks/useWorkflowTypes';
import { useWorkflowFormPersistence } from '../../hooks/useWorkflowFormPersistence';
import { useAuth } from '../../hooks/useAuth';
import type { WorkflowTypeSchema } from '../Tickets/types';
import { Play, X, ExternalLink } from 'lucide-react';
import {
  validateCustomField,
  updateFormWithTicketData,
  type TriggerWorkflowFormData,
  type TicketData,
} from './utils';
import { ArrayObjectField } from '../ui/ArrayObjectField';
import { RA_URL } from '../Workflows/constants';
import { browserPanelActor } from '../../machines/browserPanelMachine';
import { isElectronApp } from '../../utils/electronApp';

interface WorkflowTriggerModalProps {
  isOpen: boolean;
  onClose: () => void;
  ticketId: string;
  redirectOnSuccess?: boolean;
  isRerun?: boolean;
  defaultWorkflowType?: string;
  defaultCustomFields?: Record<string, unknown>;
}

export default function WorkflowTriggerModal({
  isOpen,
  onClose,
  ticketId,
  redirectOnSuccess = false,
  isRerun = false,
  defaultWorkflowType,
  defaultCustomFields,
}: WorkflowTriggerModalProps): React.ReactElement | null {
  const navigate = useNavigate();
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowTypeSchema | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [showOptionalFields, setShowOptionalFields] = useState(false);

  // Fetch ticket data using Zero query
  const ticketDataResult = useCachedQuery(queries.ticketByIdV2({ ticketId }));
  const ticketData = ticketDataResult[0]; // Zero queries return arrays

  // Fetch workflow types using optimized hook
  const {
    workflowTypes,
    isLoading: workflowTypesLoading,
    error: workflowTypesError,
  } = useWorkflowTypes();

  const { user } = useAuth();

  const form = useForm<TriggerWorkflowFormData>({
    defaultValues: {
      workflowType: '',
      context: '',
      customFields: {},
    },
    mode: 'onChange',
  });

  const { handleSubmit, control, watch, setValue, formState } = form;
  const workflowType = watch('workflowType');
  const customFields = watch('customFields');

  // Use persistence hook to save/restore form values - must be defined before mutation
  const {
    savedValues,
    save: saveFormValues,
    clear: clearSavedValues,
  } = useWorkflowFormPersistence(workflowType);

  const hasSavedRepositoryUrl = !!savedValues?.customFields?.['repositoryUrl'];

  // Track which fields have persisted values from localStorage
  const [persistedFields, setPersistedFields] = useState<Set<string>>(new Set());

  // Helper function to check if a field has a persisted value
  const isFieldPersisted = useCallback(
    (fieldName: string): boolean => {
      return persistedFields.has(fieldName);
    },
    [persistedFields],
  );

  const createWorkflowMutation = useMutation({
    mutationFn: (data: TriggerWorkflowFormData) => {
      // Filter out empty values from customFields
      const filteredCustomFields = Object.fromEntries(
        Object.entries(data.customFields).filter(
          ([key, value]) =>
            !['title', 'description'].includes(key) &&
            value !== '' &&
            value !== null &&
            value !== undefined,
        ),
      );

      const workflowRequest = {
        title:
          (data.customFields['title'] as string) ||
          ticketData?.title ||
          `Workflow for Ticket ${ticketId}`,
        description: (data.customFields['description'] as string) || ticketData?.description || '',
        workflowType: data.workflowType,
        executorType: (data.customFields['executorType'] as string) || 'xyne-code',
        ticketId,
        conversationId: ticketData?.conversationId || '', // Use conversationId from ticket data
        xyneId: ticketData?.xyneId || ticketId, // Include xyneId in the request
        ...filteredCustomFields,
      };

      return createWorkflow(workflowRequest);
    },
    onSuccess: (response, variables) => {
      const repositoryUrl = variables.customFields['repositoryUrl'];
      if (repositoryUrl !== undefined && repositoryUrl !== null && repositoryUrl !== '') {
        saveFormValues({
          customFields: { repositoryUrl },
          context: '',
        });
      } else {
        clearSavedValues();
      }

      form.reset();
      setSelectedWorkflow(null);
      setValidationErrors([]);
      onClose();
      if (redirectOnSuccess) {
        void navigate(`/tickets/${ticketId}/workflow/${response.workflow.id}`);
      }
    },
    onError: error => {
      const errorMessage = error instanceof Error ? error.message : 'Failed to trigger workflow';
      setValidationErrors([`Error: ${errorMessage}`]);
    },
  });

  const onSubmit: SubmitHandler<TriggerWorkflowFormData> = data => {
    setValidationErrors([]);

    if (!data.workflowType) {
      setValidationErrors(['Please select a workflow type']);
      return;
    }

    // Only validate if we have a selected workflow with schema
    if (selectedWorkflow?.schema) {
      const customFieldErrors: string[] = [];
      for (const field of selectedWorkflow.schema) {
        const fieldValue = data.customFields[field.name];
        const error = validateCustomField(field, fieldValue);
        if (error) {
          customFieldErrors.push(error);
        }
      }
      if (customFieldErrors.length > 0) {
        setValidationErrors(customFieldErrors);
        return;
      }
    }

    createWorkflowMutation.mutate(data);
  };

  const handleFormSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    void handleSubmit(onSubmit)(e);
  };

  const handleWorkflowSelect = useCallback(
    (workflowId: string): void => {
      const wf = workflowTypes.find(w => w.id === workflowId) || null;
      setSelectedWorkflow(wf);
      setValidationErrors([]);
      setShowOptionalFields(false);

      // Reset form values
      form.reset({
        workflowType: workflowId,
        context: '',
        customFields: {},
      });

      // Auto-fill fields with ticket data if schema is available
      if (wf?.schema && ticketData) {
        const ticketDataForUtils: TicketData = {
          id: ticketData.id,
          title: ticketData.title,
          description: ticketData.description,
          createdBy: ticketData.createdBy,
          assignedTo: ticketData.assignedTo || '',
          conversationId: ticketData.conversationId,
        };

        // Use utility function to get pre-filled data
        updateFormWithTicketData(
          (name: string, value: unknown) => {
            if (name.startsWith('customFields.')) {
              const fieldName = name.replace('customFields.', '');
              const field = wf.schema?.find(f => f.name === fieldName);

              // Only set value if it's valid for the field type
              if (field) {
                setValue(`customFields.${fieldName}` as Path<TriggerWorkflowFormData>, value);
              }
            } else if (name === 'context') {
              setValue('context', value as string);
            }
          },
          ticketDataForUtils,
          wf,
        );
      }
    },
    [workflowTypes, ticketData, form, setValue],
  );

  // Auto-populate versionBumpUserEmail when Version Bump workflow is selected
  useEffect(() => {
    if (user?.email && !customFields['versionBumpUserEmail']) {
      setValue('customFields.versionBumpUserEmail' as Path<TriggerWorkflowFormData>, user.email);
    }
  }, [user?.email, workflowType, setValue, customFields]);

  useEffect(() => {
    if (isRerun) return;
    if (savedValues && selectedWorkflow?.schema) {
      const persistedFieldNames = new Set<string>();
      const repositoryUrl = savedValues.customFields['repositoryUrl'];
      const fieldExists = selectedWorkflow.schema.some(f => f.name === 'repositoryUrl');
      if (
        fieldExists &&
        repositoryUrl !== undefined &&
        repositoryUrl !== null &&
        repositoryUrl !== ''
      ) {
        setValue('customFields.repositoryUrl' as Path<TriggerWorkflowFormData>, repositoryUrl);
        persistedFieldNames.add('repositoryUrl');
      }
      setPersistedFields(persistedFieldNames);
    }
  }, [isRerun, savedValues, selectedWorkflow, setValue]);

  useEffect(() => {
    if (!isRerun || !defaultCustomFields) return;

    const fieldsToPreFill = { ...defaultCustomFields };

    for (const [fieldName, fieldValue] of Object.entries(fieldsToPreFill)) {
      const fieldExists = selectedWorkflow?.schema?.some(f => f.name === fieldName);
      if (
        (fieldExists || fieldName === 'title' || fieldName === 'description') &&
        fieldValue !== undefined &&
        fieldValue !== null &&
        fieldValue !== ''
      ) {
        setValue(`customFields.${fieldName}` as Path<TriggerWorkflowFormData>, fieldValue);
      }
    }
  }, [isRerun, selectedWorkflow, defaultCustomFields, setValue]);

  const handleClose = (): void => {
    // Explicitly reset form to initial values to prevent stale workflow selection
    form.reset({
      workflowType: '',
      context: '',
      customFields: {},
    });
    setSelectedWorkflow(null);
    setValidationErrors([]);
    setShowOptionalFields(false);
    createWorkflowMutation.reset();
    onClose();
  };

  // Reset validation errors when workflow type changes
  useEffect(() => {
    if (!selectedWorkflow && selectedWorkflow !== null) {
      setValidationErrors([]);
      createWorkflowMutation.reset(); // Also reset backend mutation state
    }
  }, [selectedWorkflow]);

  // Clear validation errors when any form field changes
  useEffect(() => {
    if (validationErrors.length > 0) {
      setValidationErrors([]);
    }
  }, [workflowType, customFields]);

  // Clear error messages when user starts interacting with the form
  useEffect(() => {
    if (createWorkflowMutation.isError && !createWorkflowMutation.isPending) {
      createWorkflowMutation.reset();
    }
  }, [createWorkflowMutation.isPending, createWorkflowMutation.isError]);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      form.reset({
        workflowType: '',
        context: '',
        customFields: {},
      });
      setSelectedWorkflow(null);
      setValidationErrors([]);
      createWorkflowMutation.reset();

      if (isRerun && defaultWorkflowType && workflowTypes.length > 0) {
        handleWorkflowSelect(defaultWorkflowType);
      }
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && isRerun && defaultWorkflowType && workflowTypes.length > 0 && !selectedWorkflow) {
      handleWorkflowSelect(defaultWorkflowType);
    }
  }, [isOpen, isRerun, defaultWorkflowType, workflowTypes, selectedWorkflow]);

  const renderFormFields = () => {
    if (!selectedWorkflow?.schema) return null;

    // Fields to show immediately: required fields OR fields with saved values
    const visibleFields = selectedWorkflow.schema.filter(
      field => field.required || isFieldPersisted(field.name),
    );

    // Fields to hide in "Show more": optional fields without saved values
    const hiddenFields = selectedWorkflow.schema.filter(
      field => !field.required && !isFieldPersisted(field.name),
    );

    const rerunFields: React.ReactElement[] = [];
    if (isRerun && defaultCustomFields) {
      ['title', 'description'].forEach(fieldName => {
        const hasValue = !!defaultCustomFields[fieldName];
        const inSchema = selectedWorkflow.schema?.some(f => f.name === fieldName);

        if (hasValue && !inSchema) {
          rerunFields.push(
            renderField({
              name: fieldName,
              type: 'string',
              required: fieldName === 'title',
              description: `Workflow ${fieldName}`,
            }),
          );
        }
      });
    }

    if (visibleFields.length === 0 && rerunFields.length === 0 && hiddenFields.length === 0)
      return null;

    return (
      <div className='space-y-4 mt-4 border-t pt-4 border-border'>
        {(visibleFields.length > 0 || rerunFields.length > 0) && (
          <>
            <h3 className='text-sm font-medium text-foreground'>
              {isRerun ? 'Workflow Parameters' : 'Required Parameters'}
              {hasSavedRepositoryUrl && !isRerun && (
                <span className='text-xs text-muted-foreground font-normal ml-2'>
                  (includes saved values)
                </span>
              )}
            </h3>
            {rerunFields}
            {visibleFields.map(field => renderField(field))}
          </>
        )}

        {hiddenFields.length > 0 && (
          <>
            {!showOptionalFields ? (
              <Button type='button' variant='secondary' onClick={() => setShowOptionalFields(true)}>
                Show more fields ({hiddenFields.length})
              </Button>
            ) : (
              <>
                <h3 className='text-sm font-medium text-foreground mt-6'>Optional Parameters</h3>
                {hiddenFields.map(field => renderField(field))}
                <Button
                  type='button'
                  variant='secondary'
                  size='sm'
                  onClick={() => setShowOptionalFields(false)}
                  className='mt-4'
                  data-track-category='Workflows'
                  data-track-name='HideOptionalFields'
                >
                  Hide fields
                </Button>
              </>
            )}
          </>
        )}
      </div>
    );
  };

  const renderField = (field: WorkflowTypeSchema['schema'][0]) => {
    return (
      <Controller
        key={field.name}
        name={`customFields.${field.name}` as Path<TriggerWorkflowFormData>}
        control={control}
        rules={{
          validate: value => {
            if (!field.required) return true;

            // Validate each item for Array Object fields (item-level integrity)
            if (field.type === 'arrayOfObjects' && field.nestedFields) {
              if (Array.isArray(value)) {
                const isValid = value.every(item => {
                  const typedItem = item as Record<string, unknown>;
                  return field.nestedFields?.every(
                    nf =>
                      !nf.required ||
                      (typedItem[nf.name] !== undefined &&
                        typedItem[nf.name] !== null &&
                        typedItem[nf.name] !== ''),
                  );
                });
                if (!isValid)
                  return `All mandatory fields in each object of ${field.name} must be filled`;
              }
              return true;
            }

            if (value === '' || value === null || value === undefined) {
              return `${field.name} is required`;
            }
            if (typeof value === 'string' && value.trim() === '') {
              return `${field.name} cannot be empty`;
            }
            return true;
          },
        }}
        render={({ field: controllerField, fieldState }) => (
          <div className='space-y-1'>
            <div className='flex items-center justify-between'>
              <label className='block text-sm font-medium text-foreground'>
                {field.name}
                {field.required && <span className='text-red-500 ml-1'>*</span>}
              </label>
              {field.labelActions && field.labelActions.length > 0 && (
                <div className='flex items-center gap-2'>
                  {field.labelActions.map((action, index) => (
                    <button
                      key={index}
                      type='button'
                      onClick={() => {
                        if (isElectronApp()) {
                          const browserPanelState =
                            browserPanelActor.getSnapshot().context.browserPanelState;
                          if (browserPanelState === 'open') {
                            browserPanelActor.send({ type: 'OPEN_URLS', urls: [RA_URL] });
                          } else {
                            browserPanelActor.send({ type: 'OPEN', urls: [RA_URL] });
                          }
                        } else {
                          window.open(RA_URL, '_blank');
                        }
                      }}
                      className='inline-flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600 transition-colors'
                      data-track-category='Workflows'
                      data-track-name='PlanFromRA'
                    >
                      {action.icon === 'ExternalLink' && <ExternalLink size={12} />}
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Render enum fields as select dropdowns */}
            {field.enumValues && field.enumValues.length > 0 ? (
              field.type === 'array' ? (
                <MultiSelect
                  placeholder={`Select ${field.name}`}
                  options={field.enumValues.map(enumValue => ({
                    label: enumValue,
                    value: enumValue,
                  }))}
                  selectedValues={
                    (controllerField.value as string[]) || (field.defaultValue as string[]) || []
                  }
                  onChange={controllerField.onChange}
                />
              ) : (
                <SingleSelect
                  placeholder={`Select ${field.name}`}
                  items={[
                    {
                      items: field.enumValues.map(enumValue => ({
                        label: enumValue,
                        value: enumValue,
                      })),
                    },
                  ]}
                  selected={
                    (controllerField.value as string) || (field.defaultValue as string) || ''
                  }
                  onSelect={controllerField.onChange}
                  alignment={SelectMenuAlignment.START}
                />
              )
            ) : field.type === 'arrayOfObjects' ? (
              <ArrayObjectField
                field={field}
                value={Array.isArray(controllerField.value) ? controllerField.value : []}
                onChange={controllerField.onChange}
                error={fieldState.error?.message}
              />
            ) : field.type === 'string' || (!field.type && !field.enumValues) ? (
              <textarea
                className='w-full px-3 py-2 bg-background text-foreground border border-input rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y min-h-[80px] text-sm placeholder:text-muted-foreground'
                data-track-category='Workflows'
                data-track-name='WorkflowParameterInput'
                data-track-metadata={JSON.stringify({
                  fieldName: field.name,
                  fieldType: field.type,
                })}
                value={
                  typeof controllerField.value === 'string'
                    ? controllerField.value
                    : typeof controllerField.value === 'number'
                      ? String(controllerField.value)
                      : ''
                }
                onChange={e => controllerField.onChange(e.target.value)}
                placeholder={field.description || `Enter ${field.name}`}
                rows={field.name === 'description' || field.name === 'instructions' ? 4 : 2}
              />
            ) : (
              <input
                type={field.type === 'number' ? 'number' : 'text'}
                className='w-full px-3 py-2 bg-background text-foreground border border-input rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-muted-foreground'
                data-track-category='Workflows'
                data-track-name='WorkflowParameterInput'
                data-track-metadata={JSON.stringify({
                  fieldName: field.name,
                  fieldType: field.type,
                })}
                value={
                  field.type === 'number'
                    ? typeof controllerField.value === 'number'
                      ? controllerField.value
                      : ''
                    : field.type === 'boolean'
                      ? typeof controllerField.value === 'boolean'
                        ? String(controllerField.value)
                        : typeof controllerField.value === 'string'
                          ? controllerField.value
                          : ''
                      : field.type === 'object' || field.type === 'array'
                        ? typeof controllerField.value === 'object' &&
                          controllerField.value !== null
                          ? JSON.stringify(controllerField.value)
                          : typeof controllerField.value === 'string'
                            ? controllerField.value
                            : ''
                        : typeof controllerField.value === 'string'
                          ? controllerField.value
                          : typeof controllerField.value === 'number'
                            ? String(controllerField.value)
                            : ''
                }
                onChange={e => {
                  let processedValue: unknown = e.target.value;

                  // Convert string to appropriate type based on field type
                  if (typeof e.target.value === 'string') {
                    switch (field.type) {
                      case 'number': {
                        const numValue = Number(e.target.value);
                        processedValue =
                          e.target.value === '' ? '' : isNaN(numValue) ? e.target.value : numValue;
                        break;
                      }
                      case 'boolean':
                        processedValue =
                          e.target.value === 'true'
                            ? true
                            : e.target.value === 'false'
                              ? false
                              : e.target.value;
                        break;
                      case 'object':
                      case 'array':
                        if (e.target.value === '') {
                          processedValue = '';
                        } else {
                          try {
                            processedValue = JSON.parse(e.target.value);
                          } catch {
                            processedValue = e.target.value;
                          }
                        }
                        break;
                    }
                  }

                  controllerField.onChange(processedValue);
                }}
                placeholder={
                  field.type === 'object'
                    ? 'Enter JSON object (e.g., {"key": "value"})'
                    : field.type === 'array'
                      ? 'Enter JSON array (e.g., ["item1", "item2"])'
                      : field.type === 'number'
                        ? 'Enter a number'
                        : field.type === 'boolean'
                          ? 'Enter true or false'
                          : field.description || `Enter ${field.name}`
                }
              />
            )}
          </div>
        )}
      />
    );
  };

  if (!isOpen) return null;

  // Show loading state for workflow types
  if (workflowTypesLoading) {
    return (
      <div className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50'>
        <div className='bg-background rounded-lg p-6 max-w-md w-full mx-4'>
          <div className='flex items-center justify-center h-32'>
            <div className='text-center'>
              <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 dark:border-blue-400 mx-auto mb-4' />
              <p className='text-muted-foreground'>Loading workflow types...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Show error state for workflow types
  if (workflowTypesError) {
    return (
      <div className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50'>
        <div className='bg-background rounded-lg p-6 max-w-md w-full mx-4'>
          <div className='flex items-center justify-center h-32'>
            <div className='text-center'>
              <div className='mx-auto mb-4 w-12 h-12 text-red-500'>
                <svg fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                  />
                </svg>
              </div>
              <h3 className='text-lg font-medium text-foreground mb-2'>
                Failed to load workflow types
              </h3>
              <p className='text-muted-foreground mb-4'>
                {typeof workflowTypesError === 'string' ? workflowTypesError : 'Unknown error'}
              </p>
              <button
                onClick={handleClose}
                className='px-4 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80 transition-colors border border-border'
                data-track-category='Workflows'
                data-track-name='CloseErrorModal'
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50'>
      <div className='bg-background rounded-lg p-6 max-w-md w-full mx-4 max-h-[80vh] overflow-y-auto'>
        <div className='flex items-center justify-between mb-4'>
          <div className='flex items-center gap-2'>
            <Play className='w-5 h-5 text-blue-600' />
            <h2 className='text-lg font-semibold text-foreground'>
              {isRerun ? 'Rerun Workflow' : 'Trigger Workflow'}
            </h2>
          </div>
          <button
            onClick={handleClose}
            className='p-1 rounded-md text-muted-foreground hover:text-muted-foreground hover:bg-muted transition-colors'
            data-track-category='Workflows'
            data-track-name='CloseWorkflowTriggerModal'
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleFormSubmit} className='space-y-4'>
          <div className='text-sm text-muted-foreground mb-2'>
            Ticket ID: <span className='font-mono bg-muted px-2 py-1 rounded'>{ticketId}</span>
          </div>

          <Controller
            name='workflowType'
            control={control}
            rules={{ required: 'Workflow type is required' }}
            render={({ field: { onChange, value } }) => (
              <SingleSelect
                label='Workflow Type'
                placeholder='Select a workflow type'
                required
                items={[
                  {
                    items: workflowTypes.map((wf: WorkflowType) => ({
                      label: wf.label,
                      value: wf.id,
                    })),
                  },
                ]}
                selected={value}
                onSelect={workflowId => {
                  onChange(workflowId);
                  handleWorkflowSelect(workflowId);
                }}
              />
            )}
          />

          {renderFormFields()}

          {validationErrors.length > 0 && (
            <div className='p-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-md'>
              <p className='text-sm text-orange-600 dark:text-orange-400 font-medium'>
                Please fix the following errors:
              </p>
              <ul className='text-sm text-orange-600 dark:text-orange-400 mt-1 list-disc list-inside'>
                {validationErrors.map((validationError, index) => (
                  <li key={index}>{validationError}</li>
                ))}
              </ul>
            </div>
          )}

          {createWorkflowMutation.isPending && (
            <div className='p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md'>
              <div className='flex items-center gap-2'>
                <div className='animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 dark:border-blue-400' />
                <p className='text-sm text-blue-600 dark:text-blue-400 font-medium'>
                  Triggering workflow...
                </p>
              </div>
            </div>
          )}

          {createWorkflowMutation.isError && (
            <div className='p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md'>
              <p className='text-sm text-red-600 dark:text-red-400 font-medium'>
                Error triggering workflow:
              </p>
              <p className='text-sm text-red-600 dark:text-red-400'>
                {createWorkflowMutation.error instanceof Error
                  ? createWorkflowMutation.error.message
                  : 'An unexpected error occurred while triggering the workflow'}
              </p>
            </div>
          )}

          <div className='flex justify-end gap-3 pt-4'>
            <Button
              variant='secondary'
              onClick={handleClose}
              disabled={createWorkflowMutation.isPending}
              data-track-category='Workflows'
              data-track-name='CloseWorkflowTriggerModalForm'
            >
              {createWorkflowMutation.isPending ? 'Please wait...' : 'Close'}
            </Button>
            <Button
              type='submit'
              disabled={createWorkflowMutation.isPending || !selectedWorkflow || !formState.isValid}
            >
              {createWorkflowMutation.isPending
                ? 'Please wait...'
                : isRerun
                  ? 'Rerun Workflow'
                  : 'Trigger Workflow'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
