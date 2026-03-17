import React, { useState, useMemo } from 'react';
import { BaseStepRendererProps, ToolEditData } from './types';
import { FileEdit, ChevronDown, ChevronRight, Check, X } from 'lucide-react';
import { MultiFileDiff } from '@pierre/diffs/react';
import { useTheme } from '../../../hooks/useTheme';

type SafeRecord = Record<string, unknown>;

// Sub-component to maintain stable file object references required by @pierre/diffs
const PierreDiffView: React.FC<{ name: string; oldContents: string; newContents: string }> = ({
  name,
  oldContents,
  newContents,
}) => {
  const pierreTheme = useTheme().theme === 'midnight' ? 'pierre-dark' : 'pierre-light';
  const oldFile = useMemo(() => ({ name, contents: oldContents }), [name, oldContents]);
  const newFile = useMemo(() => ({ name, contents: newContents }), [name, newContents]);
  return (
    <MultiFileDiff
      oldFile={oldFile}
      newFile={newFile}
      options={{
        theme: pierreTheme,
        diffStyle: 'unified',
        lineDiffType: 'word-alt',
        disableFileHeader: true,
      }}
    />
  );
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
        <div
          className={`rounded-xl border transition-colors overflow-hidden ${
            success ? 'bg-amber-50/20 border-amber-200/40' : 'bg-background border-border'
          }`}
        >
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
                  <div className='flex items-center gap-1.5'>
                    <span className='inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-600 uppercase tracking-wider border border-amber-200/50'>
                      Edit
                    </span>
                  </div>
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
            <div className='border-t border-border overflow-auto max-h-[500px] animate-in fade-in slide-in-from-top-1 duration-200'>
              <PierreDiffView
                name={filePath || fileName}
                oldContents={oldString}
                newContents={newString}
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
