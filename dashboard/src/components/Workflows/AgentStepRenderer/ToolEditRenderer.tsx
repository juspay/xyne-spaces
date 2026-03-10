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
    minWidth: '36px',
    padding: '0 8px',
    textAlign: 'right' as const,
    userSelect: 'none' as const,
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

    const pathParts = filePath.split('/');
    const fileName = pathParts.pop() || 'Unknown File';
    const directoryPath = pathParts.join('/');

    // Old/new strings for diff
    const oldString = (input['old_string'] as string) ?? '';
    const newString = (input['new_string'] as string) ?? '';

    // Success status
    const success = (output['success'] as boolean) ?? true;

    return (
      <div className='space-y-2 text-sm'>
        <div className='rounded-xl border border-border overflow-hidden bg-background'>
          {/* File Header - Collapsible */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className='w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left'
            data-track-category='Workflows'
            data-track-name='ToggleFileEditExpand'
            data-track-metadata={JSON.stringify({ fileName, filePath })}
          >
            <div className='p-2 rounded-lg bg-amber-500/10 text-amber-500'>
              <FileEdit size={18} />
            </div>

            <div className='flex flex-col min-w-0'>
              <div className='flex items-center gap-2'>
                <span className='text-sm font-semibold text-foreground truncate'>{fileName}</span>
                {success ? (
                  <span className='inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-green-500/10 text-green-600 uppercase tracking-wider'>
                    Success
                  </span>
                ) : (
                  <span className='inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-500/10 text-red-600 uppercase tracking-wider'>
                    Failed
                  </span>
                )}
              </div>
              {directoryPath && (
                <span className='text-[11px] text-muted-foreground truncate font-mono'>
                  {directoryPath}/
                </span>
              )}
            </div>

            <div className='ml-auto flex items-center gap-3'>
              <div className='hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/50 text-[10px] font-medium text-muted-foreground border border-border/50'>
                {success ? (
                  <>
                    <Check size={12} className='text-green-600' strokeWidth={3} />
                    <span>Applied</span>
                  </>
                ) : (
                  <>
                    <X size={12} className='text-red-600' strokeWidth={3} />
                    <span>Failed</span>
                  </>
                )}
              </div>
              <span className='text-muted-foreground/60 transition-transform duration-200'>
                {isExpanded ? (
                  <ChevronDown size={18} className='rotate-0' />
                ) : (
                  <ChevronRight size={18} className='-rotate-90' />
                )}
              </span>
            </div>
          </button>

          {/* Diff Content */}
          {isExpanded && (
            <div className='border-t border-border bg-slate-50/30 overflow-auto max-h-[500px] animate-in fade-in slide-in-from-top-1 duration-200'>
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
