import React, { useState, useCallback } from 'react';
import { Pencil, X, Plus, Check, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { updateItemTags } from '../../../services/Knowledge/collectionService';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../../ui/dropdown-menu';
import Tooltip from '../../ui/Tooltip';
import { cn } from '../../../utils/classNames';

export interface ExtractedEntityTags {
  people: string[];
  productSpecifications: string[];
  merchants: string[];
}

interface TagCategoryConfig {
  key: keyof ExtractedEntityTags;
  label: string;
  bgColor: string;
  textColor: string;
}

const TAG_CATEGORIES: TagCategoryConfig[] = [
  { key: 'people', label: 'People', bgColor: 'bg-blue-100', textColor: 'text-blue-700' },
  { key: 'merchants', label: 'Merchant', bgColor: 'bg-green-100', textColor: 'text-green-700' },
  {
    key: 'productSpecifications',
    label: 'Product Specs',
    bgColor: 'bg-purple-100',
    textColor: 'text-purple-700',
  },
];

interface EntityTagsEditorProps {
  itemId: string;
  entityTags: ExtractedEntityTags | undefined;
  onUpdate?: (newTags: ExtractedEntityTags) => void;
  readOnly?: boolean;
}

/**
 * Entity Tags Editor Component
 * Displays tags with edit capability - clicking a tag opens a dropdown to edit/delete/add tags
 */
export const EntityTagsEditor: React.FC<EntityTagsEditorProps> = ({
  itemId,
  entityTags,
  onUpdate,
  readOnly = false,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [localTags, setLocalTags] = useState<ExtractedEntityTags>(
    entityTags || { people: [], productSpecifications: [], merchants: [] },
  );
  const [isSaving, setIsSaving] = useState(false);
  const [openCategory, setOpenCategory] = useState<string | null>(null);

  // Check if there are any tags
  const hasAnyTags =
    entityTags &&
    (entityTags.people.length > 0 ||
      entityTags.productSpecifications.length > 0 ||
      entityTags.merchants.length > 0);

  // Sync local tags when props change
  React.useEffect(() => {
    if (entityTags) {
      setLocalTags(entityTags);
    }
  }, [entityTags]);

  const handleAddTag = useCallback((category: keyof ExtractedEntityTags, tag: string) => {
    const trimmedTag = tag.trim();
    if (!trimmedTag) return;

    setLocalTags(prev => ({
      ...prev,
      [category]: [...(prev[category] || []), trimmedTag],
    }));
  }, []);

  const handleRemoveTag = useCallback((category: keyof ExtractedEntityTags, tagIndex: number) => {
    setLocalTags(prev => ({
      ...prev,
      [category]: prev[category].filter((_, i) => i !== tagIndex),
    }));
  }, []);

  const handleEditTag = useCallback(
    (category: keyof ExtractedEntityTags, tagIndex: number, newValue: string) => {
      setLocalTags(prev => ({
        ...prev,
        [category]: prev[category].map((tag, i) => (i === tagIndex ? newValue : tag)),
      }));
    },
    [],
  );

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateItemTags(itemId, localTags);
      toast.success('Tags updated successfully');
      setIsEditing(false);
      onUpdate?.(localTags);
    } catch (error) {
      console.error('Failed to update tags:', error);
      toast.error('Failed to update tags. Please try again.');
      // Reset to original tags on error
      setLocalTags(entityTags || { people: [], productSpecifications: [], merchants: [] });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setLocalTags(entityTags || { people: [], productSpecifications: [], merchants: [] });
    setIsEditing(false);
    setOpenCategory(null);
  };

  const handleStartEdit = () => {
    setLocalTags(entityTags || { people: [], productSpecifications: [], merchants: [] });
    setIsEditing(true);
  };

  // If no tags and not editing, show nothing or placeholder
  if (!hasAnyTags && !isEditing) {
    if (readOnly) return null;
    return (
      <button
        onClick={handleStartEdit}
        className='flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors'
        data-track-category='knowledge-base'
        data-track-name='edit-tags'
      >
        <Plus size={12} />
        <span>Add tags</span>
      </button>
    );
  }

  // Read-only mode
  if (readOnly) {
    return (
      <div className='flex flex-wrap gap-1'>
        {TAG_CATEGORIES.map(category => {
          const tags = entityTags?.[category.key] || [];
          if (tags.length === 0) return null;
          return (
            <span
              key={category.key}
              className={cn(
                'px-1.5 py-0.5 rounded text-xs cursor-default',
                category.bgColor,
                category.textColor,
              )}
              title={tags.join(', ')}
            >
              {category.label}
            </span>
          );
        })}
      </div>
    );
  }

  // Editing mode - show dropdowns for each category
  if (isEditing) {
    return (
      <div className='flex flex-col gap-2'>
        <div className='flex flex-wrap gap-1 items-center'>
          {TAG_CATEGORIES.map(category => (
            <DropdownMenu
              key={category.key}
              open={openCategory === category.key}
              onOpenChange={open => setOpenCategory(open ? category.key : null)}
            >
              <DropdownMenuTrigger asChild>
                <button
                  className={cn(
                    'flex items-center gap-1 px-1.5 py-0.5 rounded text-xs transition-colors',
                    category.bgColor,
                    category.textColor,
                    'hover:opacity-80',
                  )}
                >
                  <span>{category.label}</span>
                  <span className='font-medium'>({localTags[category.key]?.length || 0})</span>
                  <ChevronDown size={10} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='start' className='w-56 p-2'>
                <TagCategoryEditor
                  category={category}
                  tags={localTags[category.key] || []}
                  onAddTag={handleAddTag}
                  onRemoveTag={handleRemoveTag}
                  onEditTag={handleEditTag}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          ))}
        </div>
        <div className='flex items-center gap-2'>
          <button
            onClick={() => {
              void handleSave();
            }}
            disabled={isSaving}
            className='flex items-center gap-1 px-2 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50'
            data-track-category='knowledge-base'
            data-track-name='save-tags'
          >
            <Check size={12} />
            {isSaving ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={handleCancel}
            disabled={isSaving}
            className='flex items-center gap-1 px-2 py-1 text-xs border border-border rounded hover:bg-muted disabled:opacity-50'
            data-track-category='knowledge-base'
            data-track-name='cancel-edit-tags'
          >
            <X size={12} />
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // Display mode with edit button
  return (
    <div className='flex flex-wrap gap-1 items-center'>
      {TAG_CATEGORIES.map(category => {
        const tags = entityTags?.[category.key] || [];
        if (tags.length === 0) return null;
        return (
          <Tooltip
            key={category.key}
            content={
              <div className='space-y-0.5'>
                {tags.map((tag, index) => (
                  <div key={index} className='text-xs'>
                    {tag}
                  </div>
                ))}
              </div>
            }
            side='top'
            delayDuration={200}
          >
            <span
              className={cn(
                'px-1.5 py-0.5 rounded text-xs cursor-default',
                category.bgColor,
                category.textColor,
              )}
            >
              {category.label}
            </span>
          </Tooltip>
        );
      })}
      <button
        onClick={handleStartEdit}
        className='p-1 rounded hover:bg-muted transition-colors'
        title='Edit tags'
        data-track-category='knowledge-base'
        data-track-name='edit-tags'
      >
        <Pencil size={12} className='text-muted-foreground' />
      </button>
    </div>
  );
};

/**
 * Tag Category Editor - Dropdown content for editing a single category
 */
interface TagCategoryEditorProps {
  category: TagCategoryConfig;
  tags: string[];
  onAddTag: (category: keyof ExtractedEntityTags, tag: string) => void;
  onRemoveTag: (category: keyof ExtractedEntityTags, tagIndex: number) => void;
  onEditTag: (category: keyof ExtractedEntityTags, tagIndex: number, newValue: string) => void;
}

const TagCategoryEditor: React.FC<TagCategoryEditorProps> = ({
  category,
  tags,
  onAddTag,
  onRemoveTag,
  onEditTag,
}) => {
  const [newTag, setNewTag] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState('');

  const handleAdd = () => {
    if (newTag.trim() && !tags.includes(newTag.trim())) {
      onAddTag(category.key, newTag.trim());
      setNewTag('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  const handleStartEdit = (index: number, currentValue: string) => {
    setEditingIndex(index);
    setEditingValue(currentValue);
  };

  const handleSaveEdit = () => {
    const trimmedValue = editingValue.trim();
    if (trimmedValue && trimmedValue !== tags[editingIndex!]) {
      // Check for duplicates (excluding the current tag being edited)
      const otherTags = tags.filter((_, i) => i !== editingIndex);
      if (!otherTags.includes(trimmedValue)) {
        onEditTag(category.key, editingIndex!, trimmedValue);
      }
    }
    setEditingIndex(null);
    setEditingValue('');
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
    setEditingValue('');
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancelEdit();
    }
  };

  return (
    <div className='space-y-2'>
      <div className='text-xs font-medium text-muted-foreground mb-1'>{category.label}</div>

      {/* Existing tags */}
      {tags.length > 0 && (
        <div className='flex flex-wrap gap-1 mb-2'>
          {tags.map((tag, index) => (
            <span
              key={`${tag}-${index}`}
              className={cn(
                'flex items-center gap-1 px-1.5 py-0.5 rounded text-xs',
                category.bgColor,
                category.textColor,
              )}
            >
              {editingIndex === index ? (
                <input
                  type='text'
                  value={editingValue}
                  onChange={e => setEditingValue(e.target.value)}
                  onKeyDown={handleEditKeyDown}
                  onBlur={handleSaveEdit}
                  className='px-1 py-0.5 text-xs border border-primary rounded focus:outline-none bg-white min-w-[60px] max-w-[150px]'
                  style={{ width: `${Math.max(60, editingValue.length * 7)}px` }}
                  data-track-category='knowledge-base'
                  data-track-name='edit-tag-input'
                />
              ) : (
                <>
                  <button
                    className='cursor-pointer hover:underline break-all bg-transparent border-0 p-0 text-inherit'
                    onClick={() => handleStartEdit(index, tag)}
                    title={`Click to edit: ${tag}`}
                    type='button'
                    data-track-category='knowledge-base'
                    data-track-name='edit-tag'
                  >
                    {tag}
                  </button>
                  <button
                    onClick={() => onRemoveTag(category.key, index)}
                    className='hover:opacity-70 flex-shrink-0 bg-transparent border-0 p-0'
                    title='Delete'
                    type='button'
                    data-track-category='knowledge-base'
                    data-track-name='remove-tag'
                  >
                    <X size={10} />
                  </button>
                </>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Add new tag input */}
      <div className='flex items-center gap-1'>
        <input
          type='text'
          value={newTag}
          onChange={e => setNewTag(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder='Add tag...'
          className='flex-1 px-2 py-1 text-xs border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary'
          data-track-category='knowledge-base'
          data-track-name='add-tag-input'
        />
        <button
          onClick={handleAdd}
          disabled={!newTag.trim() || tags.includes(newTag.trim())}
          className='p-1 rounded hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed'
          type='button'
          data-track-category='knowledge-base'
          data-track-name='add-tag'
        >
          <Plus size={14} />
        </button>
      </div>

      {tags.length === 0 && (
        <div className='text-xs text-muted-foreground text-center py-1'>No tags yet</div>
      )}
    </div>
  );
};

export default EntityTagsEditor;
