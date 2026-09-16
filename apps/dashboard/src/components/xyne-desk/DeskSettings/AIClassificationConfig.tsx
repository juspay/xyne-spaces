import { ArrowLeft, Users, Trash2, Plus, CircleHelp } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/Select/Select';
import { TestClassificationForm } from './TestClassificationForm';
import type {
  ClassificationMapping,
  SaveMappingPayload,
  ClassificationPreviewResult,
} from '../../../types/classification';

export interface AIClassificationConfigProps {
  canManage: boolean;
  onBack: () => void;
  userGroups: { id: string; name: string }[];
  classificationPrompt: string;
  setClassificationPrompt: (value: string) => void;
  categoryField: string;
  setCategoryField: (value: string) => void;
  subCategoryField: string;
  setSubCategoryField: (value: string) => void;
  mappings: ClassificationMapping[];
  saveMapping: (payload: SaveMappingPayload) => void;
  updateMapping: (mappingId: string, payload: Partial<SaveMappingPayload>) => void;
  deleteMapping: (mappingId: string) => void;
  previewResult: ClassificationPreviewResult | null;
  isPreviewing: boolean;
  runPreview: (emailSubject: string, emailBody: string) => Promise<void>;
  error: string | null;
  /** Save-blocking validation message (e.g. enabled but missing category/prompt). */
  validationError?: string | null;
}

export const AIClassificationConfig: React.FC<AIClassificationConfigProps> = ({
  canManage,
  onBack,
  userGroups,
  classificationPrompt,
  setClassificationPrompt,
  categoryField,
  setCategoryField,
  subCategoryField,
  setSubCategoryField,
  mappings,
  saveMapping,
  updateMapping,
  deleteMapping,
  previewResult,
  isPreviewing,
  runPreview,
  error,
  validationError,
}) => {
  const [showNewRuleForm, setShowNewRuleForm] = useState(false);
  const [editingMappingId, setEditingMappingId] = useState<string | null>(null);
  const [editCategory, setEditCategory] = useState('');
  const [editSubCategory, setEditSubCategory] = useState('');
  const [editUserGroup, setEditUserGroup] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [newSubCategory, setNewSubCategory] = useState('');
  const [newUserGroup, setNewUserGroup] = useState('');
  const [showPromptGuide, setShowPromptGuide] = useState(false);
  const [testEmailSubject, setTestEmailSubject] = useState('');
  const [testEmailBody, setTestEmailBody] = useState('');
  const newRuleFormRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showNewRuleForm) {
      newRuleFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [showNewRuleForm]);

  const handleAddRule = () => {
    if (!canManage || !newCategory.trim() || !newUserGroup) return;
    void saveMapping({
      category: newCategory.trim(),
      subCategory: newSubCategory.trim() || null,
      userGroupId: newUserGroup,
    });
    setNewCategory('');
    setNewSubCategory('');
    setNewUserGroup('');
    setShowNewRuleForm(false);
  };

  const startEditRule = (mapping: ClassificationMapping) => {
    if (!canManage) return;
    setShowNewRuleForm(false);
    setEditingMappingId(mapping.id);
    setEditCategory(mapping.category);
    setEditSubCategory(mapping.subCategory ?? '');
    setEditUserGroup(mapping.userGroupId);
  };

  const cancelEditRule = () => {
    setEditingMappingId(null);
    setEditCategory('');
    setEditSubCategory('');
    setEditUserGroup('');
  };

  const handleSaveEditRule = () => {
    if (!canManage || !editingMappingId || !editCategory.trim() || !editUserGroup) return;
    void updateMapping(editingMappingId, {
      category: editCategory.trim(),
      subCategory: editSubCategory.trim() || null,
      userGroupId: editUserGroup,
    });
    cancelEditRule();
  };

  const handleDeleteRule = (id: string) => {
    if (!canManage) return;
    if (editingMappingId === id) {
      cancelEditRule();
    }
    void deleteMapping(id);
  };

  const handleRunPreview = () => {
    if (!testEmailSubject.trim() || !testEmailBody.trim()) return;
    void runPreview(testEmailSubject, testEmailBody);
  };

  const getUserGroupName = (userGroupId: string) => {
    return userGroups.find(g => g.id === userGroupId)?.name ?? userGroupId;
  };

  const fieldDisabled = !canManage;
  const rulesReady = Boolean(classificationPrompt.trim());

  return (
    <div className='flex flex-col gap-[16px]'>
      <button
        type='button'
        className='text-desk-label flex items-center gap-[6px]'
        onClick={onBack}
        data-track-category='DeskSettings'
        data-track-name='BackFromClassificationConfig'
      >
        <ArrowLeft size={16} />
        Configure Auto-classification
      </button>

      {validationError && (
        <div className='rounded-[10px] bg-destructive/10 px-3 py-2 text-[13px] font-medium leading-[120%] tracking-[-0.1px] text-destructive'>
          {validationError}
        </div>
      )}

      <div className='flex flex-col gap-[2px]'>
        <div className='text-desk-label'>Field Mapping</div>
        <div className='text-desk-helper'>
          Enter the exact key name your prompt returns for each field.
        </div>
      </div>

      <div className='flex flex-col gap-[8px]'>
        <label htmlFor='classification-category-field' className='text-desk-label'>
          Category field name <span className='text-red-500'>*</span>
        </label>
        <input
          id='classification-category-field'
          type='text'
          value={categoryField}
          onChange={e => setCategoryField(e.target.value)}
          placeholder='eg. Query Type'
          readOnly={fieldDisabled}
          disabled={fieldDisabled}
          className='w-full max-w-[300px] rounded-[10px] border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-desk-helper focus:outline-none focus:ring-1 focus:ring-desk-accent disabled:opacity-50 read-only:bg-muted/40 read-only:cursor-default read-only:focus:ring-0'
          data-track-category='DeskSettings'
          data-track-name='CategoryFieldName'
        />
      </div>

      <div className='flex flex-col gap-[8px]'>
        <label htmlFor='classification-subcategory-field' className='text-desk-label'>
          Sub-category field name <span className='text-desk-helper'>(optional)</span>
        </label>
        <input
          id='classification-subcategory-field'
          type='text'
          value={subCategoryField}
          onChange={e => setSubCategoryField(e.target.value)}
          placeholder='eg. Feature Request Type'
          readOnly={fieldDisabled}
          disabled={fieldDisabled}
          className='w-full max-w-[300px] rounded-[10px] border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-desk-helper focus:outline-none focus:ring-1 focus:ring-desk-accent disabled:opacity-50 read-only:bg-muted/40 read-only:cursor-default read-only:focus:ring-0'
          data-track-category='DeskSettings'
          data-track-name='SubCategoryFieldName'
        />
      </div>

      <div className='flex flex-col gap-2'>
        <div className='flex items-center gap-2'>
          <label htmlFor='classification-prompt' className='text-desk-label'>
            Classification Prompt
          </label>
          <button
            type='button'
            onClick={() => setShowPromptGuide(v => !v)}
            className='flex shrink-0 items-center gap-1 text-xs text-desk-muted'
            disabled={fieldDisabled}
            data-track-category='DeskSettings'
            data-track-name='TogglePromptGuide'
          >
            <CircleHelp size={13} />
          </button>
        </div>
        {showPromptGuide && (
          <div className='rounded-[10px] border border-border bg-muted/30 dark:bg-muted/20 px-4 py-3 text-xs text-muted-foreground space-y-1.5'>
            <p className='font-semibold text-foreground'>
              How to write your classification prompt:
            </p>
            <ul className='space-y-1 list-disc list-inside'>
              <li>
                Return <span className='font-mono text-foreground'>JSON</span> — not a raw string.
                The system parses JSON to extract the category.
              </li>
              <li>
                The JSON key must <strong className='text-foreground'>exactly match</strong> the
                category field name (e.g.{' '}
                <span className='font-mono text-foreground'>&quot;Query Type&quot;</span>) — casing
                and spaces included.
              </li>
              <li>
                Return <strong className='text-foreground'>exactly one category</strong> — never
                combine or list multiple values.
              </li>
              <li>If you have a sub-category field, include it in the same JSON object.</li>
              <li>
                Category values must match your configured options exactly (e.g.{' '}
                <span className='font-mono text-foreground'>Mandate</span>,{' '}
                <span className='font-mono text-foreground'>Refund</span>).
              </li>
              <li>Do not wrap output in markdown code fences or add any explanation.</li>
            </ul>
            <div className='mt-2 rounded-[10px] bg-background border border-border px-3 py-2 font-mono text-xs text-foreground'>
              <div>{`// Example output your prompt should return`}</div>
              <div>{`{"Query Type": "Refund"}`}</div>
              <div>{`// With sub-category`}</div>
              <div>{`{"Query Type": "Refund", "Sub Type": "Partial Refund"}`}</div>
            </div>
          </div>
        )}
        <textarea
          id='classification-prompt'
          value={classificationPrompt}
          onChange={e => setClassificationPrompt(e.target.value)}
          placeholder='Enter AI classification prompt'
          spellCheck={false}
          readOnly={fieldDisabled}
          disabled={fieldDisabled}
          className='h-[150px] w-full rounded-[10px] border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-desk-helper focus:outline-none focus:ring-1 focus:ring-desk-accent disabled:opacity-50 read-only:cursor-default read-only:bg-muted/40 read-only:focus:ring-0'
          data-track-category='DeskSettings'
          data-track-name='ClassificationPrompt'
        />
      </div>

      <TestClassificationForm
        title='Test classification'
        subjectValue={testEmailSubject}
        onSubjectChange={setTestEmailSubject}
        bodyValue={testEmailBody}
        onBodyChange={setTestEmailBody}
        isPreviewing={isPreviewing}
        onRunPreview={handleRunPreview}
        subjectTrackName='ClassificationPreviewSubject'
        bodyTrackName='ClassificationPreviewBody'
        runTrackName='RunClassificationPreview'
      >
        {previewResult && (
          <div className='rounded-[10px] bg-background border border-border p-3 space-y-2 text-sm'>
            <div className='font-medium text-foreground'>Preview result</div>
            <div className='grid grid-cols-2 gap-x-4 gap-y-1'>
              <span className='text-muted-foreground'>Category</span>
              <span className='font-medium text-foreground'>{previewResult.category}</span>
              <span className='text-muted-foreground'>Sub-category</span>
              <span className='text-foreground'>{previewResult.subCategory ?? '—'}</span>
              <span className='text-muted-foreground'>Resolved group</span>
              <span className='font-medium text-desk-accent'>
                {previewResult.resolvedGroupId
                  ? getUserGroupName(previewResult.resolvedGroupId)
                  : (previewResult.resolvedGroupId ?? 'No match found')}
              </span>
            </div>
            <details className='mt-2'>
              <summary className='cursor-pointer text-xs text-muted-foreground hover:text-foreground'>
                Show all AI output fields
              </summary>
              <div className='mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs'>
                {Object.entries(previewResult.rawOutput)
                  .filter(([, v]) => v !== null && v !== undefined && v !== 'null' && v !== '')
                  .map(([key, value]) => (
                    <span key={key} className='contents'>
                      <span className='text-muted-foreground py-0.5'>{key}</span>
                      <span className='py-0.5 truncate text-foreground'>{String(value)}</span>
                    </span>
                  ))}
              </div>
            </details>
          </div>
        )}
      </TestClassificationForm>

      {error && <div className='text-sm text-destructive'>{error}</div>}

      <div
        className={`border border-border rounded-[10px] pt-[12px] px-[8px] pb-[16px] space-y-4 bg-background ${!rulesReady ? 'opacity-50 pointer-events-none select-none' : ''}`}
      >
        {!rulesReady && (
          <p className='text-xs text-muted-foreground px-[8px] mb-1'>
            Add your classification prompt above to enable assignment rules.
          </p>
        )}
        <div className='flex items-center justify-between px-[8px]'>
          <div className='text-desk-label'>Assignment Rule</div>
          {canManage && (
            <button
              type='button'
              className='flex items-center gap-1 text-sm text-desk-accent'
              onClick={() => {
                cancelEditRule();
                setShowNewRuleForm(true);
              }}
              data-track-category='DeskSettings'
              data-track-name='AddClassificationRule'
            >
              <Plus size={14} />
              <span>Add rule</span>
            </button>
          )}
        </div>

        <div className='overflow-x-auto -mx-1 px-1'>
          <div className='grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(72px,100px)] gap-x-4 min-w-[32rem] px-4 pb-[8px]'>
            <div className='text-desk-helper pb-2'>Category</div>
            <div className='text-desk-helper pb-2'>Sub-category</div>
            <div className='text-desk-helper pb-2'>User group</div>
            <div />
          </div>

          {(mappings ?? []).map(mapping => {
            const isEditing = editingMappingId === mapping.id;

            if (isEditing) {
              return (
                <div
                  key={mapping.id}
                  className='grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(72px,100px)] gap-x-4 min-w-[32rem] px-4 py-2 rounded-[10px] bg-muted/30 dark:bg-muted/20 items-center'
                >
                  <input
                    type='text'
                    value={editCategory}
                    onChange={e => setEditCategory(e.target.value)}
                    placeholder='eg. Feature Request'
                    className='w-full rounded-[10px] border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-desk-accent'
                    data-track-category='DeskSettings'
                    data-track-name='EditRuleCategory'
                  />
                  <input
                    type='text'
                    value={editSubCategory}
                    onChange={e => setEditSubCategory(e.target.value)}
                    placeholder='eg. UPI (empty = catch all)'
                    className='w-full rounded-[10px] border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-desk-accent'
                    data-track-category='DeskSettings'
                    data-track-name='EditRuleSubCategory'
                  />
                  <Select value={editUserGroup} onValueChange={setEditUserGroup}>
                    <SelectTrigger className='w-full rounded-[10px] border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-desk-accent'>
                      <SelectValue placeholder='Choose user group' />
                    </SelectTrigger>
                    <SelectContent className='rounded-[10px]'>
                      {userGroups.map(group => (
                        <SelectItem key={group.id} value={group.id} className='rounded-[8px]'>
                          {group.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className='flex flex-row items-center justify-center gap-2 pt-1'>
                    <button
                      type='button'
                      onClick={handleSaveEditRule}
                      disabled={!editCategory.trim() || !editUserGroup}
                      className='text-xs font-medium text-desk-accent disabled:opacity-50 disabled:cursor-not-allowed'
                      data-track-category='DeskSettings'
                      data-track-name='SaveEditRule'
                      data-ph-capture-attribute-track-id='desk_classification_rule_update'
                    >
                      Save
                    </button>
                    <button
                      type='button'
                      onClick={cancelEditRule}
                      className='text-xs font-medium text-muted-foreground hover:text-foreground'
                      data-track-category='DeskSettings'
                      data-track-name='CancelEditRule'
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={mapping.id}
                className='grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(72px,100px)] gap-x-4 min-w-[32rem] items-center rounded-[10px] hover:bg-muted/60 transition-colors group px-4 py-2 mt-0 hover:cursor-pointer'
              >
                <div className='text-sm text-foreground min-w-0'>{mapping.category}</div>
                <div className='text-sm text-foreground min-w-0'>
                  {mapping.subCategory ?? '(catch all)'}
                </div>
                <div className='flex items-center gap-1.5 text-sm text-foreground min-w-0'>
                  <Users size={14} className='text-muted-foreground shrink-0' />
                  <span className='truncate'>{getUserGroupName(mapping.userGroupId)}</span>
                </div>
                {canManage && (
                  <div className='flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity'>
                    <button
                      type='button'
                      onClick={() => startEditRule(mapping)}
                      className='text-desk-label'
                      title='Edit rule'
                      data-track-category='DeskSettings'
                      data-track-name='EditClassificationRule'
                    >
                      Edit
                    </button>
                    <button
                      type='button'
                      onClick={() => handleDeleteRule(mapping.id)}
                      className='text-red-500 hover:text-red-600 transition-colors'
                      title='Delete rule'
                      data-track-category='DeskSettings'
                      data-track-name='DeleteClassificationRule'
                      data-ph-capture-attribute-track-id='desk_classification_rule_delete'
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {canManage && showNewRuleForm && (
          <div
            ref={newRuleFormRef}
            className='rounded-[10px] p-4 space-y-4 bg-muted/50 dark:bg-muted/20'
          >
            <div className='text-sm font-bold text-foreground'>New rule</div>

            <div className='grid grid-cols-2 gap-4 items-start'>
              <div className='flex flex-col gap-[8px]'>
                <label htmlFor='new-rule-category' className='text-sm text-foreground'>
                  Category<span className='text-red-500'>*</span>
                </label>
                <input
                  id='new-rule-category'
                  type='text'
                  value={newCategory}
                  onChange={e => setNewCategory(e.target.value)}
                  placeholder='eg. Feature Request'
                  className='w-full rounded-[10px] border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-desk-accent'
                  data-track-category='DeskSettings'
                  data-track-name='NewRuleCategory'
                />
              </div>

              <div className='flex flex-col gap-[8px]'>
                <label htmlFor='new-rule-user-group' className='text-sm text-foreground'>
                  User Group<span className='text-red-500'>*</span>
                </label>
                <Select value={newUserGroup} onValueChange={setNewUserGroup}>
                  <SelectTrigger
                    id='new-rule-user-group'
                    className='w-full rounded-[10px] border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-desk-accent'
                  >
                    <SelectValue placeholder='Choose user group' />
                  </SelectTrigger>
                  <SelectContent className='rounded-[10px]'>
                    {userGroups.map(group => (
                      <SelectItem key={group.id} value={group.id} className='rounded-[8px]'>
                        {group.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className='flex flex-col gap-[8px]'>
              <label htmlFor='new-rule-subcategory' className='text-sm text-foreground'>
                Sub-category field name{' '}
                <span className='text-muted-foreground'>(optional, empty = catch all)</span>
              </label>
              <input
                id='new-rule-subcategory'
                type='text'
                value={newSubCategory}
                onChange={e => setNewSubCategory(e.target.value)}
                placeholder='eg. UPI, mWeb Intent, UPI QR'
                className='w-full rounded-[10px] border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-desk-accent'
                data-track-category='DeskSettings'
                data-track-name='NewRuleSubCategory'
              />
            </div>

            <div className='flex items-center justify-end gap-2'>
              <button
                type='button'
                onClick={() => {
                  setShowNewRuleForm(false);
                  setNewCategory('');
                  setNewSubCategory('');
                  setNewUserGroup('');
                }}
                className='px-[12px] py-[6px] text-sm font-medium text-foreground bg-background border border-border rounded-[10px] hover:bg-accent transition-colors'
                data-track-category='DeskSettings'
                data-track-name='CancelNewRule'
              >
                Cancel
              </button>
              <button
                type='button'
                onClick={handleAddRule}
                disabled={!newCategory.trim() || !newUserGroup}
                className='rounded-[10px] bg-desk-accent px-[12px] py-[6px] text-sm font-medium text-white transition-colors hover:bg-desk-accent-hover disabled:cursor-not-allowed disabled:opacity-50'
                data-track-category='DeskSettings'
                data-track-name='ConfirmAddRule'
                data-ph-capture-attribute-track-id='desk_classification_rule_create'
              >
                Add Rule
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
