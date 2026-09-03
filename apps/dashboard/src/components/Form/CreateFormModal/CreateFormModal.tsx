import { logger, Event as LogEvent } from '../../../utils/logger';
import { ReactElement, useEffect, useMemo, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { arrayMove } from '@dnd-kit/sortable';
import { useZero } from '../../../hooks/useZero';
import {
  PlusDefault,
  DeleteDustbin02,
  PencilEditBox,
  MultipleCrossCancelDefault,
} from '@xyne/icons';
import { v4 as uuidv4 } from 'uuid';
import {
  Form,
  FormContextType,
  FormEntityType,
  FormFieldType,
  FormFields,
  parseFieldOptions,
  type FieldEnumOption,
  type GlobalField,
  type Project,
} from '@xyne/shared';
import { Dialog } from '../../ui/Dialog/Dialog';
import { Button } from '../../ui/Button/Button';
import Input from '../../ui/Input/Input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/Select/Select';
import { Combobox } from '../../ui/Combobox/Combobox';
import type { DropdownListItemType } from '../../ui/Combobox/Combobox.types';
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
import { Checkbox } from '../../ui/Checkbox/Checkbox';
import FieldOptionsList from './FieldOptionsList';
import { useCachedQuery } from '../../../hooks/useCachedQuery';

interface FormField {
  id?: string; // Existing field ID for updates
  fieldName: string;
  fieldType: FormFieldType;
  fieldEnum?: FieldEnumOption[]; // Options for SELECT fields
  isOptional?: boolean | null; // Whether the field is optional
  membershipId?: string; // Membership ID for the field
  // Branch reference, carried through unchanged — this modal has no UI to edit it.
  parentOptionId?: string | null;
}

type FormFieldRow = FormFields & { globalField?: GlobalField | null | undefined };

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
  projectId?: string | undefined;
  onSuccess?: (formId: string) => void;
}

export const CreateFormModal = ({
  open,
  onOpenChange,
  form,
  projectId,
  onSuccess,
}: CreateFormModalProps): ReactElement => {
  const zero = useZero();
  const [fields, setFields] = useState<FormField[]>([]);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Set<number>>(new Set());
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const isEditMode = !!form;
  const shouldSelectProject = !projectId;
  const effectiveProjectId = projectId ?? selectedProjectId;

  // Query form fields if in edit mode
  const [formFields] = useCachedQuery(
    form
      ? queries.getFormFieldsByFormId({ formId: form.id })
      : queries.getFormFieldsByFormId({ formId: '' }),
    { enabled: isEditMode && !!form },
  );

  const [projects] = useCachedQuery(queries.getAllProjectsList(), {
    enabled: open && shouldSelectProject,
  });

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

  // Combobox does not filter internally (`filteredItems={items}`), so the
  // project list is narrowed here against the typed query.
  const [projectSearch, setProjectSearch] = useState('');

  const projectItems = useMemo<DropdownListItemType[]>(() => {
    const term = projectSearch.trim().toLowerCase();
    return (projects ?? [])
      .filter((project: Project) => !term || project.name.toLowerCase().includes(term))
      .map((project: Project) => ({ label: project.name, value: project.id }));
  }, [projects, projectSearch]);

  const selectedProjectItem = useMemo<DropdownListItemType | null>(() => {
    const match = projects?.find((project: Project) => project.id === selectedProjectId);
    return match ? { label: match.name, value: match.id } : null;
  }, [projects, selectedProjectId]);

  useEffect(() => {
    if (projectId) {
      setSelectedProjectId(projectId);
      return;
    }

    if (!open || !projects) return;

    const selectedProjectExists = projects.some(project => project.id === selectedProjectId);
    if (selectedProjectExists) return;

    if (projects.length === 1) {
      setSelectedProjectId(projects[0]?.id ?? '');
      return;
    }

    if (selectedProjectId) {
      setSelectedProjectId('');
    }
  }, [open, projectId, projects, selectedProjectId]);

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
          formFields.flatMap((field: FormFieldRow) => {
            const fieldName = field.globalField?.fieldName ?? field.fieldName;
            const fieldType = field.globalField?.fieldType ?? field.fieldType;
            const fieldEnum =
              field.globalField?.fieldOptions ??
              field.globalField?.fieldEnum ??
              field.fieldOptions ??
              field.fieldEnum;

            if (!fieldName || !fieldType) {
              return [];
            }

            const baseField: FormField = {
              id: field.globalFieldId ?? field.id,
              fieldName,
              fieldType,
              isOptional: field.isOptional,
              membershipId: field.id,
              ...(field.parentOptionId && { parentOptionId: field.parentOptionId }),
            };
            // Only add fieldEnum if it exists and is a non-empty array
            const options = parseFieldOptions(fieldEnum);
            if (options.length > 0) {
              return [{ ...baseField, fieldEnum: options }];
            }
            return [baseField];
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
      fieldEnum: [...currentOptions, { id: crypto.randomUUID(), value: '' }],
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
      fieldEnum: field.fieldEnum.map((opt, i) => (i === optionIndex ? { ...opt, value } : opt)),
    };
    setFields(updatedFields);
  };

  // Option order is the order they render in for the end user, so dragging a
  // row persists as a real reorder of `fieldEnum`.
  const reorderFieldOptions = (fieldIndex: number, fromIndex: number, toIndex: number): void => {
    const field = fields[fieldIndex];
    if (!field?.fieldEnum) return;

    const reordered = arrayMove(field.fieldEnum, fromIndex, toIndex);
    const updatedFields = [...fields];
    updatedFields[fieldIndex] = { ...field, fieldEnum: reordered };
    setFields(updatedFields);
  };

  const isSelectField = (fieldType: FormFieldType): boolean => {
    return fieldType === FormFieldType.SINGLE_SELECT || fieldType === FormFieldType.MULTI_SELECT;
  };

  const handleSubmit = async (formData: CreateFormFormData): Promise<void> => {
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
          membershipId?: string;
          fieldName: string;
          fieldType: FormFieldType;
          fieldEnum?: FieldEnumOption[];
          isOptional?: boolean;
          parentOptionId?: string | null;
        }> = [];

        fields
          .filter(field => field.fieldName.trim() !== '')
          .forEach(field => {
            // Add fieldEnum only if it's a SELECT field and has non-empty options
            if (isSelectField(field.fieldType) && field.fieldEnum && field.fieldEnum.length > 0) {
              const nonEmptyOptions = field.fieldEnum.filter(opt => opt.value.trim() !== '');
              if (nonEmptyOptions.length > 0) {
                if (field.id) {
                  validFields.push({
                    id: field.id,
                    ...(field.membershipId ? { membershipId: field.membershipId } : {}),
                    fieldName: field.fieldName.trim(),
                    fieldType: field.fieldType,
                    fieldEnum: nonEmptyOptions,
                    isOptional: field.isOptional || false,
                    ...(field.parentOptionId !== undefined
                      ? { parentOptionId: field.parentOptionId }
                      : {}),
                  });
                } else {
                  validFields.push({
                    ...(field.membershipId ? { membershipId: field.membershipId } : {}),
                    fieldName: field.fieldName.trim(),
                    fieldType: field.fieldType,
                    fieldEnum: nonEmptyOptions,
                    isOptional: field.isOptional || false,
                    ...(field.parentOptionId !== undefined
                      ? { parentOptionId: field.parentOptionId }
                      : {}),
                  });
                }
                return;
              }
            }
            // No fieldEnum
            if (field.id) {
              validFields.push({
                id: field.id,
                ...(field.membershipId ? { membershipId: field.membershipId } : {}),
                fieldName: field.fieldName.trim(),
                fieldType: field.fieldType,
                isOptional: field.isOptional || false,
                ...(field.parentOptionId !== undefined
                  ? { parentOptionId: field.parentOptionId }
                  : {}),
              });
            } else {
              validFields.push({
                ...(field.membershipId ? { membershipId: field.membershipId } : {}),
                fieldName: field.fieldName.trim(),
                fieldType: field.fieldType,
                isOptional: field.isOptional || false,
                ...(field.parentOptionId !== undefined
                  ? { parentOptionId: field.parentOptionId }
                  : {}),
              });
            }
          });

        // Generate unique IDs for new fields and create mapping
        const processedFields = validFields.map(field => {
          if (!field.id) {
            const newFieldId = uuidv4();
            return { ...field, id: newFieldId };
          }
          return field;
        });

        const updateData: {
          formId: string;
          timestamp: number;
          formDescription?: string;
          fields: Array<{
            id: string;
            membershipId: string;
            fieldName: string;
            fieldType: FormFieldType;
            fieldOptions?: FieldEnumOption[];
            isOptional?: boolean;
            parentOptionId?: string | null;
          }>;
        } = {
          formId: form.id,
          timestamp: Date.now(),
          fields: processedFields.map(field => {
            const resolvedId = field.id ?? uuidv4();
            const resolvedMembershipId = field.membershipId ?? uuidv4();
            return {
              id: resolvedId,
              membershipId: resolvedMembershipId,
              fieldName: field.fieldName,
              fieldType: field.fieldType,
              ...(field.fieldEnum ? { fieldOptions: field.fieldEnum } : {}),
              ...(field.isOptional !== undefined ? { isOptional: field.isOptional } : {}),
              ...(field.parentOptionId !== undefined
                ? { parentOptionId: field.parentOptionId }
                : {}),
            };
          }),
        };

        if (formDescription) {
          updateData.formDescription = formDescription;
        }

        if (!effectiveProjectId) {
          throw new Error('Project is required to update form fields');
        }

        const result = zero.mutate(
          mutators.form.update({ ...updateData, projectId: effectiveProjectId }),
        );
        const response = await result.server;
        if (response.type === 'error') {
          toast.error('Form Update Failed', {
            description: response.error.message || 'Operation failed. Please try again.',
          });
          return;
        }

        toast.success('Form updated');
        onOpenChange(false);
      } else {
        // Create mode - use API
        const { formName, formDescription, contextType, entityType } = formData;

        if (!effectiveProjectId) {
          throw new Error('Project is required to create form fields');
        }

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
            const hasOptions =
              field.fieldEnum && field.fieldEnum.some(opt => opt.value.trim() !== '');
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
          projectId?: string;
          fields: Array<{
            fieldName: string;
            fieldType: FormFieldType;
            fieldEnum?: FieldEnumOption[];
            isOptional?: boolean | undefined;
            parentOptionId?: string | null;
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
                ...(field.parentOptionId !== undefined
                  ? { parentOptionId: field.parentOptionId }
                  : {}),
              };
              // Add fieldEnum only if it's a SELECT field and has non-empty options
              if (isSelectField(field.fieldType) && field.fieldEnum && field.fieldEnum.length > 0) {
                const nonEmptyOptions = field.fieldEnum
                  .filter(opt => opt.value.trim() !== '')
                  .map(opt => ({ ...opt, value: opt.value.trim() }));
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

        requestData.projectId = effectiveProjectId;

        createFormMutation.mutate(requestData);
      }
    } catch (error) {
      // Handle file upload failures and other API errors
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('Failed to create/update form:'),
        error: error,
      });
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

  // The visible header shows the form's own name; `title` on Dialog stays the
  // mode label since it is the (hidden) accessible name.
  const getHeaderTitle = (): string => {
    if (isEditMode && form) return form.formName;
    return 'Create New Form';
  };

  const getSubmitButtonText = (): string => {
    if (isEditMode) {
      return 'Update Form';
    }
    return createFormMutation.isPending ? 'Creating...' : 'Create Form';
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={getDialogTitle()}
      className='max-w-[800px] max-h-[85vh] rounded-[16px] overflow-hidden'
    >
      <form
        onSubmit={e => void handleFormSubmit(handleSubmit)(e)}
        className='flex flex-col max-h-[85vh]'
      >
        {/* Header — form name on the left, Edit + close on the right */}
        <div className='flex shrink-0 items-center justify-between gap-4 border-b border-border px-[18px] py-3'>
          <p className='truncate text-base font-semibold leading-[1.2] tracking-[-0.16px] text-foreground'>
            {getHeaderTitle()}
          </p>
          <div className='flex shrink-0 items-center gap-1.5'>
            {isEditMode && isReadOnly && (
              <button
                type='button'
                onClick={handleEditClick}
                className='flex h-7 items-center justify-center gap-2 rounded-[10px] p-2 text-base leading-[1.2] tracking-[-0.16px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring'
                data-track-category='Forms'
                data-track-name='EditForm'
                data-track-metadata={JSON.stringify({ formId: form.id })}
              >
                <PencilEditBox className='size-4' />
                Edit
              </button>
            )}
            <button
              type='button'
              onClick={() => onOpenChange(false)}
              aria-label='Close'
              className='flex h-7 w-8 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring'
              data-track-category='Forms'
              data-track-name='CloseFormModal'
            >
              <MultipleCrossCancelDefault className='size-4' />
            </button>
          </div>
        </div>

        {/* Scrollable content area */}
        <div className='flex-1 overflow-y-auto p-5 space-y-7'>
          {createFormMutation.error && (
            <div className='bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 rounded'>
              {createFormMutation.error instanceof Error
                ? createFormMutation.error.message
                : 'Operation failed'}
            </div>
          )}

          {shouldSelectProject && (
            <div>
              {/* Not a <label htmlFor>: Combobox owns its input id internally */}
              <span className='block text-sm font-medium text-foreground mb-1.5'>
                Project {!isReadOnly && <span className='text-red-500'>*</span>}
              </span>
              {isReadOnly ? (
                <div className='px-3 py-2 text-sm bg-muted border border-border rounded-lg'>
                  {projects?.find(project => project.id === selectedProjectId)?.name || '-'}
                </div>
              ) : (
                <>
                  {/* Combobox has no `disabled` prop — gate interaction on the wrapper */}
                  <div
                    className={createFormMutation.isPending ? 'opacity-50 pointer-events-none' : ''}
                  >
                    <Combobox
                      // Match the sibling Input/SelectTrigger box in this form
                      className='h-9 rounded-md px-3 shadow-xs bg-transparent transition-[color,box-shadow] focus-within:border-ring focus-within:ring-ring/10 focus-within:ring-[2px]'
                      queryString={selectedProjectItem?.label ?? projectSearch}
                      onInputValueChange={value => {
                        if (value === '' && selectedProjectItem) return;
                        setProjectSearch(value);
                        if (selectedProjectItem && value !== selectedProjectItem.label) {
                          setSelectedProjectId('');
                        }
                      }}
                      items={projectItems}
                      value={selectedProjectItem}
                      onValueChange={value => {
                        setSelectedProjectId(value ?? '');
                        setProjectSearch('');
                      }}
                      placeholder={
                        projects === undefined
                          ? 'Loading projects...'
                          : projects.length === 0
                            ? 'No projects available'
                            : 'Search projects'
                      }
                    />
                  </div>
                  <p className='mt-1 text-xs text-muted-foreground'>
                    Form fields are scoped to the selected project.
                  </p>
                </>
              )}
            </div>
          )}

          {/* Form Name - Disabled in edit mode */}
          <div>
            <label htmlFor='formName' className='block text-sm font-medium text-foreground mb-1.5'>
              Form Name {!isReadOnly && <span className='text-red-500'>*</span>}
            </label>
            {isReadOnly ? (
              <div className='px-3 py-2 text-sm bg-muted border border-border rounded-lg'>
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
              <div className='px-3 py-2 text-sm bg-muted border border-border rounded-lg min-h-[80px]'>
                {watch('formDescription') || '-'}
              </div>
            ) : (
              <Controller
                name='formDescription'
                control={control}
                render={({ field: { onChange, value } }) => (
                  <Textarea
                    id='formDescription'
                    className='text-foreground'
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
              <div className='px-3 py-2 text-sm bg-muted border border-border rounded-lg'>
                {selectedContextType}
              </div>
            ) : (
              <Controller
                name='contextType'
                control={control}
                rules={{ required: 'Context type is required' }}
                render={({ field: { onChange, value } }) => (
                  <Select
                    value={value}
                    onValueChange={next => onChange(next as FormContextType)}
                    disabled={isEditMode || createFormMutation.isPending}
                  >
                    <SelectTrigger
                      id='contextType'
                      className='w-full'
                      data-track-category='Forms'
                      data-track-name='SelectContextType'
                    >
                      <SelectValue placeholder='Select a context type' />
                    </SelectTrigger>
                    <SelectContent>
                      {FORM_CONTEXT_TYPES.map(context => (
                        <SelectItem key={context} value={context}>
                          {context}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
              <div className='px-3 py-2 text-sm bg-muted border border-border rounded-lg'>
                {watch('entityType')}
              </div>
            ) : (
              <Controller
                name='entityType'
                control={control}
                rules={{ required: 'Entity type is required' }}
                render={({ field: { onChange, value } }) => (
                  <Select
                    value={value}
                    onValueChange={onChange}
                    disabled={isEditMode || createFormMutation.isPending}
                  >
                    <SelectTrigger
                      id='entityType'
                      className='w-full'
                      data-track-category='Forms'
                      data-track-name='SelectEntityType'
                    >
                      <SelectValue placeholder='Select an entity type' />
                    </SelectTrigger>
                    <SelectContent>
                      {getEntityTypesForContext(selectedContextType).map(entity => (
                        <SelectItem key={entity} value={entity}>
                          {entity}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            )}
          </div>

          {/* Fields Section - Disabled in view mode */}
          <div>
            <hr className='border-border my-6' />
            <div className='mb-4'>
              <h3 className='font-medium text-foreground'>Form Fields</h3>
              <p className='text-sm text-muted-foreground'>Add fields to your form</p>
            </div>

            {fields.length === 0 && isReadOnly ? (
              <div className='text-center py-8 border-2 border-dashed border-border rounded-lg'>
                <p className='text-muted-foreground text-sm'>No fields added yet.</p>
              </div>
            ) : (
              <div className='space-y-3'>
                {fields.map((field, index) => (
                  <div
                    key={index}
                    className='flex flex-col gap-2.5 rounded-[12px] border border-border bg-card p-4'
                  >
                    {/* Name and type share a row — each column carries its own label */}
                    <div className='flex w-full items-start gap-2.5'>
                      <div className='flex min-w-0 flex-1 flex-col gap-2'>
                        <label
                          htmlFor={`fieldName-${index}`}
                          className='flex items-center gap-1 text-sm font-[550] leading-[1.2] tracking-[-0.1px] text-foreground'
                        >
                          Field Name
                          {!isReadOnly && <span className='text-destructive'>*</span>}
                        </label>
                        {isReadOnly ? (
                          <div className='flex h-11 items-center rounded-[12px] border border-border bg-muted/20 px-2 py-3 text-sm text-foreground'>
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
                              className='h-11 rounded-[12px] px-2 py-3'
                            />
                            {fieldErrors.has(index) && (
                              <p className='text-xs text-destructive'>Field name already exists</p>
                            )}
                          </>
                        )}
                      </div>
                      <div className='flex min-w-0 flex-1 flex-col gap-2'>
                        <label
                          htmlFor={`fieldType-${index}`}
                          className='flex items-center gap-1 text-sm font-[550] leading-[1.2] tracking-[-0.1px] text-foreground'
                        >
                          Field Type
                          {!isReadOnly && <span className='text-destructive'>*</span>}
                        </label>
                        {isReadOnly ? (
                          <div className='flex h-11 items-center rounded-[12px] border border-border bg-muted/20 px-2 py-3 text-sm text-foreground'>
                            {field.fieldType}
                          </div>
                        ) : (
                          <Select
                            value={field.fieldType}
                            onValueChange={value => {
                              const newFieldType = value as FormFieldType;

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
                            disabled={createFormMutation.isPending}
                          >
                            <SelectTrigger
                              id={`fieldType-${index}`}
                              className='h-11 w-full rounded-[12px] px-2 py-3'
                              data-track-category='Forms'
                              data-track-name='SelectFieldType'
                            >
                              <SelectValue placeholder='Select a field type' />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.values(FormFieldType).map(type => (
                                <SelectItem key={type} value={type}>
                                  {type}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    </div>

                    {/* Optional toggle shares its row with the card's own delete
                        action, which the design frame leaves out. */}
                    {(!isReadOnly || field.isOptional) && (
                      <div className='flex w-full items-center justify-between gap-2'>
                        {isReadOnly ? (
                          <p className='text-sm text-muted-foreground italic'>Optional field</p>
                        ) : (
                          <Checkbox
                            checked={field.isOptional ?? false}
                            onChange={checked => updateField(index, { isOptional: checked })}
                            label='Keep this field optional'
                            size='sm'
                            disabled={createFormMutation.isPending}
                          />
                        )}
                        {!isReadOnly && (
                          <button
                            type='button'
                            onClick={() => removeField(index)}
                            disabled={createFormMutation.isPending}
                            aria-label='Remove field'
                            className='flex size-4 shrink-0 items-center justify-center text-destructive outline-none transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring'
                            data-track-category='Forms'
                            data-track-name='RemoveFormField'
                            data-track-metadata={JSON.stringify({ fieldIndex: index })}
                          >
                            <DeleteDustbin02 className='size-4' />
                          </button>
                        )}
                      </div>
                    )}

                    {/* Field Options - Only for SELECT types */}
                    {isSelectField(field.fieldType) && (
                      <div className='flex w-full flex-col gap-2'>
                        <span className='flex items-center gap-1 text-sm font-[550] leading-[1.2] tracking-[-0.1px] text-foreground'>
                          Field Options
                          {!isReadOnly && <span className='text-destructive'>*</span>}
                        </span>
                        {isReadOnly ? (
                          <div className='flex w-full flex-col gap-2'>
                            {field.fieldEnum && field.fieldEnum.length > 0 ? (
                              field.fieldEnum.map(option => (
                                <div
                                  key={option.id}
                                  className='flex h-11 items-center rounded-[12px] border border-border bg-muted/20 px-2 py-3 text-sm text-foreground'
                                >
                                  {option.value || '(empty)'}
                                </div>
                              ))
                            ) : (
                              <p className='text-sm text-muted-foreground italic'>No options</p>
                            )}
                          </div>
                        ) : (
                          <FieldOptionsList
                            fieldIndex={index}
                            options={field.fieldEnum ?? []}
                            disabled={createFormMutation.isPending}
                            onChangeOption={(optionIndex, value) =>
                              updateFieldOption(index, optionIndex, value)
                            }
                            onRemoveOption={optionIndex => removeFieldOption(index, optionIndex)}
                            onAddOption={() => addFieldOption(index)}
                            onReorder={(from, to) => reorderFieldOptions(index, from, to)}
                          />
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {!isReadOnly && (
                  <button
                    type='button'
                    onClick={addField}
                    disabled={createFormMutation.isPending}
                    className='flex w-full items-center justify-center gap-2 rounded-[12px] border border-dashed border-border bg-card px-2 py-3 text-sm font-[450] leading-[1.2] text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring'
                    data-track-category='Forms'
                    data-track-name='AddFormField'
                  >
                    <PlusDefault className='size-4' />
                    Add new form field
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Fixed actions footer */}
        {!isReadOnly && (
          <div className='flex gap-2 justify-end p-6 border-t border-border bg-background'>
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
                !effectiveProjectId ||
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
