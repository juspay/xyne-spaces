import React, { useState, useMemo } from 'react';
import type {
  TicketClassificationData,
  ClassificationMapping,
} from '../../../types/classification';
import { classificationApi } from '../../../api/classificationApi';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/Select/Select';
import { Button } from '../../ui/Button/Button';

interface UserGroupOption {
  id: string;
  name: string;
}

interface AIClassificationPanelProps {
  ticketId: string;
  channelId: string;
  classificationData: TicketClassificationData;
  userGroups: UserGroupOption[];
  hasFormFields?: boolean;
  onOverride?: (newGroupId: string) => void;
}

export const AIClassificationPanel: React.FC<AIClassificationPanelProps> = ({
  ticketId,
  channelId,
  classificationData,
  userGroups,
  hasFormFields = false,
  onOverride,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const [mappingRows] = useCachedQuery(queries.getClassificationMappings({ channelId }), {
    enabled: !!channelId && isExpanded,
  });
  const mappings: ClassificationMapping[] = useMemo(
    () => (mappingRows ?? []) as ClassificationMapping[],
    [mappingRows],
  );
  const [editCategory, setEditCategory] = useState('');
  const [editSubCategory, setEditSubCategory] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editingFieldValue, setEditingFieldValue] = useState('');
  const [savingField, setSavingField] = useState(false);

  const { category, subCategory, resolvedGroupId, isManualOverride, rawOutput } =
    classificationData;
  const resolvedGroupName =
    userGroups.find(g => g.id === resolvedGroupId)?.name ?? resolvedGroupId ?? '—';

  // Unique categories from mappings
  const categoryOptions = useMemo(() => [...new Set(mappings.map(m => m.category))], [mappings]);

  // Sub-categories for the selected category (non-null only)
  const subCategoryOptions = useMemo(
    () =>
      mappings
        .filter(m => m.category === editCategory && m.subCategory)
        .map(m => m.subCategory as string),
    [mappings, editCategory],
  );

  const handleStartEdit = () => {
    setEditCategory(category);
    setEditSubCategory(subCategory ?? '');
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (!editCategory.trim()) return;
    setIsSaving(true);
    try {
      const result = await classificationApi.overrideClassificationValues(
        channelId,
        ticketId,
        editCategory.trim(),
        editSubCategory.trim() || null,
      );
      onOverride?.(result.resolvedGroupId ?? '');
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveField = async (fieldName: string) => {
    setSavingField(true);
    try {
      await classificationApi.patchRawField(channelId, ticketId, fieldName, editingFieldValue);
      setEditingField(null);
    } finally {
      setSavingField(false);
    }
  };

  const summaryRaw = rawOutput['summary'];
  const summary: string | null =
    typeof summaryRaw === 'string'
      ? summaryRaw
      : typeof summaryRaw === 'number'
        ? String(summaryRaw)
        : typeof summaryRaw === 'boolean'
          ? String(summaryRaw)
          : null;

  const rawFields: [string, string][] = Object.entries(rawOutput)
    .filter(
      ([k, v]) =>
        k !== 'summary' &&
        k !== 'parse_reason' &&
        v !== null &&
        v !== undefined &&
        v !== 'null' &&
        v !== '',
    )
    .map(([k, v]) => [k, String(v)]);

  return (
    <div className='rounded-md border border-border overflow-hidden'>
      {/* Header */}
      <button
        onClick={() => setIsExpanded(v => !v)}
        className='w-full flex items-center justify-between px-3 py-2.5 bg-muted/40 hover:bg-muted/60 transition-colors text-left'
        data-track-category='AIClassification'
        data-track-name='TogglePanel'
      >
        <div className='flex items-center gap-2'>
          <span className='text-sm font-medium'>AI Classification</span>
          {isManualOverride && (
            <span className='text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700'>
              Manually overridden
            </span>
          )}
        </div>
        <span className='text-muted-foreground text-xs'>{isExpanded ? '▲' : '▼'}</span>
      </button>

      {isExpanded && (
        <div className='p-3 space-y-3'>
          {/* Routing summary — Category / Sub-Category / Assigned Group */}
          {!isEditing ? (
            <div className='grid grid-cols-3 gap-3'>
              <div className='space-y-0.5'>
                <div className='text-xs text-muted-foreground'>Category</div>
                <div className='text-sm font-medium'>{category}</div>
              </div>
              <div className='space-y-0.5'>
                <div className='text-xs text-muted-foreground'>Sub-Category</div>
                <div className='text-sm'>{subCategory ?? '—'}</div>
              </div>
              <div className='space-y-0.5'>
                <div className='text-xs text-muted-foreground'>Assigned Group</div>
                <div className='text-sm font-medium text-primary'>{resolvedGroupName}</div>
              </div>
            </div>
          ) : (
            <div className='space-y-2'>
              <div className='grid grid-cols-2 gap-2'>
                <div className='space-y-1'>
                  <label htmlFor='ai-edit-category' className='text-xs text-muted-foreground'>
                    Category
                  </label>
                  {categoryOptions.length > 0 ? (
                    <Select
                      value={editCategory}
                      onValueChange={v => {
                        setEditCategory(v);
                        setEditSubCategory('');
                      }}
                    >
                      <SelectTrigger size='sm' className='w-full'>
                        <SelectValue placeholder='Select category' />
                      </SelectTrigger>
                      <SelectContent>
                        {categoryOptions.map(c => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <input
                      id='ai-edit-category'
                      className='w-full rounded border border-border bg-background px-2 py-1 text-sm'
                      value={editCategory}
                      onChange={e => {
                        setEditCategory(e.target.value);
                        setEditSubCategory('');
                      }}
                      placeholder='e.g. Feature Request'
                      data-track-category='AIClassification'
                      data-track-name='EditCategoryInput'
                    />
                  )}
                </div>
                <div className='space-y-1'>
                  <label htmlFor='ai-edit-subcategory' className='text-xs text-muted-foreground'>
                    Sub-Category
                  </label>
                  {subCategoryOptions.length > 0 ? (
                    <Select
                      value={editSubCategory || '__none__'}
                      onValueChange={v => setEditSubCategory(v === '__none__' ? '' : v)}
                    >
                      <SelectTrigger size='sm' className='w-full'>
                        <SelectValue placeholder='— none —' />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='__none__'>— none —</SelectItem>
                        {subCategoryOptions.map(s => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <input
                      id='ai-edit-subcategory'
                      className='w-full rounded border border-border bg-background px-2 py-1 text-sm'
                      value={editSubCategory}
                      onChange={e => setEditSubCategory(e.target.value)}
                      placeholder='optional'
                      data-track-category='AIClassification'
                      data-track-name='EditSubCategoryInput'
                    />
                  )}
                </div>
              </div>
              <div className='flex gap-2'>
                <Button
                  trackAction={() => handleSave()}
                  trackId='save_classification_override'
                  disabled={isSaving || !editCategory}
                  variant='ghost'
                  className='text-xs px-3 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50'
                  data-track-category='AIClassification'
                  data-track-name='SaveClassificationOverride'
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </Button>
                <button
                  onClick={() => {
                    setIsEditing(false);
                  }}
                  className='text-xs px-3 py-1 rounded border border-border hover:bg-muted'
                  data-track-category='AIClassification'
                  data-track-name='CancelClassificationEdit'
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* AI Summary */}
          {summary && (
            <div className='rounded bg-muted/50 p-2.5 text-xs text-muted-foreground'>
              <span className='font-medium text-foreground'>Summary: </span>
              {summary}
            </div>
          )}

          {/* Raw AI fields — only shown when no Additional Form Fields are configured */}
          {!hasFormFields && rawFields.length > 0 && (
            <div className='grid grid-cols-2 gap-x-6 gap-y-0.5 text-sm'>
              {rawFields.map(([key, value]) => (
                <React.Fragment key={key}>
                  <span className='text-muted-foreground py-1'>{key}</span>
                  {editingField === key ? (
                    <div className='flex items-center gap-1 py-0.5'>
                      <input
                        autoFocus
                        className='flex-1 rounded border border-border bg-background px-2 py-0.5 text-sm'
                        value={editingFieldValue}
                        onChange={e => setEditingFieldValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') void handleSaveField(key);
                          if (e.key === 'Escape') setEditingField(null);
                        }}
                        data-track-category='AIClassification'
                        data-track-name='RawFieldInput'
                      />
                      <Button
                        trackAction={() => handleSaveField(key)}
                        trackId='save_raw_classification_field'
                        disabled={savingField}
                        variant='ghost'
                        className='text-xs px-2 py-0.5 rounded bg-primary text-primary-foreground disabled:opacity-50'
                        data-track-category='AIClassification'
                        data-track-name='SaveRawField'
                      >
                        {savingField ? '…' : '✓'}
                      </Button>
                      <button
                        onClick={() => setEditingField(null)}
                        className='text-xs px-2 py-0.5 rounded border border-border hover:bg-muted'
                        data-track-category='AIClassification'
                        data-track-name='CancelRawFieldEdit'
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <button
                      type='button'
                      className='py-1 break-words text-left cursor-pointer hover:text-primary group flex items-center gap-1 w-full'
                      onClick={() => {
                        setEditingField(key);
                        setEditingFieldValue(value);
                      }}
                      data-track-category='AIClassification'
                      data-track-name='EditRawField'
                    >
                      {value}
                      <span className='opacity-0 group-hover:opacity-50 text-xs'>✎</span>
                    </button>
                  )}
                </React.Fragment>
              ))}
            </div>
          )}

          {!isEditing && (
            <button
              onClick={handleStartEdit}
              className='text-xs text-muted-foreground hover:text-foreground underline'
              data-track-category='AIClassification'
              data-track-name='StartClassificationEdit'
            >
              Edit classification
            </button>
          )}
        </div>
      )}
    </div>
  );
};
