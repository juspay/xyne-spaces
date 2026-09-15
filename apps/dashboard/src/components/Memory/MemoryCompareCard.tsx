import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { MemoryDocument, MemoryUpdateRequest } from '../../types/memory';
import { RenderMessageWithHTML } from '../Chat/RenderMessageWithHTML/RenderMessageWithHTML';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Pencil, Trash2, Check, X } from 'lucide-react';

const markdownPlugins = [remarkGfm];

/** Clean raw chatSummary strings before rendering as Markdown */
const sanitizeMarkdown = (raw: string): string => {
  // Convert literal \n into real newlines
  return raw.replace(/\\n/g, '\n');
};

/** Textarea that auto-resizes to fit its content */
const AutoResizeTextarea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = props => {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = 'auto';
      ref.current.style.height = `${ref.current.scrollHeight}px`;
    }
  }, [props.value]);

  return (
    <textarea
      {...props}
      ref={ref}
      onInput={e => {
        const target = e.target as HTMLTextAreaElement;
        target.style.height = 'auto';
        target.style.height = `${target.scrollHeight}px`;
      }}
      data-track-category='Memory'
      data-track-name='AutoResizeTextarea'
    />
  );
};

const formatTimestamp = (timestamp: number): string => {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleString('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

interface MemoryCompareCardProps {
  document: MemoryDocument;
  onRemove: () => void;
  onUpdate?: ((docId: string, fields: MemoryUpdateRequest) => void) | undefined;
  onDelete?: ((docId: string) => void) | undefined;
  isUpdating?: boolean | undefined;
  isDeleting?: boolean | undefined;
}

type EditableField =
  | 'userQuery'
  | 'rawContent'
  | 'tags'
  | 'filePointers'
  | 'commitId'
  | 'reviewStatus';

/** Get the string representation of a field for editing */
const getFieldEditValue = (doc: MemoryDocument, field: EditableField): string => {
  switch (field) {
    case 'userQuery':
      return doc.userQuery || '';
    case 'rawContent':
      return doc.rawContent || '';
    case 'tags':
      return doc.tags?.join(', ') || '';
    case 'filePointers':
      return doc.filePointers?.join('\n') || '';
    case 'commitId':
      return doc.commitId || '';
    case 'reviewStatus':
      return doc.reviewStatus || '';
  }
};

/** Convert a single field edit value to MemoryUpdateRequest */
const fieldToUpdateRequest = (field: EditableField, value: string): MemoryUpdateRequest => {
  switch (field) {
    case 'userQuery':
      return { userQuery: value || undefined };
    case 'rawContent':
      return { rawContent: value || undefined };
    case 'tags':
      return {
        tags: value
          ? value
              .split(',')
              .map(s => s.trim())
              .filter(Boolean)
          : [],
      };
    case 'filePointers':
      return {
        filePointers: value
          ? value
              .split('\n')
              .map(s => s.trim())
              .filter(Boolean)
          : [],
      };
    case 'commitId':
      return { commitId: value || undefined };
    case 'reviewStatus':
      return { reviewStatus: value || undefined };
  }
};

const MemoryCompareCard: React.FC<MemoryCompareCardProps> = ({
  document: doc,
  onRemove,
  onUpdate,
  onDelete,
  isUpdating = false,
  isDeleting = false,
}) => {
  const { t } = useTranslation('placeholders');
  const { t: tc } = useTranslation('common');
  const [editingField, setEditingField] = useState<EditableField | null>(null);
  const [editValue, setEditValue] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const startEdit = useCallback(
    (field: EditableField) => {
      setEditValue(getFieldEditValue(doc, field));
      setEditingField(field);
    },
    [doc],
  );

  const cancelEdit = useCallback(() => {
    setEditingField(null);
    setEditValue('');
  }, []);

  const saveEdit = useCallback(() => {
    if (onUpdate && editingField) {
      onUpdate(doc.docId, fieldToUpdateRequest(editingField, editValue));
      setEditingField(null);
      setEditValue('');
    }
  }, [doc.docId, editingField, editValue, onUpdate]);

  const handleDelete = useCallback(() => {
    if (onDelete) {
      onDelete(doc.docId);
    }
  }, [doc.docId, onDelete]);

  const inputClass =
    'w-full text-sm bg-muted/50 rounded px-3 py-2 border border-border focus:outline-none focus:ring-1 focus:ring-blue-500 text-foreground';
  const textareaClass = `${inputClass} resize-y min-h-[60px]`;
  const labelClass = 'text-xs font-semibold text-muted-foreground uppercase tracking-wider';

  return (
    <div className='flex flex-col h-full border border-border rounded-lg bg-background overflow-hidden'>
      {/* Card Header */}
      <div className='flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30'>
        <div className='flex items-center gap-2 min-w-0'>
          <span
            className={`px-2 py-0.5 text-xs font-semibold rounded flex-shrink-0 ${
              doc.docType === 'fact'
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                : 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300'
            }`}
          >
            {doc.docType}
          </span>
          <span className='text-xs font-mono text-muted-foreground truncate'>{doc.docId}</span>
        </div>
        <div className='flex items-center gap-1 flex-shrink-0 ml-2'>
          {onDelete && !showDeleteConfirm && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className='p-1 text-muted-foreground hover:text-red-600 hover:bg-red-100 dark:hover:bg-red-950 rounded transition-colors'
              title={tc('memory.compareCard.deleteDocumentTooltip')}
              data-track-category='Memory'
              data-track-name='ShowDeleteConfirm'
            >
              <Trash2 size={14} />
            </button>
          )}
          {showDeleteConfirm && (
            <div className='flex items-center gap-1'>
              <span className='text-xs text-red-600'>
                {tc('memory.compareCard.deleteQuestion')}
              </span>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className='h-auto p-1 text-red-600 hover:bg-red-100 dark:hover:bg-red-950 rounded transition-colors disabled:opacity-50'
                title={tc('memory.compareCard.confirmDeleteTooltip')}
                data-ph-capture-attribute-track-id='memory_confirm_delete_document'
                data-track-category='Memory'
                data-track-name='ConfirmDeleteDocument'
              >
                <Check size={14} />
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className='p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors'
                title={tc('memory.compareCard.cancelDeleteTooltip')}
                data-track-category='Memory'
                data-track-name='CancelDeleteDocument'
              >
                <X size={14} />
              </button>
            </div>
          )}
          <button
            onClick={onRemove}
            className='p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors'
            title={tc('memory.compareCard.removeFromCompareTooltip')}
            data-track-category='Memory'
            data-track-name='RemoveFromCompare'
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Loading indicator */}
      {(isUpdating || isDeleting) && (
        <div className='px-4 py-2 bg-blue-50 dark:bg-blue-950/30 border-b border-border'>
          <span className='text-xs text-blue-600 dark:text-blue-400'>
            {isUpdating ? tc('memory.compareCard.saving') : tc('memory.compareCard.deleting')}
          </span>
        </div>
      )}

      {/* Scrollable Content */}
      <div className='flex-1 overflow-auto p-4 space-y-4'>
        {/* User Query */}
        <EditableSection
          label={tc('memory.compareCard.userQueryLabel')}
          trackId='UserQuery'
          labelClass={labelClass}
          isFieldEditing={editingField === 'userQuery'}
          canEdit={!!onUpdate}
          onStartEdit={() => startEdit('userQuery')}
          onSave={saveEdit}
          onCancel={cancelEdit}
          isUpdating={isUpdating}
          editContent={
            <AutoResizeTextarea
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              className={textareaClass}
            />
          }
          viewContent={
            doc.userQuery ? (
              <div className='text-sm bg-muted/50 rounded px-3 py-2 border border-border'>
                <RenderMessageWithHTML message={doc.userQuery} />
              </div>
            ) : (
              <p className='text-sm text-muted-foreground'>—</p>
            )
          }
        />

        {/* Summary */}
        <EditableSection
          label={tc('memory.compareCard.summaryLabel')}
          trackId='Summary'
          labelClass={labelClass}
          isFieldEditing={editingField === 'rawContent'}
          canEdit={!!onUpdate}
          onStartEdit={() => startEdit('rawContent')}
          onSave={saveEdit}
          onCancel={cancelEdit}
          isUpdating={isUpdating}
          editContent={
            <AutoResizeTextarea
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              className={textareaClass}
            />
          }
          viewContent={
            <div className='text-sm text-foreground space-y-1'>
              {doc.rawContent ? (
                <div className='bot-markdown-content memory-markdown'>
                  <Markdown remarkPlugins={markdownPlugins}>
                    {sanitizeMarkdown(doc.rawContent)}
                  </Markdown>
                </div>
              ) : (
                <p className='text-muted-foreground'>{tc('memory.compareCard.noSummary')}</p>
              )}
            </div>
          }
        />

        {/* File Pointers */}
        <EditableSection
          label={tc('memory.compareCard.filesLabel')}
          trackId='Files'
          labelClass={labelClass}
          editHint={tc('memory.compareCard.filesHint')}
          isFieldEditing={editingField === 'filePointers'}
          canEdit={!!onUpdate}
          onStartEdit={() => startEdit('filePointers')}
          onSave={saveEdit}
          onCancel={cancelEdit}
          isUpdating={isUpdating}
          editContent={
            <AutoResizeTextarea
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              className={`${textareaClass} font-mono text-xs`}
            />
          }
          viewContent={
            doc.filePointers?.length > 0 ? (
              <div className='space-y-1'>
                {doc.filePointers.map((file, idx) => (
                  <div
                    key={idx}
                    className='text-xs bg-muted/50 rounded px-2.5 py-1.5 border border-border font-mono text-foreground/80 truncate'
                    title={file}
                  >
                    {file}
                  </div>
                ))}
              </div>
            ) : (
              <p className='text-sm text-muted-foreground'>—</p>
            )
          }
        />

        {/* Tags */}
        <EditableSection
          label={tc('memory.compareCard.tagsLabel')}
          trackId='Tags'
          labelClass={labelClass}
          editHint={tc('memory.compareCard.tagsHint')}
          isFieldEditing={editingField === 'tags'}
          canEdit={!!onUpdate}
          onStartEdit={() => startEdit('tags')}
          onSave={saveEdit}
          onCancel={cancelEdit}
          isUpdating={isUpdating}
          editContent={
            <input
              type='text'
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              className={inputClass}
              placeholder={t('memory.compareCard.tagsPlaceholder')}
              data-track-category='Memory'
              data-track-name='TagsInput'
            />
          }
          viewContent={
            doc.tags?.length > 0 ? (
              <div className='flex flex-wrap gap-1.5'>
                {doc.tags.map(tag => (
                  <span
                    key={tag}
                    className='text-xs bg-muted px-2 py-1 rounded text-muted-foreground'
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : (
              <p className='text-sm text-muted-foreground'>—</p>
            )
          }
        />

        {/* Metadata */}
        <div className='border-t pt-3'>
          <h4 className={`${labelClass} block mb-2`}>{tc('memory.compareCard.metadataLabel')}</h4>
          <table className='w-full text-xs'>
            <tbody className='divide-y divide-border'>
              <ReadOnlyRow
                label={tc('memory.compareCard.sessionLabel')}
                value={doc.sessionId}
                mono
              />
              <ReadOnlyRow label={tc('memory.compareCard.repoLabel')} value={doc.repoUrl} />
              <EditableMetadataRow
                label={tc('memory.compareCard.commitLabel')}
                trackId='Commit'
                value={doc.commitId || ''}
                isFieldEditing={editingField === 'commitId'}
                canEdit={!!onUpdate}
                onStartEdit={() => startEdit('commitId')}
                onSave={saveEdit}
                onCancel={cancelEdit}
                editValue={editValue}
                onEditChange={setEditValue}
                isUpdating={isUpdating}
                mono
              />
              <ReadOnlyRow
                label={tc('memory.compareCard.ticketLabel')}
                value={doc.ticketId || ''}
              />
              <ReadOnlyRow
                label={tc('memory.compareCard.parentRefLabel')}
                value={doc.parentRef || ''}
                mono
              />
              <ReviewStatusRow
                value={doc.reviewStatus}
                isFieldEditing={editingField === 'reviewStatus'}
                canEdit={!!onUpdate}
                onStartEdit={() => startEdit('reviewStatus')}
                onSave={saveEdit}
                onCancel={cancelEdit}
                editValue={editValue}
                onEditChange={setEditValue}
                isUpdating={isUpdating}
              />
              <ReadOnlyRow label={tc('memory.compareCard.agentLabel')} value={doc.agentUsed} />
              <ReadOnlyRow
                label={tc('memory.compareCard.modelsLabel')}
                value={doc.modelUsed?.join(', ')}
              />
              <ReadOnlyRow
                label={tc('memory.compareCard.storageLabel')}
                value={doc.fileStoragePath}
                mono
              />
              <tr>
                <td className='py-1 pr-3 text-muted-foreground font-medium w-24'>
                  {tc('memory.compareCard.createdLabel')}
                </td>
                <td className='py-1'>{formatTimestamp(doc.createdAt)}</td>
              </tr>
              <tr>
                <td className='py-1 pr-3 text-muted-foreground font-medium'>
                  {tc('memory.compareCard.updatedLabel')}
                </td>
                <td className='py-1'>{formatTimestamp(doc.updatedAt)}</td>
              </tr>
              {doc.relevanceScore !== undefined && (
                <tr>
                  <td className='py-1 pr-3 text-muted-foreground font-medium'>
                    {tc('memory.compareCard.relevanceLabel')}
                  </td>
                  <td className='py-1'>{doc.relevanceScore.toFixed(4)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

/** Section with inline edit — label row has pencil icon on hover */
const EditableSection: React.FC<{
  label: string;
  trackId: string;
  labelClass: string;
  editHint?: string;
  isFieldEditing: boolean;
  canEdit: boolean;
  onStartEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  isUpdating: boolean;
  editContent: React.ReactNode;
  viewContent: React.ReactNode;
}> = ({
  label,
  trackId,
  labelClass,
  editHint,
  isFieldEditing,
  canEdit,
  onStartEdit,
  onSave,
  onCancel,
  isUpdating,
  editContent,
  viewContent,
}) => {
  const { t: tc } = useTranslation('common');
  return (
    <div className='group/field'>
      <div className='flex items-center gap-1.5 mb-1.5'>
        <span className={labelClass}>{label}</span>
        {isFieldEditing ? (
          <>
            {editHint && (
              <span className='text-xs text-muted-foreground font-normal normal-case tracking-normal'>
                ({editHint})
              </span>
            )}
            <div className='ml-auto flex items-center gap-0.5'>
              <button
                onClick={onSave}
                disabled={isUpdating}
                className='h-auto p-0.5 text-green-600 hover:text-green-700 rounded transition-colors disabled:opacity-50'
                title={tc('memory.compareCard.saveTooltip')}
                data-ph-capture-attribute-track-id='memory_save_field_edit'
                data-track-category='Memory'
                data-track-name='SaveEdit'
              >
                <Check size={12} />
              </button>
              <button
                onClick={onCancel}
                className='p-0.5 text-muted-foreground hover:text-foreground rounded transition-colors'
                title={tc('memory.compareCard.cancelTooltip')}
                data-track-category='Memory'
                data-track-name='CancelEdit'
              >
                <X size={12} />
              </button>
            </div>
          </>
        ) : canEdit ? (
          <button
            onClick={onStartEdit}
            className='p-0.5 text-muted-foreground hover:text-foreground rounded transition-colors opacity-0 group-hover/field:opacity-100'
            title={tc('memory.compareCard.editFieldTooltip', { field: label.toLowerCase() })}
            data-track-category='Memory'
            data-track-name={`StartEdit${trackId}`}
          >
            <Pencil size={12} />
          </button>
        ) : null}
      </div>
      {isFieldEditing ? editContent : viewContent}
    </div>
  );
};

/** Read-only metadata row */
const ReadOnlyRow: React.FC<{ label: string; value?: string; mono?: boolean }> = ({
  label,
  value,
  mono,
}) => {
  return (
    <tr>
      <td className='py-1 pr-3 text-muted-foreground font-medium w-24'>{label}</td>
      <td className={`py-1 ${mono ? 'font-mono truncate' : ''} break-all`} title={value}>
        {value || '-'}
      </td>
    </tr>
  );
};

/** Editable metadata row — pencil icon on hover, inline input when editing */
const EditableMetadataRow: React.FC<{
  label: string;
  trackId: string;
  value?: string;
  isFieldEditing: boolean;
  canEdit: boolean;
  onStartEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  editValue: string;
  onEditChange: (v: string) => void;
  isUpdating: boolean;
  mono?: boolean;
}> = ({
  label,
  trackId,
  value,
  isFieldEditing,
  canEdit,
  onStartEdit,
  onSave,
  onCancel,
  editValue,
  onEditChange,
  isUpdating,
  mono,
}) => {
  const { t: tc } = useTranslation('common');
  if (!isFieldEditing && !value && !canEdit) return null;

  return (
    <tr className='group/metarow'>
      <td className='py-1 pr-3 text-muted-foreground font-medium w-24'>{label}</td>
      <td className='py-1'>
        {isFieldEditing ? (
          <div className='flex items-center gap-1'>
            <input
              type='text'
              value={editValue}
              onChange={e => onEditChange(e.target.value)}
              className={`flex-1 text-xs bg-muted/50 rounded px-2 py-1 border border-border focus:outline-none focus:ring-1 focus:ring-blue-500 text-foreground ${mono ? 'font-mono' : ''}`}
              data-track-category='Memory'
              data-track-name='MetadataInput'
            />
            <button
              onClick={onSave}
              disabled={isUpdating}
              className='h-auto p-0.5 text-green-600 hover:text-green-700 rounded disabled:opacity-50'
              title={tc('memory.compareCard.saveTooltip')}
              data-ph-capture-attribute-track-id='memory_save_metadata_edit'
              data-track-category='Memory'
              data-track-name='SaveMetadataEdit'
            >
              <Check size={12} />
            </button>
            <button
              onClick={onCancel}
              className='p-0.5 text-muted-foreground hover:text-foreground rounded'
              title={tc('memory.compareCard.cancelTooltip')}
              data-track-category='Memory'
              data-track-name='CancelMetadataEdit'
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <div className='flex items-center gap-1'>
            <span className={`${mono ? 'font-mono truncate' : ''} break-all`} title={value}>
              {value}
            </span>
            {canEdit && (
              <button
                onClick={onStartEdit}
                className='p-0.5 text-muted-foreground hover:text-foreground rounded transition-colors opacity-0 group-hover/metarow:opacity-100 flex-shrink-0'
                title={tc('memory.compareCard.editFieldTooltip', { field: label.toLowerCase() })}
                data-track-category='Memory'
                data-track-name={`StartEdit${trackId}`}
              >
                <Pencil size={10} />
              </button>
            )}
          </div>
        )}
      </td>
    </tr>
  );
};

const REVIEW_STATUS_OPTIONS = ['pending', 'verified', 'rejected'] as const;

const reviewStatusLabelKeys: Record<(typeof REVIEW_STATUS_OPTIONS)[number], string> = {
  pending: 'memory.compareCard.reviewStatus.pending',
  verified: 'memory.compareCard.reviewStatus.verified',
  rejected: 'memory.compareCard.reviewStatus.rejected',
};

const reviewStatusColors: Record<string, { bg: string; text: string }> = {
  pending: { bg: 'bg-yellow-100 dark:bg-yellow-950', text: 'text-yellow-700 dark:text-yellow-300' },
  verified: { bg: 'bg-green-100 dark:bg-green-950', text: 'text-green-700 dark:text-green-300' },
  rejected: { bg: 'bg-red-100 dark:bg-red-950', text: 'text-red-700 dark:text-red-300' },
};

/** Editable review status metadata row with a dropdown */
const ReviewStatusRow: React.FC<{
  value?: string;
  isFieldEditing: boolean;
  canEdit: boolean;
  onStartEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  editValue: string;
  onEditChange: (v: string) => void;
  isUpdating: boolean;
}> = ({
  value,
  isFieldEditing,
  canEdit,
  onStartEdit,
  onSave,
  onCancel,
  editValue,
  onEditChange,
  isUpdating,
}) => {
  const { t: tc } = useTranslation('common');
  if (!isFieldEditing && !value) return null;

  const colors = value
    ? reviewStatusColors[value] || { bg: 'bg-muted', text: 'text-muted-foreground' }
    : null;
  const knownStatus: (typeof REVIEW_STATUS_OPTIONS)[number] | null =
    value && (REVIEW_STATUS_OPTIONS as readonly string[]).includes(value)
      ? (value as (typeof REVIEW_STATUS_OPTIONS)[number])
      : null;

  return (
    <tr className='group/metarow'>
      <td className='py-1 pr-3 text-muted-foreground font-medium w-24'>
        {tc('memory.compareCard.statusLabel')}
      </td>
      <td className='py-1'>
        {isFieldEditing ? (
          <div className='flex items-center gap-1'>
            {REVIEW_STATUS_OPTIONS.map(opt => {
              const selected = editValue === opt;
              const color = reviewStatusColors[opt] || {
                bg: 'bg-muted',
                text: 'text-muted-foreground',
              };
              return (
                <button
                  key={opt}
                  type='button'
                  onClick={() => onEditChange(opt)}
                  className={`px-2 py-0.5 text-xs font-semibold rounded border transition-colors focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                    selected
                      ? `${color.bg} ${color.text} border-blue-500`
                      : `bg-muted text-muted-foreground border-border hover:${color.bg} hover:${color.text}`
                  }`}
                  style={{ minWidth: 70 }}
                  tabIndex={0}
                  data-track-category='Memory'
                  data-track-name={`SelectStatus${opt}`}
                >
                  {tc(reviewStatusLabelKeys[opt])}
                </button>
              );
            })}
            <button
              onClick={onSave}
              disabled={isUpdating}
              className='h-auto p-0.5 text-green-600 hover:text-green-700 rounded disabled:opacity-50'
              title={tc('memory.compareCard.saveTooltip')}
              data-ph-capture-attribute-track-id='memory_save_status_edit'
              data-track-category='Memory'
              data-track-name='SaveStatusEdit'
            >
              <Check size={12} />
            </button>
            <button
              onClick={onCancel}
              className='p-0.5 text-muted-foreground hover:text-foreground rounded'
              title={tc('memory.compareCard.cancelTooltip')}
              data-track-category='Memory'
              data-track-name='CancelStatusEdit'
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <div className='flex items-center gap-1'>
            {colors ? (
              <span
                className={`px-2 py-0.5 text-xs font-semibold rounded ${colors.bg} ${colors.text}`}
              >
                {knownStatus ? tc(reviewStatusLabelKeys[knownStatus]) : value}
              </span>
            ) : (
              <span className='text-muted-foreground'>—</span>
            )}
            {canEdit && (
              <button
                onClick={onStartEdit}
                className='p-0.5 text-muted-foreground hover:text-foreground rounded transition-colors opacity-0 group-hover/metarow:opacity-100 flex-shrink-0'
                title={tc('memory.compareCard.editStatusTooltip')}
                data-track-category='Memory'
                data-track-name='StartEditStatus'
              >
                <Pencil size={10} />
              </button>
            )}
          </div>
        )}
      </td>
    </tr>
  );
};

export default MemoryCompareCard;
