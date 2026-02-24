import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  TextInput,
  SingleSelect,
  MultiValueInput,
  Button,
  ButtonType,
  ButtonSize,
} from '@juspay/blend-design-system';

import { useForm, Controller, type SubmitHandler, type FieldPath } from 'react-hook-form';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiInstance } from '../../services/clients/apiClient';
import { buildTicketRequest, validateTicketRequest } from '../../components/Tickets/utils';
import { createWorkflow } from '../../services/Workflow/workflowService';
import type { WorkflowFieldSchema, WorkflowTypeSchema, WorkflowTypesAPIResponse } from './types';

interface CreateTicketProps {
  isOpen: boolean;
  onClose: () => void;
  defaultValues?: Partial<CreateTicketFormData>;
}
interface CreateTicketFormData {
  title: string;
  description: string;
  workflowType: string;
  customFields: Record<string, unknown>;
}

export default function CreateTicket({
  isOpen,
  onClose,
  defaultValues = {},
}: CreateTicketProps): React.ReactElement | null {
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowTypeSchema | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Fetch workflow types using React Query
  const {
    data: workflowTypesData,
    isLoading: workflowTypesLoading,
    error: workflowTypesError,
  } = useQuery({
    queryKey: ['workflowTypes'],
    queryFn: async (): Promise<WorkflowTypesAPIResponse> => {
      const response = await apiInstance.get<WorkflowTypesAPIResponse>('/workflows/types');
      return response.data;
    },
    staleTime: 10 * 60 * 1000, // 10 minutes cache
    enabled: isOpen, // Only fetch when modal is open
  });

  const workflowTypes = useMemo(() => {
    return workflowTypesData?.workflowTypes ?? [];
  }, [workflowTypesData]);

  const form = useForm<CreateTicketFormData>({
    defaultValues: {
      title: '',
      description: '',
      workflowType: '',
      customFields: {},
    },
  });

  const createTicketMutation = useMutation({
    mutationFn: createWorkflow,
    onSuccess: () => {
      reset();
      setSelectedWorkflow(null);
      setValidationErrors([]);
      onClose();
    },
    onError: () => {},
  });

  const { handleSubmit, control, reset } = form;

  const onSubmit: SubmitHandler<CreateTicketFormData> = data => {
    setValidationErrors([]);

    if (!data.workflowType) {
      setValidationErrors(['Please select a workflow type']);
      return;
    }

    const customFieldErrors: string[] = [];
    if (selectedWorkflow?.schema) {
      for (const field of selectedWorkflow.schema) {
        const fieldValue = data.customFields[field.name];
        const error = validateCustomField(field, fieldValue);
        if (error) {
          customFieldErrors.push(error);
        }
      }
    }

    if (customFieldErrors.length > 0) {
      setValidationErrors(customFieldErrors);
      return;
    }

    const completeFormData = {
      ...data,
      ...data.customFields,
    };
    const ticketData = buildTicketRequest(String(data.workflowType), completeFormData);

    const validation = validateTicketRequest(ticketData);
    if (!validation.isValid) {
      setValidationErrors(validation.errors);
      return;
    }

    createTicketMutation.mutate(ticketData);
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
      createTicketMutation.reset(); // Clear mutation error state
    },
    [workflowTypes, createTicketMutation],
  );

  useEffect(() => {
    if (!isOpen) return;

    reset({
      title: defaultValues?.title ?? '',
      description: defaultValues?.description ?? '',
      workflowType: defaultValues?.workflowType ?? '',
      customFields: defaultValues?.customFields ?? {},
    });

    setSelectedWorkflow(null);
    setValidationErrors([]);
  }, [isOpen, defaultValues, reset]);

  const validateCustomField = (field: WorkflowFieldSchema, value: unknown): string | null => {
    if (field.required && (value === undefined || value === null || value === '')) {
      return `${field.name} is required`;
    }

    if (value !== undefined && value !== null && value !== '') {
      switch (field.type) {
        case 'number':
          if (typeof value !== 'number' || isNaN(value)) {
            return `${field.name} must be a valid number`;
          }
          break;
        case 'boolean':
          if (typeof value !== 'boolean') {
            return `${field.name} must be true or false`;
          }
          break;
        case 'array':
          if (!Array.isArray(value)) {
            return `${field.name} must be an array`;
          }
          break;
        case 'string':
          if (typeof value !== 'string') {
            return `${field.name} must be a string`;
          }
          break;
      }
    }

    return null;
  };

  const renderField = useCallback(
    (field: WorkflowFieldSchema): React.ReactElement | null => {
      const { name, type, required } = field;

      switch (type) {
        case 'string':
        case 'number':
          return (
            <div key={name}>
              <Controller
                name={`customFields.${name}` as FieldPath<CreateTicketFormData>}
                control={control}
                rules={{ required: required ? `${name} is required` : false }}
                render={({ field: { onChange, value } }) => (
                  <TextInput
                    label={name}
                    required={required}
                    type={type === 'number' ? 'number' : 'text'}
                    value={
                      typeof value === 'string' || typeof value === 'number' ? String(value) : ''
                    }
                    placeholder={`Enter ${name}`}
                    onChange={e =>
                      onChange(type === 'number' ? Number(e.target.value) : e.target.value)
                    }
                  />
                )}
              />
            </div>
          );

        case 'boolean':
        case 'enum': {
          const options =
            type === 'boolean'
              ? [
                  { label: 'Yes', value: 'true' },
                  { label: 'No', value: 'false' },
                ]
              : (field.enumValues ?? []).map(opt => ({
                  label: opt,
                  value: opt,
                }));

          return (
            <div key={name}>
              <Controller
                name={`customFields.${name}` as FieldPath<CreateTicketFormData>}
                control={control}
                rules={{ required: required ? `${name} is required` : false }}
                render={({ field: { onChange, value } }) => (
                  <SingleSelect
                    label={name}
                    placeholder='Select an option'
                    required={required}
                    items={[{ items: options }]}
                    selected={
                      typeof value === 'string' || typeof value === 'number' ? String(value) : ''
                    }
                    onSelect={v => onChange(type === 'boolean' ? v === 'true' : v)}
                  />
                )}
              />
            </div>
          );
        }

        case 'array':
          return (
            <div key={name}>
              <Controller
                name={`customFields.${name}` as FieldPath<CreateTicketFormData>}
                control={control}
                rules={{ required: required ? `${name} is required` : false }}
                render={({ field: { onChange, value } }) => {
                  const arrayValue = Array.isArray(value) ? (value as string[]) : [];
                  return (
                    <MultiValueInput
                      label={name}
                      tags={arrayValue}
                      onTagAdd={tag => {
                        onChange([...arrayValue, tag]);
                      }}
                      onTagRemove={tag => {
                        onChange(arrayValue.filter(t => t !== tag));
                      }}
                    />
                  );
                }}
              />
            </div>
          );

        case 'object':
          return (
            <div key={name} className='space-y-2 border rounded p-3 bg-gray-50'>
              <p className='font-semibold text-sm text-gray-700'>{name}</p>
              {field.nestedFields?.map(nf => {
                const nestedFieldName = `${name}.${nf.name}`;

                return (
                  <div key={nestedFieldName}>
                    <Controller
                      name={`customFields.${nestedFieldName}` as FieldPath<CreateTicketFormData>}
                      control={control}
                      rules={{ required: nf.required ? `${nf.name} is required` : false }}
                      render={({ field: { onChange, value } }) => (
                        <TextInput
                          label={nf.name}
                          required={nf.required}
                          value={
                            typeof value === 'string' || typeof value === 'number'
                              ? String(value)
                              : ''
                          }
                          placeholder={`Enter ${nf.name}`}
                          onChange={e => onChange(e.target.value)}
                        />
                      )}
                    />
                  </div>
                );
              })}
            </div>
          );

        default:
          return null;
      }
    },
    [control],
  );

  if (!isOpen) return null;

  // Show loading state for workflow types
  if (workflowTypesLoading) {
    return (
      <div className='w-[45vw] max-w-2xl p-4 bg-white shadow rounded-lg max-h-[80vh] overflow-y-auto'>
        <div className='flex items-center justify-center h-48'>
          <div className='text-center'>
            <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4' />
            <p className='text-gray-600'>Loading workflow types...</p>
          </div>
        </div>
      </div>
    );
  }

  // Show error state for workflow types
  if (workflowTypesError) {
    return (
      <div className='w-[45vw] max-w-2xl p-4 bg-white shadow rounded-lg max-h-[80vh] overflow-y-auto'>
        <div className='flex items-center justify-center h-48'>
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
              {workflowTypesError instanceof Error ? workflowTypesError.message : 'Unknown error'}
            </p>
            <button
              onClick={onClose}
              className='px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors'
              data-track-category='Tickets'
              data-track-name='CloseErrorModal'
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className='w-[45vw] max-w-2xl p-4 bg-white shadow rounded-lg max-h-[80vh] overflow-y-auto'>
      <form onSubmit={handleFormSubmit} className='space-y-6'>
        <Controller
          name='title'
          control={control}
          rules={{ required: 'Title is required' }}
          render={({ field: { onChange, value } }) => (
            <TextInput
              label='Title'
              required
              placeholder='Enter title...'
              value={value}
              onChange={e => onChange(e.target.value)}
            />
          )}
        />

        <Controller
          name='description'
          control={control}
          rules={{ required: 'Description is required' }}
          render={({ field: { onChange, value } }) => (
            <TextInput
              label='Description'
              required
              placeholder='Enter description...'
              value={value}
              onChange={e => onChange(e.target.value)}
            />
          )}
        />

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
                  items: workflowTypes.map(wf => ({
                    label: wf.label,
                    value: wf.id,
                    subLabel: wf.description,
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

        {selectedWorkflow?.schema?.map(f => renderField(f))}

        {createTicketMutation.error && (
          <div className='p-3 bg-red-50 border border-red-200 rounded-md'>
            <p className='text-sm text-red-600 font-medium'>Error creating ticket:</p>
            <p className='text-sm text-red-600'>
              {createTicketMutation.error instanceof Error
                ? createTicketMutation.error.message
                : 'An unexpected error occurred while creating the ticket'}
            </p>
          </div>
        )}

        {validationErrors.length > 0 && (
          <div className='p-3 bg-orange-50 border border-orange-200 rounded-md'>
            <p className='text-sm text-orange-600 font-medium'>Please fix the following errors:</p>
            <ul className='text-sm text-orange-600 mt-1 list-disc list-inside'>
              {validationErrors.map((validationError, index) => (
                <li key={index}>{validationError}</li>
              ))}
            </ul>
          </div>
        )}

        <div className='flex justify-end gap-3'>
          <Button
            text='Cancel'
            buttonType={ButtonType.SECONDARY}
            onClick={onClose}
            data-track-category='Tickets'
            data-track-name='CancelCreateTicket'
          />
          <Button
            text={createTicketMutation.isPending ? 'Creating...' : 'Create Ticket'}
            buttonType={ButtonType.PRIMARY}
            size={ButtonSize.MEDIUM}
            disabled={createTicketMutation.isPending}
            type='submit'
          />
        </div>
      </form>
    </div>
  );
}
