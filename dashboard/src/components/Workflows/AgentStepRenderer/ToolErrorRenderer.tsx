import React from 'react';
import { AlertCircle } from 'lucide-react';

interface FrameworkErrorData {
  error: string;
  stack?: string;
  timestamp?: string;
}

interface ToolErrorRendererProps {
  data: FrameworkErrorData | string | Record<string, unknown>;
}

export const ToolErrorRenderer: React.FC<ToolErrorRendererProps> = ({ data }) => {
  try {
    let parsedData: FrameworkErrorData;

    if (typeof data === 'string') {
      parsedData = JSON.parse(data) as FrameworkErrorData;
    } else if (data && typeof data === 'object') {
      const genericData = data as Record<string, unknown>;
      parsedData = {
        error:
          typeof genericData['error'] === 'string'
            ? genericData['error']
            : genericData['error']
              ? JSON.stringify(genericData['error'])
              : 'Unknown error',
      };
      if (genericData['stack'] && typeof genericData['stack'] === 'string') {
        parsedData.stack = genericData['stack'];
      }
      if (genericData['timestamp'] && typeof genericData['timestamp'] === 'string') {
        parsedData.timestamp = genericData['timestamp'];
      }
    } else {
      throw new Error('Invalid data format');
    }

    const { error, stack, timestamp } = parsedData;

    return (
      <div className='border border-red-200 dark:border-red-800 rounded-md overflow-hidden bg-red-50 dark:bg-red-900/10'>
        <div className='px-3 py-2 bg-red-100 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 flex items-center gap-2'>
          <AlertCircle className='size-4 text-red-600 dark:text-red-400' />
          <span className='text-sm font-medium text-red-900 dark:text-red-100'>
            Framework Error
          </span>
          {timestamp && (
            <span className='ml-auto text-xs text-red-600 dark:text-red-400'>
              {new Date(timestamp).toLocaleTimeString()}
            </span>
          )}
        </div>
        <div className='p-3 space-y-2'>
          <div className='text-sm text-red-800 dark:text-red-200 font-medium'>{error}</div>
          {stack && (
            <details className='text-xs'>
              <summary className='cursor-pointer text-red-600 dark:text-red-400 hover:underline'>
                Stack Trace
              </summary>
              <pre className='mt-2 p-2 bg-red-100 dark:bg-red-900/30 rounded text-red-900 dark:text-red-100 overflow-x-auto text-xs font-mono'>
                {stack}
              </pre>
            </details>
          )}
        </div>
      </div>
    );
  } catch (parseError) {
    return (
      <div className='text-red-600 dark:text-red-400 text-sm p-2 border border-red-200 dark:border-red-800 rounded'>
        Error parsing framework error data:{' '}
        {parseError instanceof Error ? parseError.message : 'Unknown error'}
      </div>
    );
  }
};
