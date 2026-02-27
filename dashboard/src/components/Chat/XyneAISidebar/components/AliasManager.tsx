/* eslint-disable local-rules/require-tracking-on-click */
import { ReactElement, useState, useCallback } from 'react';
import { X, Trash2, Edit2, Ban } from 'lucide-react';
import type { ActivityAlias } from '../../../../hooks/useActivityAliases';

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
      <div className='bg-white rounded-lg shadow-lg w-fit min-w-[56rem] max-w-[90vw] mx-4 overflow-hidden flex flex-col max-h-[80vh]'>
        {/* Header */}
        <div className='flex items-center justify-between px-4 py-3 border-b border-gray-200 flex-shrink-0'>
          <div>
            <h2 className='text-lg font-semibold text-gray-900'>Activity Aliases</h2>
            <p className='text-sm text-gray-500 mt-0.5'>
              Manage how activity events are displayed and filtered
            </p>
          </div>
          <button
            onClick={onClose}
            className='p-1 hover:bg-gray-100 rounded transition-colors'
            type='button'
          >
            <X className='w-5 h-5 text-gray-500' />
          </button>
        </div>

        {/* Body */}
        <div className='flex-1 overflow-auto p-4'>
          {aliases.length === 0 ? (
            <div className='text-center py-12'>
              <h3 className='text-sm font-medium text-gray-900'>No aliases yet</h3>
              <p className='text-sm text-gray-500 mt-1 max-w-sm mx-auto'>
                Click the settings icon on any activity to create an alias or blacklist it.
              </p>
            </div>
          ) : (
            <div className='border border-gray-200 rounded-lg overflow-x-auto'>
              <table className='w-full min-w-max text-sm'>
                <thead className='bg-gray-50 border-b border-gray-200'>
                  <tr>
                    <th className='px-4 py-3 text-left font-medium text-gray-700'>Key Name</th>
                    <th className='px-4 py-3 text-left font-medium text-gray-700'>→ Alias Name</th>
                    <th className='px-4 py-3 text-left font-medium text-gray-700'>Key Category</th>
                    <th className='px-4 py-3 text-left font-medium text-gray-700'>
                      → Alias Category
                    </th>
                    <th className='px-4 py-3 text-center font-medium text-gray-700'>Status</th>
                    <th className='px-4 py-3 text-right font-medium text-gray-700'>Actions</th>
                  </tr>
                </thead>
                <tbody className='divide-y divide-gray-200'>
                  {aliases.map(alias => (
                    <tr key={alias.id} className='hover:bg-gray-50'>
                      <td className='px-4 py-3 text-gray-900 font-mono text-xs'>
                        {alias.eventName}
                      </td>
                      <td className='px-4 py-3 text-gray-700'>{alias.aliasEventName || '-'}</td>
                      <td className='px-4 py-3 text-gray-500 text-xs'>{alias.eventCategory}</td>
                      <td className='px-4 py-3 text-gray-500 text-xs'>
                        {alias.aliasEventCategory || '-'}
                      </td>
                      <td className='px-4 py-3 text-center'>
                        {alias.isBlacklisted ? (
                          <span className='inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700'>
                            <Ban className='w-3 h-3' />
                            Blacklisted
                          </span>
                        ) : (
                          <span className='inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700'>
                            Active
                          </span>
                        )}
                      </td>
                      <td className='px-4 py-3 text-right'>
                        <div className='flex items-center justify-end gap-2'>
                          <button
                            onClick={() => onEdit(alias)}
                            className='p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors'
                            title='Edit alias'
                            type='button'
                          >
                            <Edit2 className='w-4 h-4' />
                          </button>
                          {confirmDeleteId === alias.id ? (
                            <div className='flex items-center gap-1'>
                              <button
                                onClick={() => handleConfirmDelete(alias.id)}
                                className='px-2 py-1 text-xs font-medium text-white bg-red-600 rounded hover:bg-red-700 transition-colors'
                                type='button'
                              >
                                Confirm
                              </button>
                              <button
                                onClick={handleCancelDelete}
                                className='px-2 py-1 text-xs font-medium text-gray-600 bg-gray-100 rounded hover:bg-gray-200 transition-colors'
                                type='button'
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => handleDeleteClick(alias.id)}
                              className='p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors'
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
        <div className='flex justify-end px-4 py-3 border-t border-gray-200 bg-gray-50 flex-shrink-0'>
          <button
            onClick={onClose}
            className='px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors'
            type='button'
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
