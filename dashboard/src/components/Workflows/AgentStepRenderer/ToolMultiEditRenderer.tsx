import React, { useState, useMemo } from 'react';
import { BaseStepRendererProps, ToolMultiEditData } from './types';
import { FileEdit, ChevronDown, ChevronRight, Check, X } from 'lucide-react';
import { MultiFileDiff } from '@pierre/diffs/react';
import { useTheme } from '../../../hooks/useTheme';

type SafeRecord = Record<string, unknown>;

interface EditApplied {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  old_string: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  new_string: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  occurrences_replaced?: number;
}

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

    const pathParts = filePath.split('/');
    const fileName = pathParts.pop() || 'Unknown File';
    const directoryPath = pathParts.join('/');

    const totalEdits = (output['total_edits'] as number) ?? 0;
    const successfulEdits = (output['successful_edits'] as number) ?? totalEdits;
    const failedEdits = totalEdits - successfulEdits;

    const editsApplied = (output['edits_applied'] as EditApplied[]) ?? [];

    // eslint-disable-next-line @typescript-eslint/naming-convention
    const inputEdits =
      (input['edits'] as Array<{ file_path?: string; old_string?: string; new_string?: string }>) ??
      [];

    const hasAnyEdits = editsApplied.length > 0 || inputEdits.length > 0;

    return (
      <div className='space-y-2 text-sm'>
        <div
          className={`rounded-xl border transition-colors overflow-hidden ${
            successfulEdits > 0
              ? 'bg-amber-50/20 border-amber-200/40'
              : 'bg-background border-border'
          }`}
        >
          {/* File Header - Collapsible */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className='w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left'
            data-track-category='Workflows'
            data-track-name='ToggleMultiFileEditExpand'
            data-track-metadata={JSON.stringify({ fileName, filePath })}
          >
            <div className='p-2 rounded-lg bg-amber-500/10 text-amber-500'>
              <FileEdit size={18} />
            </div>

            <div className='flex flex-col min-w-0'>
              <div className='flex items-center gap-2'>
                <span className='text-sm font-semibold text-foreground truncate'>
                  {filePath ? fileName : `${totalEdits || inputEdits.length} Edits`}
                </span>
                {totalEdits > 0 && (
                  <div className='flex items-center gap-1.5'>
                    <span className='inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-600 uppercase tracking-wider border border-amber-200/50'>
                      Edit
                    </span>
                  </div>
                )}
              </div>
              {directoryPath && (
                <span className='text-[11px] text-muted-foreground truncate font-mono'>
                  {directoryPath}/
                </span>
              )}
            </div>

            <div className='ml-auto flex items-center gap-3'>
              <div className='hidden sm:flex items-center gap-2 px-2 py-1 rounded-md bg-muted/50 text-[10px] font-medium border border-border/50'>
                <div className='flex items-center gap-1 text-green-600'>
                  <Check size={12} strokeWidth={3} />
                  <span>{successfulEdits}</span>
                </div>
                {failedEdits > 0 && (
                  <>
                    <div className='w-px h-3 bg-border mx-1'></div>
                    <div className='flex items-center gap-1 text-red-600'>
                      <X size={12} strokeWidth={3} />
                      <span>{failedEdits}</span>
                    </div>
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

          {/* Expanded Content - Show Diffs */}
          {isExpanded && (
            <div className='border-t border-border bg-slate-50/30 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200'>
              {/* Diff Container */}
              {(editsApplied.length > 0 || inputEdits.length > 0) && (
                <div className='overflow-auto max-h-[500px] divide-y divide-border/40'>
                  {(editsApplied.length > 0 ? editsApplied : inputEdits).map((edit, index) => (
                    <div key={index} className='group'>
                      {/* Edit Header for Multi-edit */}
                      <div className='px-4 py-1.5 bg-muted/20 border-b border-border/30 flex items-center gap-2'>
                        <span className='text-[10px] font-bold text-muted-foreground/70 uppercase tracking-widest'>
                          Edit {index + 1}
                        </span>
                        <div className='h-px flex-1 bg-border/40'></div>
                      </div>
                      {/* Diff View */}
                      <PierreDiffView
                        name={filePath || fileName}
                        oldContents={edit.old_string || ''}
                        newContents={edit.new_string || ''}
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Status Message when no specific applied edits are listed */}
              {!hasAnyEdits && successfulEdits > 0 && (
                <div className='px-4 py-3 text-xs text-muted-foreground italic flex items-center gap-2 bg-muted/10'>
                  <Check size={14} className='text-green-500' />
                  {successfulEdits} edit{successfulEdits !== 1 ? 's' : ''} applied successfully to
                  the file.
                </div>
              )}

              {/* Error Summary if any */}
              {failedEdits > 0 && (
                <div className='px-4 py-2 bg-red-500/5 border-t border-red-200/50 text-[10px] text-red-600 font-medium flex items-center gap-1.5'>
                  <X size={12} strokeWidth={3} />
                  {failedEdits} edit{failedEdits !== 1 ? 's' : ''} encountered issues during
                  application.
                </div>
              )}
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
