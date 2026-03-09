import React from 'react';
import { BaseStepRendererProps, ToolGlobData } from './types';

export const ToolGlobRenderer: React.FC<
  BaseStepRendererProps<ToolGlobData | string | Record<string, unknown>>
> = ({ data }) => {
  try {
    let parsedData: ToolGlobData;

    if (typeof data === 'string') {
      const objectData = JSON.parse(data) as unknown;
      if (objectData && typeof objectData === 'object') {
        if ('input' in objectData && 'output' in objectData) {
          parsedData = objectData as ToolGlobData;
        } else {
          // Fallback structure for generic objects
          const genericData = objectData as Record<string, unknown>;
          const inputData: { pattern: string; path?: string } = {
            pattern: (genericData['pattern'] as string) || '',
          };

          if (genericData['path']) {
            inputData.path = genericData['path'] as string;
          }

          parsedData = {
            input: inputData,
            output: {
              files: (genericData['files'] as string[]) || [],
              error: (genericData['error'] as string) || '',
              count: (genericData['count'] as number) || 0,
            },
          };
        }
      } else {
        throw new Error('Invalid data format');
      }
    } else if (data && typeof data === 'object') {
      const genericData = data as Record<string, unknown>;

      if ('input' in genericData && 'output' in genericData) {
        parsedData = data as ToolGlobData;
      } else {
        const inputData: { pattern: string; path?: string } = {
          pattern: (genericData['pattern'] as string) || '',
        };

        if (genericData['path']) {
          inputData.path = genericData['path'] as string;
        }

        parsedData = {
          input: inputData,
          output: {
            files: (genericData['files'] as string[]) || [],
            error: (genericData['error'] as string) || '',
            count: (genericData['count'] as number) || 0,
          },
        };
      }
    } else {
      throw new Error('Invalid data format');
    }

    const { input, output } = parsedData;
    const pattern = input.pattern;
    const searchPath = input.path;
    const files = output?.files || [];
    const error = output?.error;
    const count = output?.count || files.length;

    return (
      <div className='space-y-3 text-sm'>
        <div>
          <span className='font-semibold text-foreground dark:text-gray-100'>Input:</span>
          <div className='space-y-2 mt-2'>
            <div>
              <span className='font-medium text-foreground dark:text-gray-100'>Pattern: </span>
              <code className='bg-muted dark:bg-gray-800 px-2 py-1 rounded text-xs text-foreground dark:text-muted'>
                {pattern}
              </code>
            </div>
            {searchPath && (
              <div>
                <span className='font-medium text-foreground dark:text-gray-100'>
                  Search Path:{' '}
                </span>
                <code className='bg-muted dark:bg-gray-800 px-2 py-1 rounded text-xs text-foreground dark:text-muted'>
                  {searchPath}
                </code>
              </div>
            )}
          </div>
        </div>

        <div>
          <span className='font-semibold text-foreground dark:text-gray-100'>Output:</span>
          <div className='space-y-2 mt-2'>
            {error && (
              <div>
                <span className='font-medium text-red-600 dark:text-red-400 block mb-1'>
                  Error:
                </span>
                <div className='bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 p-3 rounded text-xs text-red-700 dark:text-red-300'>
                  {error}
                </div>
              </div>
            )}

            {!error && (
              <>
                <div>
                  <span className='font-medium text-foreground dark:text-gray-100'>
                    Files Found:{' '}
                  </span>
                  <span className='text-foreground dark:text-muted'>{count}</span>
                </div>

                {files.length > 0 && (
                  <div>
                    <span className='font-medium text-foreground dark:text-gray-100 block mb-2'>
                      Matching Files:
                    </span>
                    <div className='bg-muted dark:bg-gray-800 p-3 rounded text-xs max-h-64 overflow-auto border'>
                      {files.map((file, _index) => (
                        <div
                          key={file}
                          className='font-mono text-foreground dark:text-muted py-0.5'
                        >
                          {file}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {files.length === 0 && !error && (
                  <div className='text-muted-foreground dark:text-muted-foreground italic'>
                    No files matched the pattern
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    );
  } catch (error) {
    return (
      <div className='text-red-600 dark:text-red-400 text-sm'>
        Error parsing glob tool data: {error instanceof Error ? error.message : 'Unknown error'}
      </div>
    );
  }
};
