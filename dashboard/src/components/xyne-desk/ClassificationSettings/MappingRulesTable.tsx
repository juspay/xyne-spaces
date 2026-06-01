import React, { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/Select';
import type {
  ClassificationMapping,
  SaveMappingPayload,
  UserGroupOption,
} from '../../../types/classification';

interface MappingRulesTableProps {
  mappings: ClassificationMapping[];
  userGroups: UserGroupOption[];
  onAdd: (payload: SaveMappingPayload) => Promise<void>;
  onUpdate: (mappingId: string, payload: Partial<SaveMappingPayload>) => Promise<void>;
  onDelete: (mappingId: string) => Promise<void>;
}

const EMPTY_FORM: SaveMappingPayload = {
  category: '',
  subCategory: '',
  userGroupId: '',
};

export const MappingRulesTable: React.FC<MappingRulesTableProps> = ({
  mappings,
  userGroups,
  onAdd,
  onUpdate,
  onDelete,
}) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<SaveMappingPayload>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<SaveMappingPayload>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAdd = async () => {
    if (!addForm.category || !addForm.userGroupId) return;
    setIsSubmitting(true);
    try {
      await onAdd({
        ...addForm,
        subCategory: addForm.subCategory || null,
      });
      setAddForm(EMPTY_FORM);
      setShowAddForm(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdate = async (mappingId: string) => {
    setIsSubmitting(true);
    try {
      await onUpdate(mappingId, editForm);
      setEditingId(null);
      setEditForm({});
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (mappingId: string) => {
    if (!confirm('Delete this mapping rule?')) return;
    await onDelete(mappingId);
  };

  const startEdit = (mapping: ClassificationMapping) => {
    setEditingId(mapping.id);
    setEditForm({
      category: mapping.category,
      subCategory: mapping.subCategory ?? '',
      userGroupId: mapping.userGroupId,
    });
  };

  return (
    <div className='space-y-3 text-foreground'>
      <div className='text-sm font-medium text-foreground'>Assignment Rules</div>

      {/* Table */}
      <div className='rounded-md border border-border overflow-hidden'>
        <table className='w-full text-sm'>
          <thead className='bg-muted/50'>
            <tr>
              <th className='px-3 py-2 text-left font-medium text-muted-foreground'>Category</th>
              <th className='px-3 py-2 text-left font-medium text-muted-foreground'>
                Sub-Category <span className='font-normal'>(optional)</span>
              </th>
              <th className='px-3 py-2 text-left font-medium text-muted-foreground'>User Group</th>
              <th className='px-3 py-2 w-20' />
            </tr>
          </thead>
          <tbody>
            {mappings.length === 0 && (
              <tr>
                <td colSpan={4} className='px-3 py-4 text-center text-muted-foreground text-sm'>
                  No rules yet. Add one below.
                </td>
              </tr>
            )}
            {mappings.map(mapping => (
              <tr key={mapping.id} className='border-t border-border'>
                {editingId === mapping.id ? (
                  <>
                    <td className='px-3 py-2'>
                      <input
                        className='w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground'
                        value={editForm.category ?? ''}
                        onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))}
                        placeholder='e.g. Feature Request'
                        data-track-category='MappingRules'
                        data-track-name='EditCategoryInput'
                      />
                    </td>
                    <td className='px-3 py-2'>
                      <input
                        className='w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground'
                        value={editForm.subCategory ?? ''}
                        onChange={e => setEditForm(f => ({ ...f, subCategory: e.target.value }))}
                        placeholder='e.g. UPI, mWeb Intent (empty = catch-all)'
                        data-track-category='MappingRules'
                        data-track-name='EditSubCategoryInput'
                      />
                    </td>
                    <td className='px-3 py-2'>
                      <Select
                        value={editForm.userGroupId ?? ''}
                        onValueChange={v => setEditForm(f => ({ ...f, userGroupId: v }))}
                      >
                        <SelectTrigger className='w-full'>
                          <SelectValue placeholder='Select group' />
                        </SelectTrigger>
                        <SelectContent>
                          {userGroups.map(g => (
                            <SelectItem key={g.id} value={g.id}>
                              {g.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className='px-3 py-2 flex gap-1'>
                      <button
                        onClick={() => void handleUpdate(mapping.id)}
                        disabled={isSubmitting}
                        className='text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90'
                        data-track-category='MappingRules'
                        data-track-name='SaveMappingEdit'
                      >
                        Save
                      </button>
                      <button
                        onClick={() => {
                          setEditingId(null);
                          setEditForm({});
                        }}
                        className='text-xs px-2 py-1 rounded border border-border hover:bg-muted text-foreground'
                        data-track-category='MappingRules'
                        data-track-name='CancelMappingEdit'
                      >
                        Cancel
                      </button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className='px-3 py-2 text-foreground'>{mapping.category}</td>
                    <td className='px-3 py-2 text-muted-foreground'>
                      {mapping.subCategory || <span className='italic text-xs'>catch-all</span>}
                    </td>
                    <td className='px-3 py-2 text-foreground'>
                      {userGroups.find(g => g.id === mapping.userGroupId)?.name ??
                        mapping.userGroupId}
                    </td>
                    <td className='px-3 py-2 flex gap-1'>
                      <button
                        onClick={() => startEdit(mapping)}
                        className='text-xs px-2 py-1 rounded border border-border hover:bg-muted text-foreground'
                        data-track-category='MappingRules'
                        data-track-name='StartMappingEdit'
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => void handleDelete(mapping.id)}
                        className='text-xs px-2 py-1 rounded text-destructive hover:bg-destructive/10'
                        data-track-category='MappingRules'
                        data-track-name='DeleteMapping'
                      >
                        Delete
                      </button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add row form */}
      {showAddForm && (
        <div className='rounded-md border border-border p-3 space-y-3 bg-muted/30'>
          <div className='text-sm font-medium'>New Rule</div>
          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-1'>
              <label htmlFor='mapping-add-category' className='text-xs text-muted-foreground'>
                Category *
              </label>
              <input
                id='mapping-add-category'
                className='w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground'
                placeholder='e.g. Feature Request'
                value={addForm.category}
                onChange={e => setAddForm(f => ({ ...f, category: e.target.value }))}
                data-track-category='MappingRules'
                data-track-name='AddCategoryInput'
              />
            </div>
            <div className='space-y-1'>
              <label htmlFor='mapping-add-subcategory' className='text-xs text-muted-foreground'>
                Sub-Category (optional, empty = catch-all)
              </label>
              <input
                id='mapping-add-subcategory'
                className='w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground'
                placeholder='e.g. UPI, mWeb Intent, UPI QR'
                value={addForm.subCategory ?? ''}
                onChange={e => setAddForm(f => ({ ...f, subCategory: e.target.value }))}
                data-track-category='MappingRules'
                data-track-name='AddSubCategoryInput'
              />
            </div>
            <div className='space-y-1 col-span-2'>
              <label htmlFor='mapping-add-usergroup' className='text-xs text-muted-foreground'>
                User Group *
              </label>
              <Select
                value={addForm.userGroupId || ''}
                onValueChange={v => setAddForm(f => ({ ...f, userGroupId: v }))}
              >
                <SelectTrigger id='mapping-add-usergroup' className='w-full'>
                  <SelectValue placeholder='Select group' />
                </SelectTrigger>
                <SelectContent>
                  {userGroups.map(g => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className='flex gap-2'>
            <button
              onClick={() => void handleAdd()}
              disabled={isSubmitting || !addForm.category || !addForm.userGroupId}
              className='text-sm px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50'
              data-track-category='MappingRules'
              data-track-name='AddMappingRule'
            >
              {isSubmitting ? 'Adding...' : 'Add Rule'}
            </button>
            <button
              onClick={() => {
                setShowAddForm(false);
                setAddForm(EMPTY_FORM);
              }}
              className='text-sm px-3 py-1.5 rounded border border-border hover:bg-muted text-foreground'
              data-track-category='MappingRules'
              data-track-name='CancelAddMapping'
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!showAddForm && (
        <button
          onClick={() => setShowAddForm(true)}
          className='text-sm px-3 py-1.5 rounded border border-dashed border-border hover:bg-muted text-muted-foreground hover:text-foreground'
          data-track-category='MappingRules'
          data-track-name='ShowAddMappingForm'
        >
          + Add Rule
        </button>
      )}
    </div>
  );
};
