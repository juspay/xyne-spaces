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
      '';

    const pathParts = filePath.split('/');
    const fileName = pathParts.pop() || 'Unknown File';
    const directoryPath = pathParts.join('/');

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
        <div
          className={`rounded-xl border transition-colors overflow-hidden ${
            success && !error ? 'bg-green-50/30 border-green-200/50' : 'bg-background border-border'
          }`}
        >
          {/* File Header - Collapsible */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className='w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted/50 transition-colors text-left'
            data-track-category='Workflows'
            data-track-name='ToggleFileWriteExpand'
            data-track-metadata={JSON.stringify({ fileName, filePath })}
          >
            <div
              className={`p-1.5 rounded-md ${
                success && !error
                  ? 'bg-green-500/10 text-green-600'
                  : 'bg-blue-500/10 text-blue-500'
              }`}
            >
              <FileEdit size={14} />
            </div>

            <div className='flex flex-col min-w-0'>
              <div className='flex items-center gap-2'>
                <span className='text-xs font-semibold text-foreground truncate'>{fileName}</span>
                {success && !error ? (
                  <div className='flex items-center gap-1.5'>
                    <span className='inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-500/10 text-green-600 uppercase tracking-wider border border-green-200/50'>
                      New
                    </span>
                  </div>
                ) : (
                  <span className='inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-500/10 text-red-600 uppercase tracking-wider'>
                    Failed
                  </span>
                )}
              </div>
              {directoryPath && (
                <span className='text-[10px] text-muted-foreground truncate font-mono'>
                  {directoryPath}/
                </span>
              )}
            </div>

            <div className='ml-auto flex items-center gap-3'>
              <div className='hidden sm:flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-muted/50 text-[10px] font-medium text-muted-foreground border border-border/50'>
                {success && !error ? (
                  <>
                    <Check size={12} className='text-green-600' strokeWidth={3} />
                    <span>{bytesWritten > 0 ? `${bytesWritten}B` : 'Written'}</span>
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

          {/* Expanded Content */}
          {isExpanded && (
            <div className='border-t border-border bg-muted/30 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200'>
              {/* Error message */}
              {error && (
                <div className='p-3 bg-red-500/5 border-b border-red-200/50'>
                  <p className='text-xs font-semibold text-red-600 mb-1 flex items-center gap-1.5'>
                    <X size={14} strokeWidth={3} />
                    Error Detail:
                  </p>
                  <p className='text-xs text-red-700/80 font-mono whitespace-pre-wrap pl-5'>
                    {error}
                  </p>
                </div>
              )}

              {/* Content stats */}
              <div className='px-4 py-2 bg-muted/30 border-b border-border text-[10px] font-medium text-muted-foreground uppercase tracking-tight flex items-center gap-3'>
                <span>{charCount.toLocaleString()} characters</span>
                <span className='w-1 h-1 rounded-full bg-muted-foreground/30'></span>
                <span>{lineCount.toLocaleString()} lines</span>
              </div>

              {/* File content preview */}
              {content && (
                <div className='max-h-[300px] overflow-auto'>
                  <pre className='p-4 text-xs font-mono text-foreground/90 whitespace-pre-wrap break-words leading-relaxed'>
                    {content.length > 2000 ? `${content.substring(0, 2000)}...` : content}
                  </pre>
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
        Error parsing write tool data: {error instanceof Error ? error.message : 'Unknown error'}
      </div>
    );
  }
};

export default ToolWriteRenderer;
