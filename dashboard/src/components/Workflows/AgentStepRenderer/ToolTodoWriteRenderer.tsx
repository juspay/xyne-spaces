import React from 'react';
import { BaseStepRendererProps, ToolTodoWriteData } from './types';
import { Circle, CircleCheck, CircleDashed, ClipboardList } from 'lucide-react';
import { cn } from '../../ui/Tooltip';

type SafeRecord = Record<string, unknown>;

export const ToolTodoWriteRenderer: React.FC<
  BaseStepRendererProps<ToolTodoWriteData | string | SafeRecord>
> = ({ data }) => {
  try {
    let parsedData: ToolTodoWriteData | null = null;

    // ---------- Normalize input safely ----------
    if (typeof data === 'string') {
      const objectData = JSON.parse(data) as unknown;
      if (objectData && typeof objectData === 'object') {
        if ('input' in objectData && 'output' in objectData) {
          parsedData = objectData as ToolTodoWriteData;
        }
      }
    }

    if (typeof data === 'object' && data !== null) {
      const generic = data as SafeRecord;

      const input = generic['input'];
      const output = generic['output'];

      if (
        typeof input === 'object' &&
        input !== null &&
        typeof output === 'object' &&
        output !== null
      ) {
        parsedData = {
          input: {
            todos: Array.isArray((input as SafeRecord)['todos'])
              ? ((input as SafeRecord)['todos'] as ToolTodoWriteData['input']['todos'])
              : [],
          },
          output: {
            success:
              typeof (output as SafeRecord)['success'] === 'boolean'
                ? ((output as SafeRecord)['success'] as boolean)
                : false,
            error:
              typeof (output as SafeRecord)['error'] === 'string'
                ? ((output as SafeRecord)['error'] as string)
                : '',
            todosUpdated:
              typeof (output as SafeRecord)['todosUpdated'] === 'number'
                ? ((output as SafeRecord)['todosUpdated'] as number)
                : 0,
          },
        };
      }
    }

    if (!parsedData) {
      throw new Error('Invalid data format');
    }

    const todos = parsedData.input.todos ?? [];

    const success = parsedData.output.success ?? false;
    const error = parsedData.output.error ?? '';
    const todosUpdated = parsedData.output.todosUpdated;

    const getStatusIcon = (status: string): React.ReactNode => {
      switch (status) {
        case 'completed':
          return <CircleCheck className='size-4 text-muted-foreground' />;
        case 'in_progress':
          return <CircleDashed className='size-4 text-muted-foreground animate-spin' />;
        case 'pending':
        default:
          return <Circle className='size-4 text-muted-foreground' />;
      }
    };

    const isTodoInitialised =
      todos.length > 0 &&
      todos.every(todo => {
        const status = typeof todo.status === 'string' ? todo.status : 'pending';
        return status === 'pending';
      });

    const completedTodos = todos.filter(todo => {
      const status = typeof todo.status === 'string' ? todo.status : 'pending';
      return status === 'completed';
    });

    return (
      <div className='space-y-4 text-sm'>
        {/* Header */}
        {/* <div>
          <span className='font-semibold text-foreground dark:text-gray-100'>Todo List Update</span>
        </div> */}

        {/* Count */}
        {/* <div>
          <span className='font-medium text-foreground dark:text-gray-100'>Total Todos: </span>
          <span className='text-foreground dark:text-muted'>{todos.length}</span>
        </div> */}

        {/* Todos */}
        {todos.length > 0 && (
          <div>
            {/* <span className='font-semibold text-foreground dark:text-gray-100 block mb-2'>
              Todo Items
            </span> */}

            <div className='border rounded-md overflow-auto'>
              <div className='px-2 border-b py-2 flex items-center gap-2'>
                <span>
                  <ClipboardList className='size-4 text-muted-foreground' />
                </span>
                <span className='text-sm font-medium flex-1 truncate'>
                  Todo {isTodoInitialised ? 'Created' : 'Updated'}
                </span>
                {completedTodos.length > 0 && (
                  <span className='ml-auto text-muted-foreground text-xs tracking-tighter truncate'>
                    {completedTodos.length} / {todos.length}
                  </span>
                )}
              </div>
              {todos.map((todo, index) => {
                const status = typeof todo.status === 'string' ? todo.status : 'pending';

                const content = typeof todo.content === 'string' ? todo.content : '';

                // const activeForm =
                //   typeof (todo as SafeRecord)['activeForm'] === 'string'
                //     ? ((todo as SafeRecord)['activeForm'] as string)
                //     : null;

                return (
                  <div key={index} className='my-2 px-2 flex items-start gap-2'>
                    <span className='pt-[2px]'>{getStatusIcon(status)}</span>
                    <span
                      className={cn(
                        status === 'completed' ? 'line-through text-muted-foreground' : '',
                      )}
                    >
                      {content}
                    </span>
                    {/* <div className='flex items-start gap-3'>
                      <span className='text-lg flex-shrink-0 mt-0.5'>{getStatusIcon(status)}</span>

                      <div className='flex-1 min-w-0'>
                        <div className='flex items-center gap-2 mb-1'>
                          <span
                            className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(
                              status,
                            )}`}
                          >
                            {status.replace('_', ' ')}
                          </span>
                        </div>

                        <div className='text-sm text-foreground dark:text-gray-100 mb-1'>
                          {content}
                        </div>

                        {activeForm && (
                          <div className='text-xs text-muted-foreground dark:text-muted-foreground italic'>
                            Active: {activeForm}
                          </div>
                        )}
                      </div>
                    </div> */}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Output */}
        <div className='hidden'>
          <span className='font-semibold text-foreground dark:text-gray-100'>Output</span>

          <div className='space-y-2 mt-2'>
            {error && (
              <div>
                <span className='font-medium text-red-600 dark:text-red-400 block mb-1'>Error</span>
                <div className='bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 p-3 rounded text-xs text-red-700 dark:text-red-300'>
                  {error}
                </div>
              </div>
            )}

            {!error && (
              <>
                <div>
                  <span className='font-medium text-foreground dark:text-gray-100'>Status: </span>
                  <span
                    className={`px-2 py-1 rounded text-xs ${
                      success
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300'
                        : 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300'
                    }`}
                  >
                    {success ? 'Success' : 'Failed'}
                  </span>
                </div>

                {typeof todosUpdated === 'number' && (
                  <div>
                    <span className='font-medium text-foreground dark:text-gray-100'>
                      Todos Updated:{' '}
                    </span>
                    <span className='text-foreground dark:text-muted'>{todosUpdated}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    );
  } catch {
    return <></>;
  }
};
