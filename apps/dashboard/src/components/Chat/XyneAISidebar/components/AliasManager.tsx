/* eslint-disable local-rules/require-tracking-on-click */
import { ReactElement, useState, useCallback } from 'react';
import { X, Trash2, Edit2, Ban } from 'lucide-react';
import type { ActivityAlias } from '../../../../hooks/useActivityAliases';
import { Button } from '../../../ui/Button/Button';

interface AliasManagerProps {
  isOpen: boolean;
  onClose: () => void;
  aliases: ActivityAlias[];
  onEdit: (alias: ActivityAlias) => void;
  onDelete: (id: string) => void;
}

export const AliasManager = ({
  isOpen,
  onClose,
  aliases,
  onEdit,
  onDelete,
}: AliasManagerProps): ReactElement | null => {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleDeleteClick = useCallback((id: string) => {
    setConfirmDeleteId(id);
  }, []);

  const handleConfirmDelete = useCallback(
    (id: string) => {
      onDelete(id);
      setConfirmDeleteId(null);
    },
    [onDelete],
  );

  const handleCancelDelete = useCallback(() => {
    setConfirmDeleteId(null);
  }, []);

  if (!isOpen) return null;

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
      <div className='bg-popover rounded-lg shadow-lg w-fit min-w-[56rem] max-w-[90vw] mx-4 overflow-hidden flex flex-col max-h-[80vh]'>
        {/* Header */}
        <div className='flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0'>
          <div>
            <h2 className='text-lg font-semibold text-foreground'>Activity Aliases</h2>
            <p className='text-sm text-muted-foreground mt-0.5'>
              Manage how activity events are displayed and filtered
            </p>
          </div>
          <button
            onClick={onClose}
            data-track-category='XYNE_AI_SIDEBAR'
            data-track-name='CLOSE_ALIAS_MANAGER'
            className='p-1 hover:bg-accent rounded transition-colors'
            type='button'
          >
            <X className='w-5 h-5 text-muted-foreground' />
          </button>
        </div>

        {/* Body */}
        <div className='flex-1 overflow-auto p-4'>
          {aliases.length === 0 ? (
            <div className='text-center py-12'>
              <h3 className='text-sm font-medium text-foreground'>No aliases yet</h3>
              <p className='text-sm text-muted-foreground mt-1 max-w-sm mx-auto'>
                Click the settings icon on any activity to create an alias or blacklist it.
              </p>
            </div>
          ) : (
            <div className='border border-border rounded-lg overflow-x-auto'>
              <table className='w-full min-w-max text-sm'>
                <thead className='bg-muted border-b border-border'>
                  <tr>
                    <th className='px-4 py-3 text-left font-medium text-muted-foreground'>
                      Key Name
                    </th>
                    <th className='px-4 py-3 text-left font-medium text-muted-foreground'>
                      → Alias Name
                    </th>
                    <th className='px-4 py-3 text-left font-medium text-muted-foreground'>
                      Key Category
                    </th>
                    <th className='px-4 py-3 text-left font-medium text-muted-foreground'>
                      → Alias Category
                    </th>
                    <th className='px-4 py-3 text-center font-medium text-muted-foreground'>
                      Status
                    </th>
                    <th className='px-4 py-3 text-right font-medium text-muted-foreground'>
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className='divide-y divide-border'>
                  {aliases.map(alias => (
                    <tr key={alias.id} className='hover:bg-muted'>
                      <td className='px-4 py-3 text-foreground font-mono text-xs'>
                        {alias.eventName}
                      </td>
                      <td className='px-4 py-3 text-muted-foreground'>
                        {alias.aliasEventName || '-'}
                      </td>
                      <td className='px-4 py-3 text-muted-foreground text-xs'>
                        {alias.eventCategory}
                      </td>
                      <td className='px-4 py-3 text-muted-foreground text-xs'>
                        {alias.aliasEventCategory || '-'}
                      </td>
                      <td className='px-4 py-3 text-center'>
                        {alias.isBlacklisted ? (
                          <span className='inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-destructive/10 text-destructive'>
                            <Ban className='w-3 h-3' />
                            Blacklisted
                          </span>
                        ) : (
                          <span className='inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-status-success/10 text-status-success'>
                            Active
                          </span>
                        )}
                      </td>
                      <td className='px-4 py-3 text-right'>
                        <div className='flex items-center justify-end gap-2'>
                          <button
                            onClick={() => onEdit(alias)}
                            data-track-category='XYNE_AI_SIDEBAR'
                            data-track-name='EDIT_ACTIVITY_ALIAS'
                            className='p-1.5 text-muted-foreground hover:text-primary hover:bg-muted rounded transition-colors'
                            title='Edit alias'
                            type='button'
                          >
                            <Edit2 className='w-4 h-4' />
                          </button>
                          {confirmDeleteId === alias.id ? (
                            <div className='flex items-center gap-1'>
                              <Button
                                variant='ghost'
                                onClick={() => handleConfirmDelete(alias.id)}
                                trackId='confirm_delete_alias'
                                data-track-category='XYNE_AI_SIDEBAR'
                                data-track-name='CONFIRM_DELETE_ALIAS'
                                className='px-2 py-1 text-xs font-medium text-destructive-foreground bg-destructive rounded hover:bg-destructive/90 transition-colors'
                                type='button'
                              >
                                Confirm
                              </Button>
                              <button
                                onClick={handleCancelDelete}
                                data-track-category='XYNE_AI_SIDEBAR'
                                data-track-name='CANCEL_DELETE_ALIAS'
                                className='px-2 py-1 text-xs font-medium text-muted-foreground bg-muted rounded hover:bg-accent transition-colors'
                                type='button'
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => handleDeleteClick(alias.id)}
                              data-track-category='XYNE_AI_SIDEBAR'
                              data-track-name='START_DELETE_ALIAS'
                              className='p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-colors'
                              title='Delete alias'
                              type='button'
                            >
                              <Trash2 className='w-4 h-4' />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className='flex justify-end px-4 py-3 border-t border-border bg-muted flex-shrink-0'>
          <button
            onClick={onClose}
            data-track-category='XYNE_AI_SIDEBAR'
            data-track-name='CLOSE_ALIAS_MANAGER'
            className='px-4 py-2 text-sm font-medium text-muted-foreground bg-background border border-border rounded-md hover:bg-muted transition-colors'
            type='button'
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
