import { logger, Event as LogEvent } from '../../../utils/logger';
import React, { useEffect, useState } from 'react';
import { ArrowLeft, Plus, Trash2, Pencil } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/Select/Select';
import { TAG_FORMAT_REGEX, TAG_FORMAT_MESSAGE, findDuplicateTags } from '@xyne/shared';
import { TagChipInput } from '../../ui/TagChipInput/TagChipInput';
import { useCategoryCatalog } from '../../../hooks/useCategoryCatalog';
import { tagsApi } from '../../../api/tagsApi';
import { tagsConfigApi } from '../../../api/tagsConfigApi';
import type {
  CategoryCatalogEntry,
  TagCategories,
  TagCategoryConfig,
  GeneratedTagPreviewItem,
} from '../../../api/tagsConfigApi';
import { TestClassificationForm } from './TestClassificationForm';
import { TagChip, CategoryLabel } from '../../tags/TagsBadge';
import { Button } from '../../ui/Button/Button';
import { posthogService } from '../../../services/Analytics/posthogService';

// ─── Constants ────────────────────────────────────────────────────────────────

const TAG_METHODS: { value: TagCategoryConfig['method']; label: string }[] = [
  { value: 'llm', label: 'LLM' },
  { value: 'manual', label: 'Manual' },
];

// ─── Form state ───────────────────────────────────────────────────────────────

interface CategoryFormState {
  name: string;
  method: TagCategoryConfig['method'];
  color: string;
  tags: string[];
  blacklist: string[];
  prompt: string;
  count: string;
  isNewTagAllowed: boolean;
}

const DEFAULT_COLOR = '#0891b2';
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const normalizeColor = (color?: string): string =>
  color && HEX_RE.test(color) ? color : DEFAULT_COLOR;

const EMPTY_FORM: CategoryFormState = {
  name: '',
  method: 'llm',
  color: DEFAULT_COLOR,
  tags: [],
  blacklist: [],
  prompt: '',
  count: '',
  isNewTagAllowed: false,
};

const toFormState = (name: string, config: TagCategoryConfig): CategoryFormState => ({
  name,
  method: config.method,
  color: normalizeColor(config.color),
  tags: config.tags ?? [],
  blacklist: config.blacklist ?? [],
  prompt: config.prompt ?? '',
  count: config.count !== undefined ? String(config.count) : '',
  isNewTagAllowed: config.is_new_tag_allowed ?? false,
});

const toCategoryConfig = (form: CategoryFormState): TagCategoryConfig => {
  const config: TagCategoryConfig = { method: form.method, color: form.color };
  if (form.tags.length > 0) config.tags = form.tags;

  if (form.method !== 'manual') {
    if (form.blacklist.length > 0) config.blacklist = form.blacklist;
    if (form.count.trim()) config.count = Number(form.count);
    if (form.isNewTagAllowed) config.is_new_tag_allowed = true;
  }

  if (form.method === 'llm' && form.prompt.trim()) config.prompt = form.prompt.trim();

  return config;
};

// ─── Props ────────────────────────────────────────────────────────────────────

export interface TagGenerationConfigProps {
  canManage: boolean;
  onBack?: () => void;
  categories: TagCategories;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  saveCategories: (next: TagCategories) => Promise<void>;
  sourceType?: string;
  channelId?: string | undefined;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const TagGenerationConfig: React.FC<TagGenerationConfigProps> = ({
  canManage,
  onBack,
  categories,
  isLoading,
  isSaving,
  error,
  saveCategories,
  sourceType = 'desk-email',
  channelId,
}) => {
  const [editingName, setEditingName] = useState<string | null>(null);
  const [form, setForm] = useState<CategoryFormState | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [nameFormatError, setNameFormatError] = useState<string | null>(null);
  const [showNameSuggestions, setShowNameSuggestions] = useState(false);

  // ── Preview state ──────────────────────────────────────────────────────────
  const [testSubject, setTestSubject] = useState('');
  const [testBody, setTestBody] = useState('');
  const [previewResult, setPreviewResult] = useState<GeneratedTagPreviewItem[] | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // ── Category-name autocomplete ─────────────────────────────────────────────
  const isAdding = editingName === '__new__';
  const { catalog } = useCategoryCatalog(isAdding, sourceType);
  const nameSuggestions = isAdding
    ? catalog.filter(entry =>
        form ? entry.name.toLowerCase().includes(form.name.trim().toLowerCase()) : false,
      )
    : [];

  useEffect(() => {
    if (editingName !== null && !(editingName in categories) && editingName !== '__new__') {
      setEditingName(null);
      setForm(null);
    }
  }, [categories, editingName]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const startAdd = () => {
    setEditingName('__new__');
    setForm({ ...EMPTY_FORM });
    setLocalError(null);
    setNameFormatError(null);
  };

  const startEdit = (name: string) => {
    const config = categories[name];
    if (!config) return;
    const nextForm = toFormState(name, config);
    setEditingName(name);
    setForm(nextForm);
    setLocalError(null);
    setNameFormatError(null);
  };

  const cancelEdit = () => {
    setEditingName(null);
    setForm(null);
    setLocalError(null);
    setNameFormatError(null);
  };

  const selectCategoryName = async (entry: CategoryCatalogEntry) => {
    if (!form) return;
    setShowNameSuggestions(false);
    if (Object.keys(categories).some(k => k.toLowerCase() === entry.name.toLowerCase())) {
      setForm({ ...form, name: entry.name });
      setLocalError('A category with this name already exists');
      return;
    }
    const catalogTags = entry.tags ?? [];
    setForm({
      ...form,
      name: entry.name,
      method: entry.method,
      color: normalizeColor(entry.color ?? form.color),
      tags: catalogTags,
      blacklist: entry.blacklist ?? [],
      count: entry.count !== undefined ? String(entry.count) : form.count,
      isNewTagAllowed: entry.is_new_tag_allowed ?? form.isNewTagAllowed,
    });
    setLocalError(null);

    // Fetch all unique tag values ever used for this category and merge into Allowed Tags
    try {
      const historical = await tagsApi.getUniqueTagValues(entry.name, sourceType);
      if (historical.length > 0) {
        const merged = Array.from(new Set([...catalogTags, ...historical]));
        setForm(prev => (prev ? { ...prev, tags: merged } : prev));
      }
    } catch (err) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[TagGenerationConfig] Failed to fetch historical tag values:'),
        error: err,
      });
    }
  };

  const handleSave = async () => {
    if (!form) return;
    const trimmedName = form.name.trim();

    if (!trimmedName) {
      setLocalError('Category name is required');
      return;
    }
    if (!TAG_FORMAT_REGEX.test(trimmedName)) {
      setLocalError(`Category name ${TAG_FORMAT_MESSAGE}`);
      return;
    }
    const lowerName = trimmedName.toLowerCase();
    if (
      editingName === '__new__' &&
      Object.keys(categories).some(k => k.toLowerCase() === lowerName)
    ) {
      setLocalError('A category with this name already exists');
      return;
    }
    if (
      editingName !== '__new__' &&
      editingName !== null &&
      editingName.toLowerCase() !== lowerName &&
      Object.keys(categories).some(k => k.toLowerCase() === lowerName)
    ) {
      setLocalError('A category with this name already exists');
      return;
    }
    if (form.method === 'manual' && form.tags.length === 0) {
      setLocalError('Allowed tags are required for manual categories');
      return;
    }
    const dupAllowed = findDuplicateTags(form.tags)[0];
    if (dupAllowed) {
      setLocalError(`Tag "${dupAllowed.value}" already exists in Allowed tags`);
      return;
    }
    const dupBlacklist = findDuplicateTags(form.blacklist)[0];
    if (dupBlacklist) {
      setLocalError(`Tag "${dupBlacklist.value}" already exists in Blacklisted tags`);
      return;
    }

    const next: TagCategories = { ...categories };
    if (editingName !== '__new__' && editingName !== null && editingName !== trimmedName) {
      delete next[editingName];
    }
    next[trimmedName] = toCategoryConfig(form);

    try {
      await saveCategories(next);
      posthogService.captureActionOutcome('save_tag_category', 'success');
      cancelEdit();
    } catch {
      posthogService.captureActionOutcome('save_tag_category', 'failure');
      /* hook sets error */
    }
  };

  const handleDelete = async (name: string) => {
    const next: TagCategories = { ...categories };
    delete next[name];
    try {
      await saveCategories(next);
      posthogService.captureActionOutcome('delete_tag_category', 'success');
      if (editingName === name) cancelEdit();
    } catch {
      posthogService.captureActionOutcome('delete_tag_category', 'failure');
      /* hook sets error */
    }
  };

  // ── Preview handler ────────────────────────────────────────────────────────
  const handleRunPreview = async () => {
    if (!channelId) return;
    setPreviewResult(null);
    setPreviewError(null);
    if (!hasLlmCategories) {
      setPreviewError('At least one LLM category is required to test tag generation.');
      return;
    }
    setIsPreviewing(true);
    try {
      const tags = await tagsConfigApi.previewTagGeneration(channelId, testSubject, testBody);
      setPreviewResult(tags);
    } catch {
      setPreviewError('Tag generation preview failed. Please try again.');
    } finally {
      setIsPreviewing(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const fieldDisabled = !canManage || isSaving;
  const categoryEntries = Object.entries(categories);
  const showBlacklistAndCount = form?.method !== 'manual';
  const hasLlmCategories = Object.values(categories).some(c => c.method === 'llm');

  return (
    <div className='flex flex-col gap-[16px]'>
      {onBack && (
        <button
          type='button'
          className='text-desk-label flex items-center gap-[6px]'
          onClick={onBack}
          data-track-category='DeskSettings'
          data-track-name='BackFromTagGenerationConfig'
        >
          <ArrowLeft size={16} />
          Configure Tag Generation
        </button>
      )}

      <div className='flex flex-col gap-[2px]'>
        <div className='text-desk-label'>Tag categories</div>
        <div className='text-desk-helper'>
          Define the categories used to tag each incoming email on this channel. LLM categories
          generate tags automatically using the prompt and allowed/blacklisted tags below.
        </div>
      </div>

      {(error || localError) && (
        <div className='text-sm text-destructive'>{localError ?? error}</div>
      )}

      <div className='border border-border rounded-[10px] pt-[12px] px-[8px] pb-[16px] space-y-3 bg-background'>
        <div className='flex items-center justify-between px-[8px]'>
          <div className='text-desk-label'>Categories</div>
          {canManage && editingName === null && (
            <button
              type='button'
              className='flex items-center gap-1 text-sm text-desk-accent'
              onClick={startAdd}
              data-track-category='DeskSettings'
              data-track-name='AddTagCategory'
            >
              <Plus size={14} />
              <span>Add category</span>
            </button>
          )}
        </div>

        {isLoading && <div className='px-[8px] text-sm text-desk-helper'>Loading...</div>}

        {!isLoading && categoryEntries.length === 0 && editingName === null && (
          <div className='px-[8px] text-sm text-desk-helper'>No categories configured yet.</div>
        )}

        {categoryEntries.map(([name, config]) =>
          editingName === name ? null : (
            <div
              key={name}
              className='flex items-center justify-between gap-3 px-[8px] py-2 rounded-[10px] hover:bg-muted/30 dark:hover:bg-muted/20'
            >
              <div className='min-w-0 flex-1'>
                <div className='flex items-center gap-2 text-sm font-medium text-foreground'>
                  <span
                    className='size-2 rounded-full shrink-0'
                    style={{ backgroundColor: normalizeColor(config.color) }}
                    aria-hidden='true'
                  />
                  {name}
                </div>
                <div className='text-desk-helper truncate'>
                  {TAG_METHODS.find(m => m.value === config.method)?.label ?? config.method}
                  {config.tags?.length ? ` · ${config.tags.length} allowed tag(s)` : ''}
                  {config.blacklist?.length ? ` · ${config.blacklist.length} blacklisted` : ''}
                  {config.count !== undefined ? ` · max ${config.count}` : ''}
                </div>
              </div>
              {canManage && (
                <div className='flex items-center gap-2 shrink-0'>
                  <button
                    type='button'
                    className='text-desk-muted hover:text-foreground'
                    onClick={() => startEdit(name)}
                    disabled={editingName !== null}
                    data-track-category='DeskSettings'
                    data-track-name='EditTagCategory'
                  >
                    <Pencil size={14} />
                  </button>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    trackId='delete_tag_category'
                    className='size-auto p-0 text-desk-muted hover:bg-transparent hover:text-destructive'
                    onClick={() => void handleDelete(name)}
                    disabled={editingName !== null || isSaving}
                    data-track-category='DeskSettings'
                    data-track-name='DeleteTagCategory'
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              )}
            </div>
          ),
        )}

        {form && (
          <div className='flex flex-col gap-3 px-[8px] py-3 rounded-[10px] bg-muted/30 dark:bg-muted/20'>
            {/* Category name */}
            <div className='flex flex-col gap-[8px]'>
              <label htmlFor='tag-category-name' className='text-desk-label'>
                Category name <span className='text-red-500'>*</span>
              </label>
              <div className='relative w-full max-w-[300px]'>
                <input
                  id='tag-category-name'
                  type='text'
                  value={form.name}
                  onChange={e => {
                    const val = e.target.value;
                    setForm({ ...form, name: val });
                    const trimmed = val.trim();
                    if (trimmed && !TAG_FORMAT_REGEX.test(trimmed)) {
                      setNameFormatError(`Category name ${TAG_FORMAT_MESSAGE}`);
                    } else {
                      setNameFormatError(null);
                    }
                  }}
                  onFocus={() => setShowNameSuggestions(true)}
                  onBlur={() => setShowNameSuggestions(false)}
                  placeholder='eg. topic'
                  disabled={fieldDisabled}
                  autoComplete='off'
                  className='w-full max-w-[300px] rounded-[10px] border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-desk-helper focus:outline-none focus:ring-1 focus:ring-desk-accent disabled:opacity-50'
                  data-track-category='DeskSettings'
                  data-track-name='TagCategoryName'
                />
                {nameFormatError && <p className='mt-1 text-xs text-red-500'>{nameFormatError}</p>}
                {showNameSuggestions && nameSuggestions.length > 0 && (
                  <div className='absolute left-0 top-full z-10 mt-1 max-h-[14rem] w-full overflow-y-auto rounded-[10px] border border-border bg-background py-1 shadow-lg'>
                    {nameSuggestions.map(entry => (
                      <button
                        key={entry.name}
                        type='button'
                        onMouseDown={e => {
                          e.preventDefault();
                          void selectCategoryName(entry);
                        }}
                        className='flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-foreground hover:bg-accent'
                      >
                        <span
                          className='size-2 rounded-full'
                          style={{ backgroundColor: normalizeColor(entry.color) }}
                          aria-hidden='true'
                        />
                        {entry.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Color */}
            <div className='flex flex-col gap-[8px]'>
              <label htmlFor='tag-category-color' className='text-desk-label'>
                Color
              </label>
              <div className='flex items-center gap-3'>
                <input
                  id='tag-category-color'
                  type='color'
                  value={form.color}
                  onChange={e => setForm({ ...form, color: e.target.value })}
                  disabled={fieldDisabled}
                  className='size-8 rounded cursor-pointer disabled:opacity-50 border border-border bg-background'
                  data-track-category='DeskSettings'
                  data-track-name='TagCategoryColor'
                />
                <span className='text-xs text-desk-helper font-mono'>{form.color}</span>
              </div>
            </div>

            {/* Method */}
            <div className='flex flex-col gap-[8px]'>
              <label htmlFor='tag-category-method' className='text-desk-label'>
                Method
              </label>
              <Select
                value={form.method}
                onValueChange={value =>
                  setForm({ ...form, method: value as TagCategoryConfig['method'] })
                }
                disabled={fieldDisabled}
              >
                <SelectTrigger id='tag-category-method' className='w-full max-w-[300px]'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TAG_METHODS.map(m => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* LLM prompt */}
            {form.method === 'llm' && (
              <div className='flex flex-col gap-[8px]'>
                <label htmlFor='tag-category-prompt' className='text-desk-label'>
                  Prompt
                </label>
                <textarea
                  id='tag-category-prompt'
                  value={form.prompt}
                  onChange={e => setForm({ ...form, prompt: e.target.value })}
                  placeholder='Describe how to choose tags for this category'
                  spellCheck={false}
                  disabled={fieldDisabled}
                  className='h-[100px] w-full rounded-[10px] border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-desk-helper focus:outline-none focus:ring-1 focus:ring-desk-accent disabled:opacity-50'
                  data-track-category='DeskSettings'
                  data-track-name='TagCategoryPrompt'
                />
              </div>
            )}

            {/* Allowed tags — required for manual, optional for others */}
            <div className='flex flex-col gap-[8px]'>
              <label htmlFor='tag-category-allowed-tags' className='text-desk-label'>
                Allowed tags{' '}
                {form.method === 'manual' ? (
                  <span className='text-red-500'>*</span>
                ) : (
                  <span className='text-desk-helper'>(optional)</span>
                )}
              </label>
              <TagChipInput
                id='tag-category-allowed-tags'
                value={form.tags}
                onChange={tags => setForm({ ...form, tags })}
                onDuplicate={tag => setLocalError(`Tag "${tag}" already exists in Allowed tags`)}
                placeholder='eg. billing, login, feature-request'
                disabled={fieldDisabled}
                data-track-category='DeskSettings'
                data-track-name='TagCategoryAllowedTags'
              />
            </div>

            {/* Blacklisted tags — hidden for manual */}
            {showBlacklistAndCount && (
              <div className='flex flex-col gap-[8px]'>
                <label htmlFor='tag-category-blacklist' className='text-desk-label'>
                  Blacklisted tags <span className='text-desk-helper'>(optional)</span>
                </label>
                <TagChipInput
                  id='tag-category-blacklist'
                  value={form.blacklist}
                  onChange={blacklist => setForm({ ...form, blacklist })}
                  onDuplicate={tag =>
                    setLocalError(`Tag "${tag}" already exists in Blacklisted tags`)
                  }
                  placeholder='eg. spam'
                  disabled={fieldDisabled}
                  data-track-category='DeskSettings'
                  data-track-name='TagCategoryBlacklist'
                />
              </div>
            )}

            {/* Max tags — hidden for manual */}
            {showBlacklistAndCount && (
              <div className='flex flex-col gap-[8px]'>
                <label htmlFor='tag-category-max-tags' className='text-desk-label'>
                  Max tags <span className='text-desk-helper'>(optional)</span>
                </label>
                <input
                  id='tag-category-max-tags'
                  type='number'
                  min={1}
                  step={1}
                  value={form.count}
                  onChange={e => setForm({ ...form, count: e.target.value.replace(/[^0-9]/g, '') })}
                  onKeyDown={e => {
                    if (['.', 'e', 'E', '+', '-'].includes(e.key)) e.preventDefault();
                  }}
                  placeholder='eg. 3'
                  disabled={fieldDisabled}
                  className='w-full max-w-[120px] rounded-[10px] border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-desk-helper focus:outline-none focus:ring-1 focus:ring-desk-accent disabled:opacity-50'
                  data-track-category='DeskSettings'
                  data-track-name='TagCategoryMaxTags'
                />
              </div>
            )}

            {/* Allow new tags — hidden for manual */}
            {showBlacklistAndCount && (
              <label className='flex items-center gap-2 text-desk-label'>
                <input
                  type='checkbox'
                  checked={form.isNewTagAllowed}
                  onChange={e => setForm({ ...form, isNewTagAllowed: e.target.checked })}
                  disabled={fieldDisabled}
                  data-track-category='DeskSettings'
                  data-track-name='TagCategoryAllowNewTags'
                />
                Allow new tags to be created
              </label>
            )}

            {/* Save / Cancel */}
            <div className='flex items-center gap-2'>
              <Button
                type='button'
                variant='ghost'
                trackId='save_tag_category'
                className='h-auto rounded-[10px] bg-desk-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-desk-accent disabled:opacity-50'
                onClick={() => void handleSave()}
                disabled={fieldDisabled}
                data-track-category='DeskSettings'
                data-track-name='SaveTagCategory'
              >
                Save
              </Button>
              <button
                type='button'
                className='rounded-[10px] border border-border px-3 py-1.5 text-sm font-medium text-foreground'
                onClick={cancelEdit}
                disabled={isSaving}
                data-track-category='DeskSettings'
                data-track-name='CancelTagCategory'
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {channelId && (
        <TestClassificationForm
          title='Test tag generation'
          subjectValue={testSubject}
          onSubjectChange={setTestSubject}
          bodyValue={testBody}
          onBodyChange={setTestBody}
          isPreviewing={isPreviewing}
          onRunPreview={() => void handleRunPreview()}
        >
          {previewError && <div className='text-sm text-destructive'>{previewError}</div>}
          {previewResult !== null && previewResult.length === 0 && (
            <div className='text-sm text-desk-helper'>No tags generated for this email.</div>
          )}
          {previewResult !== null && previewResult.length > 0 && (
            <div className='flex flex-col gap-[8px]'>
              {Object.entries(
                previewResult.reduce<Record<string, GeneratedTagPreviewItem[]>>((acc, item) => {
                  (acc[item.category] ??= []).push(item);
                  return acc;
                }, {}),
              ).map(([category, items]) => (
                <div key={category} className='flex flex-wrap items-center gap-[6px]'>
                  <CategoryLabel name={category} color={categories[category]?.color} />
                  {items.map(item => (
                    <TagChip
                      key={`${item.category}:${item.tag}`}
                      tag={item.tag}
                      color={categories[item.category]?.color}
                      reason={item.reason}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </TestClassificationForm>
      )}
    </div>
  );
};
