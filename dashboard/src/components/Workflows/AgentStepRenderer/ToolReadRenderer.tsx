import React from 'react';
import { BaseStepRendererProps, ToolReadData } from './types';
import { FileText } from 'lucide-react';

export const ToolReadRenderer: React.FC<
  BaseStepRendererProps<ToolReadData | string | Record<string, unknown>>
> = ({ data }) => {
  try {
    // Handle different data formats - could be string, ToolReadData, or generic object
    let parsedData: ToolReadData;

    if (typeof data === 'string') {
      const objectData = JSON.parse(data) as unknown;
      if (objectData && typeof objectData === 'object') {
        if ('input' in objectData && 'output' in objectData) {
          parsedData = objectData as ToolReadData;
        } else {
          // Fallback structure for generic objects
          const genericData = objectData as Record<string, unknown>;
          parsedData = {
            input: {
              // eslint-disable-next-line @typescript-eslint/naming-convention
              file_path:
                (genericData['file_path'] as string) ||
                (genericData['path'] as string) ||
                'Unknown file',
            },
            output: {
              content: (genericData['content'] as string) || '',
              error: (genericData['error'] as string) || '',
              suggestions: (genericData['suggestions'] as string[]) || [],
            },
          };
        }
      } else {
        throw new Error('Invalid data format');
      }
    } else if (data && typeof data === 'object') {
      // Try to map generic object to ToolReadData structure
      const genericData = data as Record<string, unknown>;

      if ('input' in genericData && 'output' in genericData) {
        parsedData = data as ToolReadData;
      } else {
        // Fallback structure
        parsedData = {
          input: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            file_path:
              (genericData['file_path'] as string) ||
              (genericData['path'] as string) ||
              'Unknown file',
          },
          output: {
            content: (genericData['content'] as string) || '',
            error: (genericData['error'] as string) || '',
            suggestions: (genericData['suggestions'] as string[]) || [],
          },
        };
      }
    } else {
      throw new Error('Invalid data format');
    }

    const { input } = parsedData;
    const filePath = input.file_path || '';
    const fileName = filePath.split('/').pop() || '';

    return (
      <div className='flex items-center gap-1.5 w-full text-xs'>
        <span>
          <FileText className='size-3 text-muted-foreground shrink-0' />
        </span>
        <span className='font-medium'>Read</span>
        <span className='text-muted-foreground flex-1 text-left truncate'>{fileName}</span>
      </div>
    );
  } catch (error) {
    return (
      <div className='text-red-600 dark:text-red-400 text-sm'>
        Error parsing read tool data: {error instanceof Error ? error.message : 'Unknown error'}
      </div>
    );
  }
};
