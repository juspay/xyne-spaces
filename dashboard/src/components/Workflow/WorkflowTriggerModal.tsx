import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { SingleSelect, TextInput } from '@juspay/blend-design-system';
import { useForm, Controller, type SubmitHandler, type Path } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { createWorkflow } from '../../services/Workflow/workflowService';
import { queries } from '../../zero/queries';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useWorkflowTypes, type WorkflowType } from '../../hooks/useWorkflowTypes';
import type { WorkflowTypeSchema } from '../Tickets/types';
import { Play, X } from 'lucide-react';
import {
  validateCustomField,
  updateFormWithTicketData,
  type TriggerWorkflowFormData,
  type TicketData,
} from './utils';

interface WorkflowTriggerModalProps {
  isOpen: boolean;
  onClose: () => void;
  ticketId: string;
}

export default function WorkflowTriggerModal({
  isOpen,
  onClose,
  ticketId,
}: WorkflowTriggerModalProps): React.ReactElement | null {
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowTypeSchema | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Fetch ticket data using Zero query
  const ticketDataResult = useCachedQuery(queries.ticketById({ ticketId }));
  const ticketData = ticketDataResult[0]; // Zero queries return arrays

  // Fetch workflow types using optimized hook
  const {
    workflowTypes,
    isLoading: workflowTypesLoading,
    error: workflowTypesError,
  } = useWorkflowTypes();

  const form = useForm<TriggerWorkflowFormData>({
    defaultValues: {
      workflowType: '',
      context: '',
      customFields: {},
    },
    mode: 'onChange',
  });

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
        ticketId,
        conversationId: ticketData?.conversationId || '', // Use conversationId from ticket data
        xyneId: ticketData?.xyneId || ticketId, // Include xyneId in the request
        ...filteredCustomFields,
      };

      return createWorkflow(workflowRequest);
    },
    onSuccess: () => {
      form.reset();
      setSelectedWorkflow(null);
      setValidationErrors([]);
      onClose();
    },
    onError: error => {
      const errorMessage = error instanceof Error ? error.message : 'Failed to trigger workflow';
      setValidationErrors([`Error: ${errorMessage}`]);
    },
  });

  const { handleSubmit, control, watch, setValue, formState } = form;
  const workflowType = watch('workflowType');
  const customFields = watch('customFields');

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
  const handleClose = (): void => {
    // Explicitly reset form to initial values to prevent stale workflow selection
    form.reset({
      workflowType: '',
      context: '',
      customFields: {},
    });
    setSelectedWorkflow(null);
    setValidationErrors([]);
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
    }
  }, [isOpen]);

  const renderFormFields = () => {
    if (!selectedWorkflow?.schema) return null;

    return (
      <div className='space-y-4 mt-4 border-t pt-4 border-gray-200'>
        <h3 className='text-sm font-medium text-gray-700'>Required Parameters</h3>
        {selectedWorkflow.schema.map(field => (
          <Controller
            key={field.name}
            name={`customFields.${field.name}` as Path<TriggerWorkflowFormData>}
            control={control}
            rules={{
              validate: value => {
                if (!field.required) return true;
                if (value === '' || value === null || value === undefined) {
                  return `${field.name} is required`;
                }
                if (typeof value === 'string' && value.trim() === '') {
                  return `${field.name} cannot be empty`;
                }
                return true;
              },
            }}
            render={({ field: controllerField }) => (
              <div className='space-y-1'>
                <label className='block text-sm font-medium text-gray-700'>
                  {field.name}
                  {field.required && <span className='text-red-500 ml-1'>*</span>}
                  {field.description && (
                    <span className='text-xs text-gray-500 block mt-1'>{field.description}</span>
                  )}
                </label>

                <input
                  type={field.type === 'number' ? 'number' : 'text'}
                  className='w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
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
                            e.target.value === ''
                              ? ''
                              : isNaN(numValue)
                                ? e.target.value
                                : numValue;
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
                            : `Enter ${field.name}`
                  }
                />
              </div>
            )}
          />
        ))}
      </div>
    );
  };

  if (!isOpen) return null;

  // Show loading state for workflow types
  if (workflowTypesLoading) {
    return (
      <div className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50'>
        <div className='bg-white rounded-lg p-6 max-w-md w-full mx-4'>
          <div className='flex items-center justify-center h-32'>
            <div className='text-center'>
              <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4' />
              <p className='text-gray-600'>Loading workflow types...</p>
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
        <div className='bg-white rounded-lg p-6 max-w-md w-full mx-4'>
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
              <h3 className='text-lg font-medium text-gray-900 mb-2'>
                Failed to load workflow types
              </h3>
              <p className='text-gray-600 mb-4'>
                {typeof workflowTypesError === 'string' ? workflowTypesError : 'Unknown error'}
              </p>
              <button
                onClick={handleClose}
                className='px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors'
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
      <div className='bg-white rounded-lg p-6 max-w-md w-full mx-4 max-h-[80vh] overflow-y-auto'>
        <div className='flex items-center justify-between mb-4'>
          <div className='flex items-center gap-2'>
            <Play className='w-5 h-5 text-blue-600' />
            <h2 className='text-lg font-semibold text-gray-900'>Trigger Workflow</h2>
          </div>
          <button
            onClick={handleClose}
            className='p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors'
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleFormSubmit} className='space-y-4'>
          <div className='text-sm text-gray-600 mb-2'>
            Ticket ID: <span className='font-mono bg-gray-100 px-2 py-1 rounded'>{ticketId}</span>
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

          <Controller
            name='context'
            control={control}
            render={({ field: { onChange, value } }) => (
              <TextInput
                label='Context (Optional)'
                placeholder='Additional context for the workflow...'
                value={value}
                onChange={e => onChange(e.target.value)}
              />
            )}
          />

          {renderFormFields()}

          {validationErrors.length > 0 && (
            <div className='p-3 bg-orange-50 border border-orange-200 rounded-md'>
              <p className='text-sm text-orange-600 font-medium'>
                Please fix the following errors:
              </p>
              <ul className='text-sm text-orange-600 mt-1 list-disc list-inside'>
                {validationErrors.map((validationError, index) => (
                  <li key={index}>{validationError}</li>
                ))}
              </ul>
            </div>
          )}

          {createWorkflowMutation.isPending && (
            <div className='p-3 bg-blue-50 border border-blue-200 rounded-md'>
              <div className='flex items-center gap-2'>
                <div className='animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600' />
                <p className='text-sm text-blue-600 font-medium'>Triggering workflow...</p>
              </div>
            </div>
          )}

          {createWorkflowMutation.isError && (
            <div className='p-3 bg-red-50 border border-red-200 rounded-md'>
              <p className='text-sm text-red-600 font-medium'>Error triggering workflow:</p>
              <p className='text-sm text-red-600'>
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
            >
              {createWorkflowMutation.isPending ? 'Please wait...' : 'Close'}
            </Button>
            <Button
              type='submit'
              disabled={createWorkflowMutation.isPending || !selectedWorkflow || !formState.isValid}
            >
              {createWorkflowMutation.isPending ? 'Please wait...' : 'Trigger Workflow'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
