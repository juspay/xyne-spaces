import React from 'react';
import { BaseStepRendererProps, ToolLsData } from './types';
import { List } from 'lucide-react';

export const ToolLsRenderer: React.FC<
  BaseStepRendererProps<ToolLsData | string | Record<string, unknown>>
> = ({ data }) => {
  try {
    let parsedData: ToolLsData;

    if (typeof data === 'string') {
      const objectData = JSON.parse(data) as unknown;
      if (objectData && typeof objectData === 'object') {
        if ('input' in objectData && 'output' in objectData) {
          parsedData = objectData as ToolLsData;
        } else {
          // Fallback structure for generic objects
          const genericData = objectData as Record<string, unknown>;
          parsedData = {
            input: {
              path: (genericData['path'] as string) || '.',
              flags: (genericData['flags'] as string[]) || [],
            },
            output: {
              entries:
                (genericData['entries'] as Array<{
                  name: string;
                  type: 'file' | 'directory' | 'symlink';
                  size?: number;
                  modified?: string;
                  permissions?: string;
                }>) || [],
              error: (genericData['error'] as string) || '',
            },
          };
        }
      } else {
        throw new Error('Invalid data format');
      }
    } else if (data && typeof data === 'object') {
      const genericData = data as Record<string, unknown>;

      if ('input' in genericData && 'output' in genericData) {
        parsedData = data as ToolLsData;
      } else {
        parsedData = {
          input: {
            path: (genericData['path'] as string) || '.',
            flags: (genericData['flags'] as string[]) || [],
          },
          output: {
            entries:
              (genericData['entries'] as Array<{
                name: string;
                type: 'file' | 'directory' | 'symlink';
                size?: number;
                modified?: string;
                permissions?: string;
              }>) || [],
            error: (genericData['error'] as string) || '',
          },
        };
      }
    } else {
      throw new Error('Invalid data format');
    }

    const { input } = parsedData;
    const path = input.path || '.';
    // const flags = input.flags || [];
    // const entries = output.entries || [];
    // const error = output.error;

    // const formatFileSize = (bytes?: number): string => {
    //   if (!bytes) return '-';
    //   const units = ['B', 'KB', 'MB', 'GB'];
    //   let size = bytes;
    //   let unitIndex = 0;
    //   while (size >= 1024 && unitIndex < units.length - 1) {
    //     size /= 1024;
    //     unitIndex++;
    //   }
    //   return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
    // };

    // const getTypeIcon = (type: string): string => {
    //   switch (type) {
    //     case 'directory':
    //       return '📁';
    //     case 'symlink':
    //       return '🔗';
    //     case 'file':
    //     default:
    //       return '📄';
    //   }
    // };

    // console.log('data', data);

    return (
      <button className='flex items-start justify-end gap-1.5 w-full text-xs overflow-hidden'>
        <span className='shrink-0 size-3.5'>
          <List className='size-3.5 text-muted-foreground' />
        </span>
        <span className='text flex-1 text-left truncate text-muted-foreground'>
          Listed{' '}
          <span className='font-medium font-mono bg-muted-foreground/10 px-1 rounded text-xs'>
            {path}
          </span>
        </span>
      </button>
    );

    // return (
    //   <div className='space-y-3 text-sm overflow-safe word-break-safe debug m-2'>
    //     <div className='overflow-safe'>
    //       <span className='font-semibold text-foreground dark:text-gray-100'>Input:</span>
    //       <div className='space-y-2 mt-2'>
    //         <div>
    //           <span className='font-medium text-foreground dark:text-gray-100'>Path: </span>
    //           <code className='bg-muted dark:bg-gray-800 px-2 py-1 rounded text-xs text-foreground dark:text-muted text-wrap'>
    //             {path}
    //           </code>
    //         </div>
    //         {flags.length > 0 && (
    //           <div>
    //             <span className='font-medium text-foreground dark:text-gray-100'>Flags: </span>
    //             <div className='inline-flex gap-1'>
    //               {flags.map((flag, index) => (
    //                 <span
    //                   key={flag + index}
    //                   className='px-2 py-1 bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300 rounded text-xs'
    //                 >
    //                   {flag}
    //                 </span>
    //               ))}
    //             </div>
    //           </div>
    //         )}
    //       </div>
    //     </div>

    //     <div>
    //       <span className='font-semibold text-foreground dark:text-gray-100'>Output:</span>
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
    //             <div>
    //               <span className='font-medium text-foreground dark:text-gray-100'>
    //                 Entries Found:{' '}
    //               </span>
    //               <span className='text-foreground dark:text-muted'>{entries.length}</span>
    //             </div>

    //             {entries.length > 0 && (
    //               <div>
    //                 <span className='font-medium text-foreground dark:text-gray-100 block mb-2'>
    //                   Directory Listing:
    //                 </span>
    //                 <div className='bg-muted dark:bg-gray-800 rounded border max-h-64 scroll-safe'>
    //                   <div className='p-2 border-b border-border dark:border-gray-700 bg-muted dark:bg-gray-900 font-medium text-xs grid grid-cols-12 gap-2'>
    //                     <div className='col-span-1'>Type</div>
    //                     <div className='col-span-5'>Name</div>
    //                     <div className='col-span-2'>Size</div>
    //                     <div className='col-span-2'>Permissions</div>
    //                     <div className='col-span-2'>Modified</div>
    //                   </div>
    //                   {entries.map((entry, index) => (
    //                     <div
    //                       key={index}
    //                       className='p-2 border-b border-border dark:border-gray-700 last:border-b-0 text-xs grid grid-cols-12 gap-2 hover:bg-muted dark:hover:bg-gray-750'
    //                     >
    //                       <div className='col-span-1 flex items-center'>
    //                         <span className='mr-1'>{getTypeIcon(entry.type)}</span>
    //                       </div>
    //                       <div
    //                         className='col-span-5 font-mono text-foreground dark:text-muted truncate'
    //                         title={entry.name}
    //                       >
    //                         {entry.name}
    //                       </div>
    //                       <div className='col-span-2 text-muted-foreground dark:text-muted-foreground'>
    //                         {entry.type === 'file' ? formatFileSize(entry.size) : '-'}
    //                       </div>
    //                       <div className='col-span-2 font-mono text-muted-foreground dark:text-muted-foreground'>
    //                         {entry.permissions || '-'}
    //                       </div>
    //                       <div className='col-span-2 text-muted-foreground dark:text-muted-foreground'>
    //                         {entry.modified ? new Date(entry.modified).toLocaleDateString() : '-'}
    //                       </div>
    //                     </div>
    //                   ))}
    //                 </div>
    //               </div>
    //             )}

    //             {entries.length === 0 && !error && (
    //               <div className='text-muted-foreground dark:text-muted-foreground italic'>Directory is empty</div>
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
        Error parsing ls tool data: {error instanceof Error ? error.message : 'Unknown error'}
      </div>
    );
  }
};
