import { ReactElement, useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { FormContextType, FormEntityType, FormFields } from '@xyne/shared';
import { queries } from '../../../zero/queries';
import CreateFormModal from '../../Form/CreateFormModal/CreateFormModal';
import { Button } from '../../ui/Button/Button';
import { useCachedQuery } from '../../../hooks/useCachedQuery';

interface BoardFormSelectorProps {
  selectedFormIds: Set<string>;
  onFormSelect: (formId: string) => void;
  onFormDeselect: (formId: string) => void;
  disabled?: boolean;
}

export const BoardFormSelector = ({
  selectedFormIds,
  onFormSelect,
  onFormDeselect,
  disabled = false,
}: BoardFormSelectorProps): ReactElement => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [expandedFormId, setExpandedFormId] = useState<string | null>(null);

  // Fetch all BOARD context forms
  const [forms] = useCachedQuery(
    queries.getFormsByContextType({ contextType: FormContextType.BOARD }),
  );

  // Get entity types of currently selected forms
  const selectedEntityTypes = useMemo(() => {
    const entityTypes = new Set<string>();
    if (forms) {
      forms.forEach(form => {
        if (selectedFormIds.has(form.id)) {
          entityTypes.add(form.entityType);
        }
      });
    }
    return entityTypes;
  }, [forms, selectedFormIds]);

  const toggleExpand = (formId: string): void => {
    setExpandedFormId(expandedFormId === formId ? null : formId);
  };

  const handleCheckboxChange = (formId: string, isChecked: boolean): void => {
    if (isChecked) {
      onFormSelect(formId);
    } else {
      onFormDeselect(formId);
    }
  };

  const handleFormCreated = (formId: string): void => {
    onFormSelect(formId);
    setShowCreateModal(false);
  };

  const hasSelectionConflict = (entityType: FormEntityType): boolean => {
    return selectedEntityTypes.has(entityType);
  };

  const getConflictingFormId = (entityType: FormEntityType): string | undefined => {
    if (!forms) return undefined;
    return forms.find(f => f.entityType === entityType && selectedFormIds.has(f.id))?.id;
  };

  return (
    <div className='space-y-4'>
      <div className='flex items-start justify-between gap-2'>
        <div className='flex-1'>
          <h3 className='font-medium text-foreground'>Associated Forms</h3>
          <p className='text-sm text-muted-foreground'>
            Select forms to use with this board (one form per entity type)
          </p>
        </div>
        <div className='flex gap-2'>
          <Button
            variant='outline'
            size='sm'
            onClick={() => setShowCreateModal(true)}
            disabled={disabled}
            data-track-category='Board'
            data-track-name='CreateNewForm'
          >
            <Plus size={16} className='mr-1' />
            Create New Form
          </Button>
        </div>
      </div>

      {forms && forms.length > 0 ? (
        <div className='space-y-2'>
          {forms.map(form => {
            const isExpanded = expandedFormId === form.id;
            const isSelected = selectedFormIds.has(form.id);
            const hasConflict = !isSelected && hasSelectionConflict(form.entityType);
            const conflictingFormId = getConflictingFormId(form.entityType);
            const formFields = form.formFields || [];

            return (
              <div
                key={form.id}
                className={`border rounded-lg transition-all ${
                  isSelected
                    ? 'border-blue-500 bg-blue-50'
                    : hasConflict
                      ? 'border-yellow-400 bg-yellow-50'
                      : 'border-border bg-background hover:border-input'
                } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {/* Header - Always Visible */}
                <div className='flex items-center justify-between p-4'>
                  <div className='flex items-center gap-3 flex-1'>
                    {/* Checkbox - Independent of accordion toggle */}
                    <input
                      type='checkbox'
                      checked={isSelected}
                      disabled={disabled}
                      onChange={e => {
                        e.stopPropagation();
                        handleCheckboxChange(form.id, e.target.checked);
                      }}
                      className='flex-shrink-0 w-4 h-4 text-blue-600 border-input rounded focus:ring-ring cursor-pointer'
                      data-track-event='change'
                      data-track-category='Board'
                      data-track-name='ToggleFormSelection'
                      data-track-metadata={JSON.stringify({
                        formId: form.id,
                        formName: form.formName,
                      })}
                    />

                    <div
                      className='flex-1'
                      role='button'
                      tabIndex={0}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !disabled) {
                          e.preventDefault();
                          toggleExpand(form.id);
                        }
                      }}
                      onClick={!disabled ? () => toggleExpand(form.id) : undefined}
                      data-track-category='Board'
                      data-track-name='ExpandFormDetails'
                      data-track-metadata={JSON.stringify({
                        formId: form.id,
                        formName: form.formName,
                      })}
                    >
                      <div className='flex items-center gap-2'>
                        <span className='font-medium text-foreground'>{form.formName}</span>
                        <span className='text-xs px-2 py-0.5 bg-muted text-muted-foreground rounded-full'>
                          {form.entityType}
                        </span>
                      </div>
                      {isSelected && <p className='text-xs text-blue-600 mt-1'>Selected</p>}
                      {hasConflict && conflictingFormId && (
                        <p className='text-xs text-yellow-700 mt-1'>
                          Select to replace: {forms.find(f => f.id === conflictingFormId)?.formName}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Accordion Toggle - Independent of checkbox */}
                  <div
                    className={`flex-shrink-0 ml-2 transition-transform cursor-pointer ${
                      isExpanded ? 'rotate-90' : ''
                    }`}
                    role='button'
                    tabIndex={0}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !disabled) {
                        e.preventDefault();
                        toggleExpand(form.id);
                      }
                    }}
                    onClick={!disabled ? () => toggleExpand(form.id) : undefined}
                    data-track-category='Board'
                    data-track-name='ToggleFormAccordion'
                    data-track-metadata={JSON.stringify({
                      formId: form.id,
                      formName: form.formName,
                    })}
                  >
                    {isExpanded ? (
                      <ChevronDown size={20} className='text-muted-foreground' />
                    ) : (
                      <ChevronRight size={20} className='text-muted-foreground' />
                    )}
                  </div>
                </div>

                {/* Expanded Content - Description and Fields */}
                {isExpanded && (
                  <div className='px-4 pb-4 pt-0 border-t border-border'>
                    {form.formDescription && (
                      <div className='mt-3'>
                        <h4 className='text-sm font-medium text-foreground mb-1'>Description</h4>
                        <p className='text-sm text-muted-foreground'>{form.formDescription}</p>
                      </div>
                    )}

                    {formFields.length > 0 && (
                      <div className='mt-4'>
                        <h4 className='text-sm font-medium text-foreground mb-2'>Fields</h4>
                        <div className='grid grid-cols-2 gap-2'>
                          {formFields.map((field: FormFields) => (
                            <div
                              key={field.id}
                              className='flex items-center gap-3 p-2 bg-muted rounded text-sm'
                            >
                              <div className='flex-1 min-w-0'>
                                <span className='font-medium text-foreground truncate block'>
                                  {field.fieldName}
                                </span>
                              </div>
                              <div className='flex-shrink-0'>
                                <span className='text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded whitespace-nowrap'>
                                  {field.fieldType}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className='text-center py-8 border-2 border-dashed border-border rounded-lg'>
          <p className='text-muted-foreground text-sm'>
            No forms available. Create a new form to get started.
          </p>
        </div>
      )}

      {showCreateModal && (
        <CreateFormModal
          open={showCreateModal}
          onOpenChange={setShowCreateModal}
          onSuccess={handleFormCreated}
        />
      )}
    </div>
  );
};

BoardFormSelector.displayName = 'BoardFormSelector';

export default BoardFormSelector;
