import React from 'react';
import { BaseStepRendererProps, ToolGrepData } from './types';
import { Search } from 'lucide-react';

export const ToolGrepRenderer: React.FC<
  BaseStepRendererProps<ToolGrepData | string | Record<string, unknown>>
> = ({ data }) => {
  try {
    let parsedData: ToolGrepData;

    if (typeof data === 'string') {
      parsedData = JSON.parse(data) as ToolGrepData;
    } else if (data && typeof data === 'object') {
      const genericData = data as Record<string, unknown>;

      if ('input' in genericData && 'output' in genericData) {
        parsedData = data as ToolGrepData;
      } else {
        const inputData: {
          pattern: string;
          path?: string;
          // eslint-disable-next-line @typescript-eslint/naming-convention
          output_mode?: 'content' | 'files_with_matches' | 'count';
        } = {
          pattern: (genericData['pattern'] as string) || '',
        };

        if (genericData['path']) {
          inputData.path = genericData['path'] as string;
        }

        if (genericData['output_mode']) {
          inputData.output_mode = genericData['output_mode'] as
            | 'content'
            | 'files_with_matches'
            | 'count';
        }

        parsedData = {
          input: inputData,
          output: {
            matches: (genericData['matches'] as string[]) || [],
            files: (genericData['files'] as string[]) || [],
            count: (genericData['count'] as number) || 0,
            error: (genericData['error'] as string) || '',
          },
        };
      }
    } else {
      throw new Error('Invalid data format');
    }

    const { input } = parsedData;
    const pattern = input.pattern;
    const searchPath = input.path;
    // const outputMode = input.output_mode;
    // const matches = output.matches || [];
    // const files = output.files || [];
    // const count = output.count;
    // const error = output.error;

    return (
      <div>
        <button className='flex items-start justify-end gap-1.5 w-full text-xs'>
          <span className='shrink-0 size-4'>
            <Search className='size-3.5 text-muted-foreground' />
          </span>
          <span className='text-muted-foreground flex-1 text-left'>
            Grepped{' '}
            <span className='font-medium font-mono bg-muted-foreground/10 px-1 rounded text-xs'>
              &quot;{pattern}&quot;
            </span>{' '}
            in{' '}
            <span className='font-medium font-mono bg-muted-foreground/10 px-1 rounded text-xs'>
              {searchPath}
            </span>
          </span>
        </button>
      </div>
    );

    // return (
    //   <div className='space-y-3 text-sm overflow-safe word-break-safe'>
    //     <div className='overflow-safe'>
    //       <span className='font-semibold text-gray-900 dark:text-gray-100'>Input:</span>
    //       <div className='space-y-2 mt-2'>
    //         <div>
    //           <span className='font-medium text-gray-900 dark:text-gray-100'>Pattern: </span>
    //           <code className='bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded text-xs text-gray-700 dark:text-gray-300 text-wrap'>
    //             {pattern}
    //           </code>
    //         </div>
    //         {searchPath && (
    //           <div>
    //             <span className='font-medium text-gray-900 dark:text-gray-100'>Search Path: </span>
    //             <code className='bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded text-xs text-gray-700 dark:text-gray-300 text-wrap'>
    //               {searchPath}
    //             </code>
    //           </div>
    //         )}
    //         <div>
    //           <span className='font-medium text-gray-900 dark:text-gray-100'>Output Mode: </span>
    //           <span className='px-2 py-1 bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300 rounded text-xs'>
    //             {outputMode}
    //           </span>
    //         </div>
    //       </div>
    //     </div>

    //     <div>
    //       <span className='font-semibold text-gray-900 dark:text-gray-100'>Output:</span>
    //       <div className='space-y-2 mt-2'>
    //         {error && (
    //           <div>
    //             <span className='font-medium text-red-600 dark:text-red-400 block mb-1'>
    //               Error:
    //             </span>
    //             <div className='bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 p-3 rounded text-xs text-red-700 dark:text-red-300'>
    //               {error}
    //             </div>
    //           </div>
    //         )}

    //         {!error && (
    //           <>
    //             {outputMode === 'count' && count !== undefined && (
    //               <div>
    //                 <span className='font-medium text-gray-900 dark:text-gray-100'>
    //                   Match Count:{' '}
    //                 </span>
    //                 <span className='text-gray-700 dark:text-gray-300'>{count}</span>
    //               </div>
    //             )}

    //             {outputMode === 'files_with_matches' && files.length > 0 && (
    //               <div>
    //                 <span className='font-medium text-gray-900 dark:text-gray-100 block mb-2'>
    //                   Files with Matches ({files.length}):
    //                 </span>
    //                 <div className='bg-gray-100 dark:bg-gray-800 p-3 rounded text-xs max-h-64 scroll-safe border'>
    //                   {files.map((file, _index) => (
    //                     <div
    //                       key={file}
    //                       className='font-mono text-gray-700 dark:text-gray-300 py-0.5 text-wrap'
    //                     >
    //                       {file}
    //                     </div>
    //                   ))}
    //                 </div>
    //               </div>
    //             )}

    //             {outputMode === 'content' && matches.length > 0 && (
    //               <div>
    //                 <span className='font-medium text-gray-900 dark:text-gray-100 block mb-2'>
    //                   Matches ({matches.length}):
    //                 </span>
    //                 <div className='bg-gray-100 dark:bg-gray-800 p-3 rounded text-xs max-h-64 scroll-safe border'>
    //                   {matches.map((match, index) => (
    //                     <div
    //                       key={index}
    //                       className='font-mono text-gray-700 dark:text-gray-300 py-0.5 border-b border-gray-200 dark:border-gray-700 last:border-b-0 text-wrap'
    //                     >
    //                       {match}
    //                     </div>
    //                   ))}
    //                 </div>
    //               </div>
    //             )}

    //             {!error && matches.length === 0 && files.length === 0 && count === 0 && (
    //               <div className='text-gray-500 dark:text-gray-400 italic'>No matches found</div>
    //             )}
    //           </>
    //         )}
    //       </div>
    //     </div>
    //   </div>
    // );
  } catch (error) {
    return (
      <div className='text-red-600 dark:text-red-400 text-sm'>
        Error parsing grep tool data: {error instanceof Error ? error.message : 'Unknown error'}
      </div>
    );
  }
};
