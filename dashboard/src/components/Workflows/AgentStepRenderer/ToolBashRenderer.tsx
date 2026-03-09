import React, { JSX } from 'react';
import { BaseStepRendererProps, ToolBashData } from './types';
import { Terminal } from 'lucide-react';

export const ToolBashRenderer: React.FC<
  BaseStepRendererProps<ToolBashData | string | Record<string, unknown>>
> = ({ data }) => {
  try {
    // Handle different data formats - could be string, ToolBashData, or generic object
    let parsedData: ToolBashData;

    if (typeof data === 'string') {
      const objectData = JSON.parse(data) as unknown;
      if (objectData && typeof objectData === 'object') {
        if ('input' in objectData && 'output' in objectData) {
          parsedData = objectData as ToolBashData;
        } else {
          // Fallback structure for generic objects
          const genericData = objectData as Record<string, unknown>;
          parsedData = {
            input: {
              command: (genericData['command'] as string) || 'Unknown command',
            },
            output: {
              stdout: (genericData['stdout'] as string) || '',
              stderr: (genericData['stderr'] as string) || '',
              exitCode: (genericData['exitCode'] as number) || 0,
            },
          };
        }
      } else {
        throw new Error('Invalid data format');
      }
    } else if (data && typeof data === 'object') {
      // Try to map generic object to ToolBashData structure
      const genericData = data as Record<string, unknown>;

      if ('input' in genericData && 'output' in genericData) {
        parsedData = data as ToolBashData;
      } else {
        // Fallback structure
        parsedData = {
          input: {
            command: (genericData['command'] as string) || 'Unknown command',
          },
          output: {
            stdout: (genericData['stdout'] as string) || '',
            stderr: (genericData['stderr'] as string) || '',
            exitCode: (genericData['exitCode'] as number) || 0,
          },
        };
      }
    } else {
      throw new Error('Invalid data format');
    }

    const { input, output } = parsedData;
    const command = input.command || '';
    const description = input.description || '';
    const stdout = output?.stdout || '';
    const stderr = output?.stderr || '';
    const exitCode = output?.exitCode;
    const duration = parsedData.duration || 0;
    const error = output?.error || '';

    // Format output with proper line breaks
    const formatOutput = (text: string): JSX.Element[] => {
      return text.split('\n').map((line, index) => (
        <div key={index} className='font-mono text-xs'>
          {line}
        </div>
      ));
    };

    if (!output || (!stdout && !stderr && !error && typeof exitCode === 'undefined')) {
      return (
        <div className='border rounded-md overflow-auto overflow-safe word-break-safe'>
          <div className='px-2 border-b py-2 flex items-center gap-2'>
            <span>
              <Terminal className='size-4 text-muted-foreground' />
            </span>
            <span className='text-sm font-medium flex-1 truncate'>Bash Command</span>
          </div>
          <div className='px-2 py-2'>
            <pre className='text-xs font-mono text-wrap overflow-safe'>
              <code className='text-wrap'>{command}</code>
            </pre>
          </div>
        </div>
      );
    }

    return (
      <div className='space-y-3 text-sm overflow-safe word-break-safe'>
        <div className='overflow-safe'>
          <span className='font-semibold text-foreground dark:text-gray-100'>Input:</span>
          <div className='space-y-2 mt-2'>
            <code className='bg-muted dark:bg-gray-800 px-2 py-1 rounded text-xs text-foreground dark:text-gray-200 block text-wrap overflow-safe'>
              {command}
            </code>
            {description && (
              <div className='text-xs text-muted-foreground dark:text-muted-foreground italic'>
                {description}
              </div>
            )}
          </div>
        </div>

        <div className='overflow-safe'>
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

            {!error && stdout && (
              <div className='overflow-safe'>
                <div className='bg-muted dark:bg-gray-800 p-3 rounded text-xs scroll-safe max-h-96 font-mono text-wrap overflow-auto'>
                  {formatOutput(stdout)}
                </div>
              </div>
            )}

            {!error && stderr && (
              <div className='overflow-safe'>
                <span
                  className={`font-medium block mb-2 ${
                    typeof exitCode === 'undefined' || exitCode === 0
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {typeof exitCode === 'undefined' || exitCode === 0
                    ? 'Output (stderr):'
                    : 'STDERR:'}
                </span>
                <div
                  className={`p-3 rounded text-xs scroll-safe max-h-32 font-mono text-wrap border-l-4 ${
                    typeof exitCode === 'undefined' || exitCode === 0
                      ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-500 text-amber-700 dark:text-amber-300'
                      : 'bg-red-50 dark:bg-red-900/20 border-red-500 text-red-700 dark:text-red-300'
                  }`}
                >
                  {formatOutput(stderr)}
                </div>
              </div>
            )}

            {!error && typeof exitCode !== 'undefined' && exitCode !== 0 && (
              <div>
                <span className='font-medium text-foreground dark:text-gray-100'>Exit Code: </span>
                <span className='px-2 py-1 rounded text-xs bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300'>
                  {exitCode}
                </span>
              </div>
            )}

            {!error && duration > 0 && (
              <div>
                <span className='font-medium text-foreground dark:text-gray-100'>Duration: </span>
                <span className='text-foreground dark:text-muted'>{duration}ms</span>
              </div>
            )}

            {!error && !stdout && !stderr && (
              <div className='bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500 p-3 rounded'>
                <p className='text-sm text-blue-700 dark:text-blue-300'>
                  ✓ Command executed successfully with no output
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  } catch (error) {
    return (
      <div className='text-red-600 dark:text-red-400 text-sm'>
        Error parsing bash tool data: {error instanceof Error ? error.message : 'Unknown error'}
      </div>
    );
  }
};
