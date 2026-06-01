import React, { useState, useEffect } from 'react';
import { Dialog } from '../../ui/Dialog/Dialog';
import { MappingRulesTable } from './MappingRulesTable';
import type {
  EmailClassificationConfig,
  SaveConfigPayload,
  SaveMappingPayload,
  ClassificationPreviewResult,
  UserGroupOption,
} from '../../../types/classification';

interface ClassificationSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: EmailClassificationConfig | null;
  isSaving: boolean;
  saveConfig: (payload: SaveConfigPayload) => Promise<void>;
  createMapping: (payload: SaveMappingPayload) => Promise<void>;
  updateMapping: (mappingId: string, payload: Partial<SaveMappingPayload>) => Promise<void>;
  deleteMapping: (mappingId: string) => Promise<void>;
  previewResult: ClassificationPreviewResult | null;
  isPreviewing: boolean;
  runPreview: (emailSubject: string, emailBody: string) => Promise<void>;
  error: string | null;
  userGroups: UserGroupOption[];
}

export const ClassificationSettingsModal: React.FC<ClassificationSettingsModalProps> = ({
  open,
  onOpenChange,
  config,
  isSaving,
  saveConfig,
  createMapping,
  updateMapping,
  deleteMapping,
  previewResult,
  isPreviewing,
  runPreview,
  error,
  userGroups,
}) => {
  const [prompt, setPrompt] = useState('');
  const [categoryField, setCategoryField] = useState('Query Type');
  const [subCategoryField, setSubCategoryField] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  // Preview state
  const [previewSubject, setPreviewSubject] = useState('');
  const [previewBody, setPreviewBody] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  // Sync from config whenever modal opens or config changes
  useEffect(() => {
    if (config) {
      setPrompt(config.classificationPrompt);
      setCategoryField(config.categoryField);
      setSubCategoryField(config.subCategoryField ?? '');
      setHasChanges(false);
    }
  }, [config, open]);

  const handleChange = (updater: () => void) => {
    updater();
    setHasChanges(true);
  };

  const handleSave = async () => {
    const payload: SaveConfigPayload = {
      classificationPrompt: prompt,
      enabled: config?.enabled ?? false,
      categoryField,
      subCategoryField: subCategoryField || null,
    };
    await saveConfig(payload);
    setHasChanges(false);
  };

  const handleCancel = () => {
    if (config) {
      setPrompt(config.classificationPrompt);
      setCategoryField(config.categoryField);
      setSubCategoryField(config.subCategoryField ?? '');
    }
    setHasChanges(false);
  };

  const handlePreview = async () => {
    if (!previewSubject || !previewBody) return;
    await runPreview(previewSubject, previewBody);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title='AI Auto-Classification'
      className='max-w-2xl'
    >
      <div className='flex flex-col gap-0 max-h-[85vh]'>
        {/* Header */}
        <div className='flex items-center justify-between px-5 py-4 border-b border-border'>
          <div>
            <div className='text-sm font-semibold text-foreground'>Auto-Classification</div>
            <div className='text-xs text-muted-foreground mt-0.5'>
              Configure classification prompt, field mapping, and routing rules.
            </div>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className='text-muted-foreground hover:text-foreground transition-colors'
            data-track-category='ClassificationSettings'
            data-track-name='CloseModal'
          >
            <svg width='16' height='16' viewBox='0 0 16 16' fill='none'>
              <path
                d='M12 4L4 12M4 4l8 8'
                stroke='currentColor'
                strokeWidth='1.5'
                strokeLinecap='round'
              />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className='overflow-y-auto p-5 space-y-5 text-foreground'>
          {error && (
            <div className='text-sm text-destructive bg-destructive/10 px-3 py-2 rounded'>
              {error}
            </div>
          )}

          {/* Field mapping */}
          <div className='space-y-3'>
            <div className='text-sm font-medium'>Field Mapping</div>
            <p className='text-xs text-muted-foreground'>
              Enter the exact key name your prompt returns for each field.
            </p>
            <div className='grid grid-cols-2 gap-4'>
              <div className='space-y-1'>
                <label
                  htmlFor='classification-category-field'
                  className='text-xs text-muted-foreground'
                >
                  Category field name <span className='text-destructive'>*</span>
                </label>
                <input
                  id='classification-category-field'
                  className='w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground'
                  value={categoryField}
                  onChange={e => handleChange(() => setCategoryField(e.target.value))}
                  placeholder='e.g. Query Type'
                  data-track-category='ClassificationSettings'
                  data-track-name='CategoryFieldInput'
                />
              </div>
              <div className='space-y-1'>
                <label
                  htmlFor='classification-subcategory-field'
                  className='text-xs text-muted-foreground'
                >
                  Sub-Category field name (optional)
                </label>
                <input
                  id='classification-subcategory-field'
                  className='w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground'
                  value={subCategoryField}
                  onChange={e => handleChange(() => setSubCategoryField(e.target.value))}
                  placeholder='e.g. Feature Request Type — leave blank if unused'
                  data-track-category='ClassificationSettings'
                  data-track-name='SubCategoryFieldInput'
                />
              </div>
            </div>
          </div>

          {/* Classification prompt */}
          <div className='space-y-2'>
            <div className='flex items-center justify-between'>
              <div className='text-sm font-medium'>Classification Prompt</div>
              <button
                onClick={() => setShowGuide(v => !v)}
                className='flex items-center gap-1 text-xs text-[#6276be] hover:text-[#4f62a8] transition-colors'
                data-track-category='ClassificationSettings'
                data-track-name='TogglePromptGuide'
              >
                <svg width='13' height='13' viewBox='0 0 16 16' fill='none'>
                  <circle cx='8' cy='8' r='7' stroke='currentColor' strokeWidth='1.5' />
                  <path
                    d='M8 7v5M8 5v1'
                    stroke='currentColor'
                    strokeWidth='1.5'
                    strokeLinecap='round'
                  />
                </svg>
                {showGuide ? 'Hide Guide' : 'Prompt Guide'}
              </button>
            </div>
            {showGuide && (
              <div className='rounded-md border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground space-y-1.5'>
                <p className='font-semibold text-foreground'>
                  How to write your classification prompt:
                </p>
                <ul className='space-y-1 list-disc list-inside'>
                  <li>
                    Return <span className='font-mono text-foreground'>JSON</span> — not a raw
                    string. The system parses JSON to extract the category.
                  </li>
                  <li>
                    The JSON key must <strong className='text-foreground'>exactly match</strong> the
                    Category field name (e.g.{' '}
                    <span className='font-mono text-foreground'>&quot;Query Type&quot;</span>) —
                    casing and spaces included.
                  </li>
                  <li>
                    Return <strong className='text-foreground'>exactly one category</strong> — never
                    combine or list multiple values. The system does a strict key lookup; combined
                    values like{' '}
                    <span className='font-mono text-foreground'>&quot;Mandate, Refund&quot;</span>{' '}
                    will not match and will fall back to{' '}
                    <span className='font-mono text-foreground'>Other</span>.
                  </li>
                  <li>If you have a Sub-Category field, include it in the same JSON object.</li>
                  <li>
                    Category values must match your configured options exactly (e.g.{' '}
                    <span className='font-mono text-foreground'>Mandate</span>,{' '}
                    <span className='font-mono text-foreground'>Refund</span>).
                  </li>
                  <li>Do not wrap output in markdown code fences or add any explanation.</li>
                </ul>
                <div className='mt-2 rounded bg-background border border-border px-3 py-2 font-mono text-foreground'>
                  {`// Example output your prompt should return`}
                  <br />
                  {`{"Query Type": "Refund"}`}
                  <br />
                  {`// With sub-category`}
                  <br />
                  {`{"Query Type": "Refund", "Sub Type": "Partial Refund"}`}
                </div>
              </div>
            )}
            <textarea
              className='w-full rounded border border-border bg-background px-3 py-2 text-sm font-mono text-foreground min-h-[180px] resize-y'
              value={prompt}
              onChange={e => handleChange(() => setPrompt(e.target.value))}
              placeholder='Enter the AI classification prompt...'
              spellCheck={false}
              data-track-category='ClassificationSettings'
              data-track-name='PromptTextarea'
            />
          </div>

          {/* Save / Cancel */}
          {hasChanges && !!prompt.trim() && (
            <div className='flex gap-2'>
              <button
                onClick={() => void handleSave()}
                disabled={isSaving}
                className='text-sm px-4 py-1.5 rounded bg-[#6276be] text-white hover:bg-[#4f62a8] disabled:opacity-50 transition-colors'
                data-track-category='ClassificationSettings'
                data-track-name='SavePromptChanges'
              >
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                onClick={handleCancel}
                className='text-sm px-4 py-1.5 rounded border border-border hover:bg-muted text-foreground transition-colors'
                data-track-category='ClassificationSettings'
                data-track-name='CancelPromptChanges'
              >
                Cancel
              </button>
            </div>
          )}

          {/* Test preview */}
          <div className='space-y-3'>
            <div className='flex items-center justify-between'>
              <div className='text-sm font-medium'>Test Classification</div>
              <button
                onClick={() => setShowPreview(v => !v)}
                className='text-xs text-muted-foreground hover:text-foreground underline'
                data-track-category='ClassificationSettings'
                data-track-name='TogglePreview'
              >
                {showPreview ? 'Hide' : 'Show'}
              </button>
            </div>

            {showPreview && (
              <div className='space-y-3 rounded-md border border-border p-3'>
                <input
                  className='w-full rounded border border-border bg-background px-3 py-1.5 text-sm text-foreground'
                  placeholder='Email subject'
                  value={previewSubject}
                  onChange={e => setPreviewSubject(e.target.value)}
                  data-track-category='ClassificationSettings'
                  data-track-name='PreviewSubjectInput'
                />
                <textarea
                  className='w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground min-h-[80px] resize-y'
                  placeholder='Email body...'
                  value={previewBody}
                  onChange={e => setPreviewBody(e.target.value)}
                  data-track-category='ClassificationSettings'
                  data-track-name='PreviewBodyTextarea'
                />
                <button
                  onClick={() => void handlePreview()}
                  disabled={isPreviewing || !previewSubject || !previewBody}
                  className='text-sm px-3 py-1.5 rounded bg-[#6276be] text-white hover:bg-[#4f62a8] disabled:opacity-50 transition-colors'
                  data-track-category='ClassificationSettings'
                  data-track-name='RunPreview'
                >
                  {isPreviewing ? 'Classifying...' : 'Run Preview'}
                </button>

                {previewResult && (
                  <div className='rounded-md bg-muted/50 p-3 space-y-2 text-sm'>
                    <div className='font-medium'>Preview Result</div>
                    <div className='grid grid-cols-2 gap-x-4 gap-y-1'>
                      <span className='text-muted-foreground'>Category</span>
                      <span className='font-medium'>{previewResult.category}</span>
                      <span className='text-muted-foreground'>Sub-Category</span>
                      <span>{previewResult.subCategory ?? '—'}</span>
                      <span className='text-muted-foreground'>Resolved Group</span>
                      <span className='font-medium text-[#6276be]'>
                        {userGroups.find(g => g.id === previewResult.resolvedGroupId)?.name ??
                          previewResult.resolvedGroupId ??
                          'No match found'}
                      </span>
                    </div>
                    <details className='mt-2'>
                      <summary className='cursor-pointer text-xs text-muted-foreground hover:text-foreground'>
                        Show all AI output fields
                      </summary>
                      <div className='mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs'>
                        {Object.entries(previewResult.rawOutput)
                          .filter(
                            ([, v]) => v !== null && v !== undefined && v !== 'null' && v !== '',
                          )
                          .map(([key, value]) => (
                            <React.Fragment key={key}>
                              <span className='text-muted-foreground py-0.5'>{key}</span>
                              <span className='py-0.5 truncate'>{String(value)}</span>
                            </React.Fragment>
                          ))}
                      </div>
                    </details>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Mapping rules — always visible, disabled until prompt is saved */}
          <div className={!config ? 'opacity-50 pointer-events-none select-none' : ''}>
            {!config && (
              <p className='text-xs text-muted-foreground mb-2'>
                Save your classification prompt above to enable routing rules.
              </p>
            )}
            <MappingRulesTable
              mappings={config?.mappings ?? []}
              userGroups={userGroups}
              onAdd={createMapping}
              onUpdate={updateMapping}
              onDelete={deleteMapping}
            />
          </div>
        </div>
      </div>
    </Dialog>
  );
};
