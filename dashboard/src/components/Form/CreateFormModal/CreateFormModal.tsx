import { ReactElement, useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { useZero } from '../../../hooks/useZero';
import { Plus, Trash2, Edit2, X } from 'lucide-react';
import { Form, FormContextType, FormEntityType, FormFieldType, FormFields } from '@xyne/shared';
import { Dialog } from '../../ui/Dialog/Dialog';
import { Button } from '../../ui/Button/Button';
import Input from '../../ui/Input/Input';
import Textarea from '../../ui/Textarea/Textarea';
import {
  formService,
  type CreateFormRequest,
  type CreateFormResponse,
} from '../../../services/Form/formService';
import { mutators } from '../../../zero/mutators';
import { queries } from '../../../zero/queries';
import { FORM_CONTEXT_TYPES, getEntityTypesForContext } from '../../../constants/formConstants';
import { toast } from 'sonner';
import { Checkbox } from '@juspay/blend-design-system';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { v4 as uuidv4 } from 'uuid';

interface FormField {
  id?: string; // Existing field ID for updates
  fieldName: string;
  fieldType: FormFieldType;
  fieldEnum?: string[]; // Array of options for SELECT fields
  isOptional?: boolean | null; // Whether the field is optional
}

interface CreateFormFormData {
  formName: string;
  formDescription: string;
  contextType: FormContextType;
  entityType: FormEntityType;
}

interface CreateFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form?: Form;
  onSuccess?: (formId: string) => void;
}

export const CreateFormModal = ({
  open,
  onOpenChange,
  form,
  onSuccess,
}: CreateFormModalProps): ReactElement => {
  const zero = useZero();
  const [fields, setFields] = useState<FormField[]>([]);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Set<number>>(new Set());
  const isEditMode = !!form;

  // Query form fields if in edit mode
  const [formFields] = useCachedQuery(
    form
      ? queries.getFormFieldsByFormId({ formId: form.id })
      : queries.getFormFieldsByFormId({ formId: '' }),
    { enabled: isEditMode && !!form },
  );

  const {
    control,
    handleSubmit: handleFormSubmit,
    watch,
    reset,
  } = useForm<CreateFormFormData>({
    defaultValues: {
      formName: '',
      formDescription: '',
      contextType: FormContextType.BOARD,
      entityType: FormEntityType.TICKET,
    },
    mode: 'onChange',
  });

  const selectedContextType = watch('contextType');

  // Initialize form data when opening in edit mode
  useEffect(() => {
    if (open && form) {
      setIsReadOnly(true); // Start in view mode
      setFieldErrors(new Set()); // Reset errors
      reset({
        formName: form.formName,
        formDescription: form.formDescription || '',
        contextType: form.contextType,
        entityType: form.entityType,
      });

      // Set fields from query result
      if (formFields) {
        setFields(
          formFields.map((field: FormFields) => {
            const baseField: FormField = {
              id: field.id,
              fieldName: field.fieldName,
              fieldType: field.fieldType,
              isOptional: field.isOptional,
            };
            // Only add fieldEnum if it exists and is a non-empty array
            if (field.fieldEnum && Array.isArray(field.fieldEnum) && field.fieldEnum.length > 0) {
              return { ...baseField, fieldEnum: field.fieldEnum as string[] };
            }
            return baseField;
          }),
        );
      }
    } else if (open && !form) {
      // Reset for create mode
      setIsReadOnly(false);
      setFieldErrors(new Set()); // Reset errors
      reset({
        formName: '',
        formDescription: '',
        contextType: FormContextType.BOARD,
        entityType: FormEntityType.TICKET,
      });
      setFields([]);
    }
  }, [open, form, reset, formFields]);

  const createFormMutation = useMutation<CreateFormResponse, Error, CreateFormRequest>({
    mutationFn: async (data: CreateFormRequest) => {
      return formService.createForm(data);
    },
    onSuccess: data => {
      reset();
      setFields([]);
      onOpenChange(false);
      if (onSuccess && data.id) {
        onSuccess(data.id);
      }
    },
  });

  const handleEditClick = (): void => {
    setIsReadOnly(false);
  };

  const addField = (): void => {
    const updatedFields = [...fields, { fieldName: '', fieldType: FormFieldType.STRING }];
    setFields(updatedFields);
    checkForDuplicates(updatedFields);
  };

  const removeField = (index: number): void => {
    const updatedFields = fields.filter((_, i) => i !== index);
    setFields(updatedFields);
    checkForDuplicates(updatedFields);
  };

  const hasDuplicateFieldNames = (): boolean => {
    const fieldNames = fields.map(f => f.fieldName.trim().toLowerCase());
    const uniqueNames = new Set(fieldNames);
    return fieldNames.length !== uniqueNames.size;
  };

  const checkForDuplicates = (currentFields: FormField[]): void => {
    const errorIndices = new Set<number>();

    for (let i = 0; i < currentFields.length; i++) {
      const fieldI = currentFields[i];
      if (!fieldI?.fieldName) continue;
      const fieldName = fieldI.fieldName.trim().toLowerCase();
      if (!fieldName) continue;

      // Check if this name appears elsewhere
      for (let j = 0; j < currentFields.length; j++) {
        const fieldJ = currentFields[j];
        if (!fieldJ?.fieldName) continue;
        if (i !== j && fieldJ.fieldName.trim().toLowerCase() === fieldName) {
          errorIndices.add(i);
          errorIndices.add(j);
        }
      }
    }

    setFieldErrors(errorIndices);
  };

  const updateField = (index: number, updates: Partial<FormField>): void => {
    const updatedFields = fields.map((field, i) =>
      i === index ? { ...field, ...updates } : field,
    );

    setFields(updatedFields);

    // Check for duplicates after update
    if (updates.fieldName !== undefined) {
      checkForDuplicates(updatedFields);
    }
  };

  // Helper functions for managing field options
  const addFieldOption = (fieldIndex: number): void => {
    const field = fields[fieldIndex];
    if (!field) return;

    const currentOptions = field.fieldEnum || [];
    const updatedFields = [...fields];
    updatedFields[fieldIndex] = {
      ...field,
      fieldEnum: [...currentOptions, ''],
    };
    setFields(updatedFields);
  };

  const removeFieldOption = (fieldIndex: number, optionIndex: number): void => {
    const field = fields[fieldIndex];
    if (!field || !field.fieldEnum) return;

    const updatedFields = [...fields];
    const filteredOptions = field.fieldEnum.filter((_, i) => i !== optionIndex);

    if (filteredOptions.length === 0) {
      // Remove fieldEnum if empty
      const { fieldEnum: _removed, ...fieldWithoutEnum } = field;
      updatedFields[fieldIndex] = fieldWithoutEnum as FormField;
    } else {
      updatedFields[fieldIndex] = {
        ...field,
        fieldEnum: filteredOptions,
      };
    }
    setFields(updatedFields);
  };

  const updateFieldOption = (fieldIndex: number, optionIndex: number, value: string): void => {
    const field = fields[fieldIndex];
    if (!field || !field.fieldEnum || optionIndex >= field.fieldEnum.length) return;

    const updatedFields = [...fields];
    updatedFields[fieldIndex] = {
      ...field,
      fieldEnum: field.fieldEnum.map((opt, i) => (i === optionIndex ? value : opt)),
    };
    setFields(updatedFields);
  };

  const isSelectField = (fieldType: FormFieldType): boolean => {
    return fieldType === FormFieldType.SINGLE_SELECT || fieldType === FormFieldType.MULTI_SELECT;
  };

  const handleSubmit = (formData: CreateFormFormData) => {
    try {
      // Validation: check for duplicate field names
      if (hasDuplicateFieldNames()) {
        throw new Error('Field names must be unique. Please remove duplicate field names.');
      }

      if (isEditMode && form) {
        // Update mode - use Zero mutator
        const { formDescription } = formData;

        // Filter out empty field names and prepare fields with fieldEnum
        const validFields: Array<{
          id?: string;
          fieldName: string;
          fieldType: FormFieldType;
          fieldEnum?: string[];
          isOptional?: boolean;
        }> = [];

        const fieldIds: Record<string, string> = {};

        fields
          .filter(field => field.fieldName.trim() !== '')
          .forEach(field => {
            // Add fieldEnum only if it's a SELECT field and has non-empty options
            if (isSelectField(field.fieldType) && field.fieldEnum && field.fieldEnum.length > 0) {
              const nonEmptyOptions = field.fieldEnum.filter(opt => opt.trim() !== '');
              if (nonEmptyOptions.length > 0) {
                if (field.id) {
                  validFields.push({
                    id: field.id,
                    fieldName: field.fieldName.trim(),
                    fieldType: field.fieldType,
                    fieldEnum: nonEmptyOptions,
                    isOptional: field.isOptional || false,
                  });
                } else {
                  validFields.push({
                    fieldName: field.fieldName.trim(),
                    fieldType: field.fieldType,
                    fieldEnum: nonEmptyOptions,
                    isOptional: field.isOptional || false,
                  });
                }
                return;
              }
            }
            // No fieldEnum
            if (field.id) {
              validFields.push({
                id: field.id,
                fieldName: field.fieldName.trim(),
                fieldType: field.fieldType,
                isOptional: field.isOptional || false,
              });
            } else {
              validFields.push({
                fieldName: field.fieldName.trim(),
                fieldType: field.fieldType,
                isOptional: field.isOptional || false,
              });
            }
          });

        // Generate unique IDs for new fields and create mapping
        const processedFields = validFields.map((field, index) => {
          if (!field.id) {
            const newFieldId = uuidv4();
            fieldIds[index.toString()] = newFieldId;
            return { ...field, id: newFieldId };
          }
          return field;
        });

        const updateData: {
          formId: string;
          timestamp: number;
          formDescription?: string;
          fields: Array<{
            id?: string;
            fieldName: string;
            fieldType: FormFieldType;
            fieldEnum?: string[];
            isOptional?: boolean;
          }>;
          fieldIds?: Record<string, string>;
        } = {
          formId: form.id,
          timestamp: Date.now(),
          fields: processedFields,
        };

        // Add fieldIds only if there are new fields
        if (Object.keys(fieldIds).length > 0) {
          updateData.fieldIds = fieldIds;
        }

        if (formDescription) {
          updateData.formDescription = formDescription;
        }

        zero.mutate(mutators.form.update(updateData));
      } else {
        // Create mode - use API
        const { formName, formDescription, contextType, entityType } = formData;

        // Validation: at least one field required
        if (fields.length === 0) {
          throw new Error('Please add at least one field to the form');
        }

        // Validation: all fields must have names
        const invalidFields = fields.filter(field => !field.fieldName.trim());
        if (invalidFields.length > 0) {
          throw new Error('All fields must have a name');
        }

        // Validation: SELECT fields must have at least one option
        fields.forEach((field, index) => {
          if (isSelectField(field.fieldType)) {
            const hasOptions = field.fieldEnum && field.fieldEnum.some(opt => opt.trim() !== '');
            if (!hasOptions) {
              throw new Error(
                `Field "${field.fieldName || index + 1}" must have at least one option`,
              );
            }
          }
        });

        const requestData: {
          formName: string;
          contextType: FormContextType;
          entityType: FormEntityType;
          fields: Array<{
            fieldName: string;
            fieldType: FormFieldType;
            fieldEnum?: string[];
            isOptional?: boolean | undefined;
          }>;
          formDescription?: string;
        } = {
          formName: formName.trim(),
          contextType,
          entityType,
          fields: fields
            .filter(field => field.fieldName.trim() !== '')
            .map(field => {
              const baseField = {
                fieldName: field.fieldName.trim(),
                fieldType: field.fieldType,
                isOptional: field.isOptional || undefined,
              };
              // Add fieldEnum only if it's a SELECT field and has non-empty options
              if (isSelectField(field.fieldType) && field.fieldEnum && field.fieldEnum.length > 0) {
                const nonEmptyOptions = field.fieldEnum
                  .filter(opt => opt.trim() !== '')
                  .map(opt => opt.trim());
                if (nonEmptyOptions.length > 0) {
                  return { ...baseField, fieldEnum: nonEmptyOptions };
                }
              }
              return baseField;
            }),
        };

        if (formDescription.trim()) {
          requestData.formDescription = formDescription.trim();
        }

        createFormMutation.mutate(requestData);
      }
    } catch (error) {
      // Handle file upload failures and other API errors
      console.error('Failed to create/update form:', error);
      toast.error(isEditMode ? 'Form Update Failed' : 'Form Creation Failed', {
        description: error instanceof Error ? error.message : 'Operation failed. Please try again.',
      });
    }
  };

  const getDialogTitle = (): string => {
    if (isEditMode) {
      return isReadOnly ? 'View Form' : 'Edit Form';
    }
    return 'Create New Form';
  };

  const getSubmitButtonText = (): string => {
    return isEditMode
      ? 'Update Form'
      : createFormMutation.isPending
        ? 'Creating...'
        : 'Create Form';
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={getDialogTitle()}
      className='max-h-[85vh]'
    >
      <form
        onSubmit={e => void handleFormSubmit(handleSubmit)(e)}
        className='flex flex-col max-h-[85vh]'
      >
        {/* Scrollable content area */}
        <div className='flex-1 overflow-y-auto p-6 space-y-6'>
          {createFormMutation.error && (
            <div className='bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded'>
              {createFormMutation.error instanceof Error
                ? createFormMutation.error.message
                : 'Operation failed'}
            </div>
          )}

          {/* Edit button in header for edit mode */}
          {isEditMode && isReadOnly && (
            <div className='absolute top-4 right-4 z-10'>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={handleEditClick}
                className='flex items-center gap-2'
                data-track-category='Forms'
                data-track-name='EditForm'
                data-track-metadata={JSON.stringify({ formId: form.id })}
              >
                <Edit2 size={16} />
                Edit
              </Button>
            </div>
          )}

          {/* Form Name - Disabled in edit mode */}
          <div>
            <label htmlFor='formName' className='block text-sm font-medium text-foreground mb-1.5'>
              Form Name {!isReadOnly && <span className='text-red-500'>*</span>}
            </label>
            {isReadOnly ? (
              <div className='px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg'>
                {watch('formName') || '-'}
              </div>
            ) : (
              <Controller
                name='formName'
                control={control}
                rules={{ required: 'Form name is required' }}
                render={({ field: { onChange, value } }) => (
                  <Input
                    id='formName'
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    placeholder='Enter form name'
                    required
                    disabled={isEditMode || createFormMutation.isPending}
                  />
                )}
              />
            )}
          </div>

          {/* Description - Disabled in view mode */}
          <div>
            <label
              htmlFor='formDescription'
              className='block text-sm font-medium text-foreground mb-1.5'
            >
              Description
            </label>
            {isReadOnly ? (
              <div className='px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg min-h-[80px]'>
                {watch('formDescription') || '-'}
              </div>
            ) : (
              <Controller
                name='formDescription'
                control={control}
                render={({ field: { onChange, value } }) => (
                  <Textarea
                    id='formDescription'
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    placeholder='Enter form description (optional)'
                    rows={3}
                    disabled={(isEditMode && isReadOnly) || createFormMutation.isPending}
                  />
                )}
              />
            )}
          </div>

          {/* Context Type - Disabled in edit mode */}
          <div>
            <label
              htmlFor='contextType'
              className='block text-sm font-medium text-foreground mb-1.5'
            >
              Context Type {!isReadOnly && <span className='text-red-500'>*</span>}
            </label>
            {isReadOnly ? (
              <div className='px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg'>
                {selectedContextType}
              </div>
            ) : (
              <Controller
                name='contextType'
                control={control}
                rules={{ required: 'Context type is required' }}
                render={({ field: { onChange, value } }) => (
                  <select
                    id='contextType'
                    value={value}
                    onChange={e => onChange(e.target.value as FormContextType)}
                    className='w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100'
                    disabled={isEditMode || createFormMutation.isPending}
                    data-track-event='change'
                    data-track-category='Forms'
                    data-track-name='SelectContextType'
                  >
                    {FORM_CONTEXT_TYPES.map(context => (
                      <option key={context} value={context}>
                        {context}
                      </option>
                    ))}
                  </select>
                )}
              />
            )}
          </div>

          {/* Entity Type - Disabled in edit mode */}
          <div>
            <label
              htmlFor='entityType'
              className='block text-sm font-medium text-foreground mb-1.5'
            >
              Entity Type {!isReadOnly && <span className='text-red-500'>*</span>}
            </label>
            {isReadOnly ? (
              <div className='px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg'>
                {watch('entityType')}
              </div>
            ) : (
              <Controller
                name='entityType'
                control={control}
                rules={{ required: 'Entity type is required' }}
                render={({ field: { onChange, value } }) => (
                  <select
                    id='entityType'
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    className='w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100'
                    disabled={isEditMode || createFormMutation.isPending}
                    data-track-event='change'
                    data-track-category='Forms'
                    data-track-name='SelectEntityType'
                  >
                    {getEntityTypesForContext(selectedContextType).map(entity => (
                      <option key={entity} value={entity}>
                        {entity}
                      </option>
                    ))}
                  </select>
                )}
              />
            )}
          </div>

          {/* Fields Section - Disabled in view mode */}
          <div>
            <hr className='border-gray-200 my-6' />
            <div className='flex items-center justify-between mb-4'>
              <div>
                <h3 className='font-medium text-gray-900'>Form Fields</h3>
                <p className='text-sm text-gray-500'>Add fields to your form</p>
              </div>
              {!isReadOnly && (
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={addField}
                  disabled={createFormMutation.isPending}
                  data-track-category='Forms'
                  data-track-name='AddFormField'
                >
                  <Plus size={16} className='mr-1' />
                  Add Field
                </Button>
              )}
            </div>

            {fields.length === 0 ? (
              <div className='text-center py-8 border-2 border-dashed border-gray-200 rounded-lg'>
                <p className='text-gray-500 text-sm'>
                  No fields added yet. {!isReadOnly && ' Click "Add Field" to get started.'}
                </p>
              </div>
            ) : (
              <div className='space-y-3'>
                {fields.map((field, index) => (
                  <div key={index} className='flex items-start gap-3 p-4 bg-gray-50 rounded-lg'>
                    <div className='flex-1 space-y-3'>
                      <div>
                        <label
                          htmlFor={`fieldName-${index}`}
                          className='block text-sm font-medium text-gray-700 mb-1'
                        >
                          Field Name {!isReadOnly && <span className='text-red-500'>*</span>}
                        </label>
                        {isReadOnly ? (
                          <div className='px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg'>
                            {field.fieldName || '-'}
                          </div>
                        ) : (
                          <>
                            <Input
                              id={`fieldName-${index}`}
                              value={field.fieldName}
                              onChange={e => updateField(index, { fieldName: e.target.value })}
                              placeholder='e.g., Priority, Due Date'
                              disabled={createFormMutation.isPending}
                            />
                            {fieldErrors.has(index) && (
                              <p className='mt-1 text-xs text-red-600'>Field name already exists</p>
                            )}
                          </>
                        )}
                      </div>
                      <div>
                        <label
                          htmlFor={`fieldType-${index}`}
                          className='block text-sm font-medium text-gray-700 mb-1'
                        >
                          Field Type {!isReadOnly && <span className='text-red-500'>*</span>}
                        </label>
                        {isReadOnly ? (
                          <div className='px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg'>
                            {field.fieldType}
                          </div>
                        ) : (
                          <select
                            id={`fieldType-${index}`}
                            value={field.fieldType}
                            onChange={e => {
                              const newFieldType = e.target.value as FormFieldType;

                              // Reset fieldEnum when changing away from SELECT types
                              if (!isSelectField(newFieldType)) {
                                // Remove fieldEnum from the field by not including it in updates
                                const currentField = fields[index];
                                if (currentField && 'fieldEnum' in currentField) {
                                  const { fieldEnum: _, ...fieldWithoutEnum } = currentField;
                                  setFields(
                                    fields.map((f, i) =>
                                      i === index
                                        ? { ...fieldWithoutEnum, fieldType: newFieldType }
                                        : f,
                                    ),
                                  );
                                } else {
                                  updateField(index, { fieldType: newFieldType });
                                }
                              } else {
                                updateField(index, { fieldType: newFieldType });
                              }
                            }}
                            data-track-category='Form'
                            data-track-name='SelectFieldType'
                            className='w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100'
                            disabled={createFormMutation.isPending}
                          >
                            {Object.values(FormFieldType).map(type => (
                              <option key={type} value={type}>
                                {type}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>

                      {/* Is Optional Checkbox */}
                      {!isReadOnly && (
                        <Checkbox
                          id={`isOptional-${index}`}
                          defaultChecked={field.isOptional ?? false}
                          checked={field.isOptional ?? false}
                          onCheckedChange={(checked: boolean | 'indeterminate') =>
                            updateField(index, { isOptional: checked === true })
                          }
                          disabled={createFormMutation.isPending}
                        >
                          This field is optional
                        </Checkbox>
                      )}

                      {/* Show optional status in read mode */}
                      {isReadOnly && field.isOptional && (
                        <div className='text-xs text-gray-500 italic'>Optional field</div>
                      )}

                      {/* Field Options - Only for SELECT types */}
                      {isSelectField(field.fieldType) && (
                        <div>
                          <label className='block text-sm font-medium text-gray-700 mb-2'>
                            Field Options {!isReadOnly && <span className='text-red-500'>*</span>}
                          </label>
                          {isReadOnly ? (
                            <div className='space-y-1'>
                              {field.fieldEnum && field.fieldEnum.length > 0 ? (
                                field.fieldEnum.map((option, optIndex) => (
                                  <div
                                    key={optIndex}
                                    className='px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg'
                                  >
                                    {option || '(empty)'}
                                  </div>
                                ))
                              ) : (
                                <div className='px-3 py-2 text-sm text-gray-400 italic'>
                                  No options
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className='space-y-2'>
                              {(field.fieldEnum || []).map((option, optIndex) => (
                                <div key={optIndex} className='flex gap-2'>
                                  <Input
                                    value={option}
                                    onChange={e =>
                                      updateFieldOption(index, optIndex, e.target.value)
                                    }
                                    placeholder={`Option ${optIndex + 1}`}
                                    disabled={createFormMutation.isPending}
                                    className='flex-1'
                                  />
                                  <Button
                                    type='button'
                                    variant='ghost'
                                    size='sm'
                                    onClick={() => removeFieldOption(index, optIndex)}
                                    disabled={createFormMutation.isPending}
                                    className='text-red-600 hover:text-red-700 hover:bg-red-50'
                                    data-track-category='Forms'
                                    data-track-name='RemoveFieldOption'
                                    data-track-metadata={JSON.stringify({
                                      fieldIndex: index,
                                      optionIndex: optIndex,
                                    })}
                                  >
                                    <X size={16} />
                                  </Button>
                                </div>
                              ))}
                              <Button
                                type='button'
                                variant='outline'
                                size='sm'
                                onClick={() => addFieldOption(index)}
                                disabled={createFormMutation.isPending}
                                data-track-category='Forms'
                                data-track-name='AddFieldOption'
                                data-track-metadata={JSON.stringify({ fieldIndex: index })}
                              >
                                <Plus size={14} className='mr-1' />
                                Add Option
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    {!isReadOnly && (
                      <Button
                        type='button'
                        variant='ghost'
                        size='sm'
                        onClick={() => removeField(index)}
                        disabled={createFormMutation.isPending}
                        className='mt-6 text-red-600 hover:text-red-700 hover:bg-red-50'
                        data-track-category='Forms'
                        data-track-name='RemoveFormField'
                        data-track-metadata={JSON.stringify({ fieldIndex: index })}
                      >
                        <Trash2 size={16} />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Fixed actions footer */}
        {!isReadOnly && (
          <div className='flex gap-2 justify-end p-6 border-t border-gray-200 bg-white'>
            <Button
              variant='outline'
              onClick={() => onOpenChange(false)}
              disabled={createFormMutation.isPending}
              type='button'
              data-track-category='Forms'
              data-track-name='CancelFormCreation'
            >
              Cancel
            </Button>
            <Button
              variant='default'
              type='submit'
              disabled={
                (isEditMode && isReadOnly) ||
                (isEditMode && fields.length === 0) ||
                createFormMutation.isPending
              }
              data-track-category='Forms'
              data-track-name={isEditMode ? 'UpdateForm' : 'CreateForm'}
              data-track-metadata={JSON.stringify({ formId: form?.id })}
            >
              {getSubmitButtonText()}
            </Button>
          </div>
        )}
      </form>
    </Dialog>
  );
};

CreateFormModal.displayName = 'CreateFormModal';

export default CreateFormModal;
