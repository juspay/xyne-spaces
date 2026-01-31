import React, { useState } from 'react';
import { BaseStepRendererProps, ToolEditData } from './types';
import { FileEdit, ChevronDown, ChevronRight, Check, X } from 'lucide-react';
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued';

type SafeRecord = Record<string, unknown>;

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

/**
 * Renderer for tool_edit steps with beautiful diff display.
 * Matches the style of ToolMultiEditRenderer for consistency.
 */
export const ToolEditRenderer: React.FC<
  BaseStepRendererProps<ToolEditData | string | SafeRecord>
> = ({ data }) => {
  const [isExpanded, setIsExpanded] = useState(true);

  try {
    // Parse data - handle string or object
    const record: SafeRecord =
      typeof data === 'string' ? (JSON.parse(data) as SafeRecord) : (data as SafeRecord);

    // Handle nested input/output structure
    const input = (record['input'] as SafeRecord) ?? record;
    const output = (record['output'] as SafeRecord) ?? record;

    // File path
    const filePath =
      (input['file_path'] as string) ??
      (output['file_path'] as string) ??
      (record['file_path'] as string) ??
      '';
    const fileName = filePath.split('/').pop() || 'Unknown File';

    // Old/new strings for diff
    const oldString = (input['old_string'] as string) ?? '';
    const newString = (input['new_string'] as string) ?? '';

    // Success status
    const success = (output['success'] as boolean) ?? true;

    return (
      <div className='space-y-2 text-sm'>
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
            <span className='text-sm font-medium text-gray-800'>{fileName}</span>
            <span className='ml-auto flex items-center gap-1 text-sm'>
              {success ? (
                <span className='flex items-center gap-1 text-green-600'>
                  <Check size={14} strokeWidth={2.5} />1
                </span>
              ) : (
                <span className='flex items-center gap-1 text-red-600'>
                  <X size={14} strokeWidth={2.5} />1
                </span>
              )}
            </span>
          </button>

          {/* Diff Content */}
          {isExpanded && (
            <div className='border-t border-gray-200 overflow-auto max-h-96'>
              <ReactDiffViewer
                styles={diffStyles}
                oldValue={oldString}
                newValue={newString}
                splitView={false}
                showDiffOnly={false}
                useDarkTheme={false}
                hideLineNumbers={false}
                compareMethod={DiffMethod.WORDS}
              />
            </div>
          )}
        </div>
      </div>
    );
  } catch (error) {
    return (
      <div className='text-red-600 text-sm p-3 border border-red-200 rounded-lg bg-red-50'>
        Error parsing edit tool data: {error instanceof Error ? error.message : 'Unknown error'}
      </div>
    );
  }
};

export default ToolEditRenderer;
