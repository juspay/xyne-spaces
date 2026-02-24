import React, { useState } from 'react';
import { BaseStepRendererProps, ToolWriteData } from './types';
import { FileEdit, ChevronDown, ChevronRight, Check, X } from 'lucide-react';

type SafeRecord = Record<string, unknown>;

/**
 * Renderer for tool_write steps.
 * Matches the style of ToolMultiEditRenderer for consistency.
 */
export const ToolWriteRenderer: React.FC<
  BaseStepRendererProps<ToolWriteData | string | SafeRecord>
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
      'Unknown file';
    const fileName = filePath.split('/').pop() || 'Unknown File';

    // Content
    const content = (input['content'] as string) ?? '';
    const lineCount = content.split('\n').length;
    const charCount = content.length;

    // Success/error status
    const success = (output['success'] as boolean) ?? true;
    const error = (output['error'] as string) ?? '';
    const bytesWritten = (output['bytesWritten'] as number) ?? 0;

    return (
      <div className='space-y-2 text-sm'>
        <div className='rounded-lg border border-gray-200 overflow-hidden bg-white'>
          {/* File Header - Collapsible */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className='w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 transition-colors'
            data-track-category='Workflows'
            data-track-name='ToggleFileWriteExpand'
            data-track-metadata={JSON.stringify({ fileName })}
          >
            <span className='text-gray-400'>
              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </span>
            <FileEdit size={16} className='text-blue-500 shrink-0' />
            <span className='text-sm font-medium text-gray-800'>{fileName}</span>
            <span className='ml-auto flex items-center gap-1 text-sm'>
              {success && !error ? (
                <span className='flex items-center gap-1 text-green-600'>
                  <Check size={14} strokeWidth={2.5} />
                  {bytesWritten > 0 ? `${bytesWritten}B` : '1'}
                </span>
              ) : (
                <span className='flex items-center gap-1 text-red-600'>
                  <X size={14} strokeWidth={2.5} />1
                </span>
              )}
            </span>
          </button>

          {/* Expanded Content */}
          {isExpanded && (
            <div className='border-t border-gray-200 overflow-auto max-h-96'>
              {/* Error message */}
              {error && (
                <div className='p-3 bg-red-50 border-b border-red-200'>
                  <p className='text-sm font-semibold text-red-700 mb-1'>Error:</p>
                  <p className='text-xs text-red-700 font-mono whitespace-pre-wrap'>{error}</p>
                </div>
              )}

              {/* Content stats */}
              <div className='px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs text-gray-600'>
                {charCount} characters, {lineCount} lines
              </div>

              {/* File content preview */}
              {content && (
                <pre className='p-3 text-xs font-mono text-gray-800 whitespace-pre-wrap break-words'>
                  {content.length > 2000 ? `${content.substring(0, 2000)}...` : content}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    );
  } catch (error) {
    return (
      <div className='text-red-600 text-sm p-3 border border-red-200 rounded-lg bg-red-50'>
        Error parsing write tool data: {error instanceof Error ? error.message : 'Unknown error'}
      </div>
    );
  }
};

export default ToolWriteRenderer;
