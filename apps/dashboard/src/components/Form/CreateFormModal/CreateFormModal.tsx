import { ReactElement, useEffect, useMemo, useState } from 'react';
import { PencilEditBox, MultipleCrossCancelDefault } from '@xyne/icons';
import { Form, FormContextType, FormEntityType, type Project } from '@xyne/shared';
import { toast } from 'sonner';
import { CircleHelp } from 'lucide-react';
import { Tooltip } from '../../ui/Tooltip/Tooltip';
import { Dialog } from '../../ui/Dialog/Dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/Select/Select';
import { Combobox } from '../../ui/Combobox/Combobox';
import type { DropdownListItemType } from '../../ui/Combobox/Combobox.types';
import { queries } from '../../../zero/queries';
import { FORM_CONTEXT_TYPES, getEntityTypesForContext } from '../../../constants/formConstants';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useFormEditLock } from '../../../hooks/useFormEditLock';
import { fromZeroRows } from '../../../utils/form/formBuilderMapper';
import { FormBuilder, restFormAdapter, type FormBuilderRequestContext } from '../FormBuilder';

interface CreateFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form?: Form;
  projectId?: string | undefined;
  onSuccess?: (formId: string) => void;
}

const STATIC_VALUE_CLASS = 'px-3 py-2 text-sm bg-muted border border-border rounded-lg';
const LABEL_CLASS = 'block text-sm font-medium text-foreground mb-1.5';

/**
 * Forms-page dialog: owns the chrome (view/Edit header, project + context + entity pickers)
 * and hosts the shared FormBuilder for the form's name, description and fields.
 */
export const CreateFormModal = ({
  open,
  onOpenChange,
  form,
  projectId,
  onSuccess,
}: CreateFormModalProps): ReactElement => {
  const isEditMode = !!form;
  const [isEditing, setIsEditing] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [contextType, setContextType] = useState<FormContextType>(FormContextType.BOARD);
  const [entityType, setEntityType] = useState<FormEntityType>(FormEntityType.TICKET);
  // Combobox does not filter internally (`filteredItems={items}`), so the
  // project list is narrowed here against the typed query.
  const [projectSearch, setProjectSearch] = useState('');

  const shouldSelectProject = !projectId;
  const effectiveProjectId = projectId ?? selectedProjectId;
  const isReadOnly = isEditMode && !isEditing;
  const { locked, lockedReason } = useFormEditLock(form?.createdBy);

  const [formFields, formFieldsResult] = useCachedQuery(
    queries.getFormFieldsByFormId({ formId: form?.id ?? '' }),
    { enabled: isEditMode },
  );
  // A form has no project of its own. When editing, start the "project for new fields" on the
  // project of the form's first shared field — the likeliest home for anything added.
  const formProjectId = useMemo(
    () => formFields?.find(row => row.globalField?.projectId)?.globalField?.projectId,
    [formFields],
  );
  // A save sends the whole field list and the server deletes whatever is missing from it, so
  // editing only starts once the server has confirmed the list is complete.
  const areFieldsLoaded = formFieldsResult.type === 'complete';

  const [projects] = useCachedQuery(queries.getAllProjectsList(), {
    enabled: open && shouldSelectProject,
  });

  // Every open starts fresh: an existing form opens in view mode.
  useEffect(() => {
    if (!open) return;
    setIsEditing(false);
    setProjectSearch('');
    setContextType(form?.contextType ?? FormContextType.BOARD);
    setEntityType(form?.entityType ?? FormEntityType.TICKET);
  }, [open, form?.id, form?.contextType, form?.entityType]);

  useEffect(() => {
    if (projectId) {
      setSelectedProjectId(projectId);
      return;
    }

    if (!open || !projects) return;

    if (!selectedProjectId && formProjectId && projects.some(p => p.id === formProjectId)) {
      setSelectedProjectId(formProjectId);
      return;
    }

    const selectedProjectExists = projects.some(project => project.id === selectedProjectId);
    if (selectedProjectExists) return;

    if (projects.length === 1) {
      setSelectedProjectId(projects[0]?.id ?? '');
      return;
    }

    if (selectedProjectId) {
      setSelectedProjectId('');
    }
  }, [open, projectId, projects, selectedProjectId, formProjectId]);

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

  const formName = form?.formName;
  const formDescription = form?.formDescription;
  const initialData = useMemo(
    () =>
      formName !== undefined && formFields
        ? fromZeroRows({ formName, formDescription }, formFields)
        : undefined,
    [formName, formDescription, formFields],
  );

  const requestContext = useMemo<FormBuilderRequestContext>(
    () => ({
      contextType,
      entityType,
      ...(effectiveProjectId ? { projectId: effectiveProjectId } : {}),
    }),
    [contextType, entityType, effectiveProjectId],
  );

  const handleSaved = (formId: string): void => {
    toast.success(isEditMode ? 'Form updated' : 'Form created');
    onOpenChange(false);
    if (!isEditMode) onSuccess?.(formId);
  };

  const getDialogTitle = (): string => {
    if (isEditMode) {
      return isReadOnly || locked ? 'View Form' : 'Edit Form';
    }
    return 'Create New Form';
  };

  const fieldsSlot = (
    <>
      {shouldSelectProject && !isReadOnly && !locked && (
        <div>
          {/* Not a <label htmlFor>: Combobox owns its input id internally */}
          <span className={`${LABEL_CLASS} flex items-center gap-1.5`}>
            Project for new fields
            <Tooltip
              content={
                <p className='max-w-[280px] text-xs leading-5'>
                  Forms aren&apos;t tied to a project — fields are. New fields you add are created
                  in this project, and field suggestions come from it. To reuse a field from another
                  project, switch here and pick it while typing a field name. Fields already on the
                  form stay as they are.
                </p>
              }
              side='top'
            >
              <button
                type='button'
                aria-label='About the project for new fields'
                className='text-muted-foreground hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full'
              >
                <CircleHelp className='size-3.5' />
              </button>
            </Tooltip>
          </span>
          <Combobox
            // Match the sibling SelectTrigger box in this form
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
          <p className='mt-1 text-xs text-muted-foreground'>
            New fields you add are created in this project.
          </p>
        </div>
      )}
    </>
  );

  const headerSlot = (
    <div className='space-y-5 pb-2'>
      {/* Context and entity are fixed once the form exists */}
      <div className='flex gap-3'>
        <div className='min-w-0 flex-1'>
          <label htmlFor='contextType' className={LABEL_CLASS}>
            Context Type {!isEditMode && <span className='text-red-500'>*</span>}
          </label>
          {isEditMode ? (
            <div className={STATIC_VALUE_CLASS}>{contextType}</div>
          ) : (
            <Select
              value={contextType}
              onValueChange={next => {
                const nextContext = next as FormContextType;
                setContextType(nextContext);
                const entities = getEntityTypesForContext(nextContext);
                if (!entities.includes(entityType)) {
                  setEntityType(entities[0] ?? FormEntityType.TICKET);
                }
              }}
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
        </div>
        <div className='min-w-0 flex-1'>
          <label htmlFor='entityType' className={LABEL_CLASS}>
            Entity Type {!isEditMode && <span className='text-red-500'>*</span>}
          </label>
          {isEditMode ? (
            <div className={STATIC_VALUE_CLASS}>{entityType}</div>
          ) : (
            <Select
              value={entityType}
              onValueChange={next => setEntityType(next as FormEntityType)}
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
                {getEntityTypesForContext(contextType).map(entity => (
                  <SelectItem key={entity} value={entity}>
                    {entity}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
      <hr className='border-border' />
    </div>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={getDialogTitle()}
      className='max-w-[800px] max-h-[85vh] rounded-[16px] overflow-hidden'
    >
      <div className='flex flex-col max-h-[85vh]'>
        {/* Header — form name on the left, Edit + close on the right */}
        <div className='flex shrink-0 items-center justify-between gap-4 border-b border-border px-[18px] py-3'>
          <p className='truncate text-base font-semibold leading-[1.2] tracking-[-0.16px] text-foreground'>
            {form ? form.formName : 'Create New Form'}
          </p>
          <div className='flex shrink-0 items-center gap-1.5'>
            {form && isReadOnly && !locked && (
              <button
                type='button'
                onClick={() => setIsEditing(true)}
                disabled={!areFieldsLoaded}
                className='flex h-7 items-center justify-center gap-2 rounded-[10px] p-2 text-base leading-[1.2] tracking-[-0.16px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'
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

        {open && (!isEditMode || initialData) && (
          <FormBuilder
            key={form?.id ?? 'new'}
            mode={isEditMode ? 'edit' : 'create'}
            formId={form?.id}
            initialData={initialData}
            projectId={effectiveProjectId || undefined}
            persistence={restFormAdapter}
            requestContext={requestContext}
            onSaved={handleSaved}
            submitLabel={isEditMode ? 'Update Form' : 'Create Form'}
            readOnly={isReadOnly}
            locked={locked}
            lockedReason={lockedReason}
            headerSlot={headerSlot}
            fieldsSlot={fieldsSlot}
            onCancel={() => onOpenChange(false)}
            trackingCategory='Forms'
            className='flex-1'
            contentClassName='flex-1 overflow-y-auto p-5'
            footerClassName='border-t border-border bg-background'
          />
        )}
      </div>
    </Dialog>
  );
};

CreateFormModal.displayName = 'CreateFormModal';

export default CreateFormModal;
