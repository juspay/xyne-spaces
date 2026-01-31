import React, { useState } from 'react';
import { BaseStepRendererProps, ToolMultiEditData } from './types';
import { FileEdit, ChevronDown, ChevronRight, Check, X } from 'lucide-react';
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued';

type SafeRecord = Record<string, unknown>;

interface EditApplied {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  old_string: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  new_string: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  occurrences_replaced?: number;
}

// Diff styles for light theme (Tailwind color values)
const diffStyles = {
  diffContainer: {
    backgroundColor: '#ffffff',
    border: 'none',
    fontFamily:
      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    fontSize: '0.8125rem',
    lineHeight: '1.6',
  },
  diffRemoved: {
    backgroundColor: '#fef2f2', // red-50
    color: '#374151', // gray-700
  },
  diffAdded: {
    backgroundColor: '#f0fdf4', // green-50
    color: '#374151', // gray-700
  },
  wordAdded: {
    backgroundColor: '#dbeafe', // blue-100
    color: '#1d4ed8', // blue-700
    padding: '1px 2px',
    borderRadius: '2px',
  },
  wordRemoved: {
    backgroundColor: '#fee2e2', // red-100
    color: '#dc2626', // red-600
    textDecoration: 'line-through',
    padding: '1px 2px',
    borderRadius: '2px',
  },
  gutter: {
    backgroundColor: 'transparent',
    color: '#9ca3af', // gray-400
    width: '20px',
    minWidth: '20px',
    padding: '0 8px 0 0',
    textAlign: 'left' as const,
  },
  contentText: {
    color: '#374151', // gray-700
    padding: '2px 0',
  },
  line: {
    padding: '0 12px',
  },
};

export const ToolMultiEditRenderer: React.FC<
  BaseStepRendererProps<ToolMultiEditData | string | SafeRecord>
> = ({ data }) => {
  const [isExpanded, setIsExpanded] = useState(true);

  try {
    const record: SafeRecord =
      typeof data === 'string' ? (JSON.parse(data) as SafeRecord) : (data as SafeRecord);

    const input = (record['input'] as SafeRecord) ?? {};
    const output = (record['output'] as SafeRecord) ?? record;

    const filePath =
      (input['file_path'] as string) ??
      (output['file_path'] as string) ??
      (record['file_path'] as string) ??
      '';
    const fileName = filePath.split('/').pop() || 'Unknown File';

    const totalEdits = (output['total_edits'] as number) ?? 0;
    const successfulEdits = (output['successful_edits'] as number) ?? totalEdits;
    const failedEdits = totalEdits - successfulEdits;

    const editsApplied = (output['edits_applied'] as EditApplied[]) ?? [];

    // eslint-disable-next-line @typescript-eslint/naming-convention
    const inputEdits =
      (input['edits'] as Array<{ file_path?: string; old_string?: string; new_string?: string }>) ??
      [];

    return (
      <div className='space-y-2 text-sm'>
        {/* File Card with Diff */}
        <div className='rounded-lg border border-gray-200 overflow-hidden bg-white'>
          {/* File Header - Collapsible */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className='w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 transition-colors'
          >
            <span className='text-gray-400'>
              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </span>
            <FileEdit size={16} className='text-amber-500 shrink-0' />
            <span className='text-sm font-medium text-gray-800'>
              {filePath ? fileName : `${totalEdits || inputEdits.length} edits`}
            </span>
            <span className='ml-auto flex items-center gap-2 text-sm'>
              <span className='flex items-center gap-1 text-green-600'>
                <Check size={14} strokeWidth={2.5} />
                {successfulEdits}
              </span>
              {failedEdits > 0 && (
                <span className='flex items-center gap-1 text-red-600'>
                  <X size={14} strokeWidth={2.5} />
                  {failedEdits}
                </span>
              )}
            </span>
          </button>

          {/* Expanded Content - Show Diffs */}
          {isExpanded && editsApplied.length > 0 && (
            <div className='border-t border-gray-200 overflow-auto max-h-96'>
              {editsApplied.map((edit, index) => (
                <div key={index}>
                  {/* Edit separator for multiple edits */}
                  {editsApplied.length > 1 && (
                    <div className='flex items-center gap-2 px-3 py-1 bg-gray-100 border-t border-b border-gray-200 first:border-t-0'>
                      <div className='flex-1 h-px bg-gray-300'></div>
                      <span className='text-xs text-gray-500 font-medium'>Edit {index + 1}</span>
                      <div className='flex-1 h-px bg-gray-300'></div>
                    </div>
                  )}
                  {/* Diff View */}
                  <ReactDiffViewer
                    styles={diffStyles}
                    oldValue={edit.old_string || ''}
                    newValue={edit.new_string || ''}
                    splitView={false}
                    showDiffOnly={false}
                    useDarkTheme={false}
                    hideLineNumbers={false}
                    compareMethod={DiffMethod.WORDS}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Fallback for old format - show input edits */}
          {isExpanded && editsApplied.length === 0 && inputEdits.length > 0 && (
            <div className='border-t border-gray-200 overflow-auto max-h-96'>
              {inputEdits.map((edit, index) => (
                <div key={index}>
                  {inputEdits.length > 1 && (
                    <div className='flex items-center gap-2 px-3 py-1 bg-gray-100 border-t border-b border-gray-200 first:border-t-0'>
                      <div className='flex-1 h-px bg-gray-300'></div>
                      <span className='text-xs text-gray-500 font-medium'>Edit {index + 1}</span>
                      <div className='flex-1 h-px bg-gray-300'></div>
                    </div>
                  )}
                  <ReactDiffViewer
                    styles={diffStyles}
                    oldValue={edit.old_string || ''}
                    newValue={edit.new_string || ''}
                    splitView={false}
                    showDiffOnly={false}
                    useDarkTheme={false}
                    hideLineNumbers={false}
                    compareMethod={DiffMethod.WORDS}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Message when no edits to show */}
          {isExpanded &&
            editsApplied.length === 0 &&
            inputEdits.length === 0 &&
            successfulEdits > 0 && (
              <div className='px-3 py-2 text-sm text-gray-500 border-t border-gray-200'>
                {successfulEdits} edit{successfulEdits !== 1 ? 's' : ''} applied successfully
              </div>
            )}
        </div>
      </div>
    );
  } catch (error) {
    return (
      <div className='text-red-600 text-sm p-3 border border-red-200 rounded-lg bg-red-50'>
        Error parsing multi-edit data: {error instanceof Error ? error.message : 'Unknown error'}
      </div>
    );
  }
};

export default ToolMultiEditRenderer;
