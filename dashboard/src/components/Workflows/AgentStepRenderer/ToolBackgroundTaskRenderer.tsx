import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BaseStepRendererProps } from './types';

interface BackgroundTaskSummaryItem {
  id: string;
  tool: string;
  state: {
    status: 'pending' | 'running' | 'completed' | 'error';
    title?: string;
  };
}

interface ParsedBackgroundTaskOutput {
  content?: string;
  isInitialLaunch?: boolean;
  sessionId?: string | null;
  taskTitle?: string;
  summary?: BackgroundTaskSummaryItem[];
  toolCallsSummary?: string;
}

interface BackgroundTaskInput {
  subagentType?: string;
  description?: string;
  prompt?: string;
  runInBackground?: boolean;
  loadSkills?: string[];
  taskId?: string;
}

interface ToolBackgroundTaskData {
  id?: string;
  input?: BackgroundTaskInput;
  output?: ParsedBackgroundTaskOutput | string;
  duration?: number;
}

type DataInput = ToolBackgroundTaskData | string | Record<string, unknown>;

function parseData(data: DataInput): ToolBackgroundTaskData {
  if (typeof data === 'string') {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    if ('input' in parsed || 'output' in parsed) {
      return parsed as ToolBackgroundTaskData;
    }
    return { output: { content: JSON.stringify(parsed) } };
  }

  if (data && typeof data === 'object') {
    if ('input' in data || 'output' in data) {
      return data as ToolBackgroundTaskData;
    }
    return { output: { content: JSON.stringify(data) } };
  }

  throw new Error('Invalid data format');
}

function parseOutput(
  rawOutput: ParsedBackgroundTaskOutput | string | undefined,
): ParsedBackgroundTaskOutput {
  if (!rawOutput) return {};
  if (typeof rawOutput === 'string') {
    try {
      return JSON.parse(rawOutput) as ParsedBackgroundTaskOutput;
    } catch {
      return { content: rawOutput };
    }
  }
  return rawOutput;
}

function getStatusStyle(status: string): string {
  const lowerStatus = status.toLowerCase();
  if (lowerStatus.includes('completed')) {
    return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
  }
  if (lowerStatus.includes('running')) {
    return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
  }
  return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
}

function getToolStatusDisplay(status: string): { icon: string; color: string } {
  if (status === 'completed') return { icon: '✓', color: 'text-green-600 dark:text-green-400' };
  if (status === 'error') return { icon: '✗', color: 'text-red-600 dark:text-red-400' };
  return { icon: '...', color: 'text-blue-600 dark:text-blue-400' };
}

export const ToolBackgroundTaskRenderer: React.FC<
  BaseStepRendererProps<DataInput> & { toolName?: string }
> = ({ data, toolName = 'background_task' }) => {
  try {
    const parsedData = parseData(data);
    const input = parsedData.input ?? {};
    const output = parseOutput(parsedData.output);

    const {
      content = '',
      sessionId,
      taskTitle,
      summary,
      toolCallsSummary,
      isInitialLaunch,
    } = output;

    const statusMatch = content.match(/Status[:|]\s*\*?\*?([^*\n|]+)\*?\*?/i);
    const agentMatch = content.match(/Agent[:|]\s*([^\n|]+)/i);
    const durationMatch = content.match(/Duration[:|]\s*([^\n|]+)/i);

    const status = statusMatch?.[1]?.trim();
    const agent = agentMatch?.[1]?.trim() ?? input.subagentType;
    const duration =
      durationMatch?.[1]?.trim() ?? (parsedData.duration ? `${parsedData.duration}ms` : undefined);
    const description = input.description ?? taskTitle;
    const isLaunch =
      toolName === 'delegate_task' || toolName === 'background_task' || isInitialLaunch;

    return (
      <div className='space-y-3 text-sm'>
        {(description || agent || input.prompt) && (
          <div>
            <span className='font-semibold text-gray-900 dark:text-gray-100'>Input:</span>
            <div className='space-y-2 mt-2'>
              {description && (
                <div>
                  <span className='font-medium text-gray-900 dark:text-gray-100'>
                    Description:{' '}
                  </span>
                  <span className='text-gray-700 dark:text-gray-300'>{description}</span>
                </div>
              )}
              {agent && (
                <div>
                  <span className='font-medium text-gray-900 dark:text-gray-100'>Agent: </span>
                  <code className='bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded text-xs text-gray-700 dark:text-gray-300'>
                    {agent}
                  </code>
                </div>
              )}
              {input.prompt && (
                <div>
                  <span className='font-medium text-gray-900 dark:text-gray-100 block mb-1'>
                    Prompt:
                  </span>
                  <div className='bg-gray-100 dark:bg-gray-800 p-3 rounded text-xs max-h-32 overflow-auto border'>
                    {input.prompt}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <div>
          <span className='font-semibold text-gray-900 dark:text-gray-100'>Output:</span>
          <div className='space-y-2 mt-2'>
            {status && (
              <div>
                <span className='font-medium text-gray-900 dark:text-gray-100'>Status: </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium ${getStatusStyle(status)}`}
                >
                  {status}
                </span>
              </div>
            )}

            {sessionId && (
              <div>
                <span className='font-medium text-gray-900 dark:text-gray-100'>Session ID: </span>
                <code className='bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded text-xs text-gray-700 dark:text-gray-300'>
                  {sessionId}
                </code>
              </div>
            )}

            {duration && (
              <div>
                <span className='font-medium text-gray-900 dark:text-gray-100'>Duration: </span>
                <span className='text-gray-700 dark:text-gray-300'>{duration}</span>
              </div>
            )}

            {summary && summary.length > 0 && (
              <div>
                <span className='font-medium text-gray-900 dark:text-gray-100 block mb-2'>
                  Tools Executed ({summary.length}):
                </span>
                <div className='bg-gray-100 dark:bg-gray-800 p-3 rounded text-xs max-h-48 overflow-auto border'>
                  {summary.map((tool, idx) => {
                    const { icon, color } = getToolStatusDisplay(tool.state.status);
                    return (
                      <div
                        key={tool.id || idx}
                        className='font-mono text-gray-700 dark:text-gray-300 py-0.5 flex items-center gap-2'
                      >
                        <span className={color}>{icon}</span>
                        <span>{tool.tool}</span>
                        {tool.state.title && (
                          <span className='text-gray-500 dark:text-gray-400 truncate'>
                            - {tool.state.title}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {!summary && toolCallsSummary && (
              <div>
                <span className='font-medium text-gray-900 dark:text-gray-100 block mb-2'>
                  Tools Executed:
                </span>
                <pre className='bg-gray-100 dark:bg-gray-800 p-3 rounded text-xs max-h-48 overflow-auto border whitespace-pre-wrap'>
                  {toolCallsSummary}
                </pre>
              </div>
            )}

            {content && (
              <div>
                <span className='font-medium text-gray-900 dark:text-gray-100 block mb-2'>
                  {isLaunch ? 'Task Launched:' : 'Result:'}
                </span>
                <div className='bg-gray-100 dark:bg-gray-800 p-3 rounded text-xs max-h-64 overflow-auto border prose prose-sm prose-gray dark:prose-invert max-w-none'>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                </div>
              </div>
            )}

            {!status && !sessionId && !content && !summary && !toolCallsSummary && (
              <div className='text-gray-500 dark:text-gray-400 italic'>No output available</div>
            )}
          </div>
        </div>
      </div>
    );
  } catch (error) {
    return (
      <div className='text-red-600 dark:text-red-400 text-sm'>
        Error parsing background task data:{' '}
        {error instanceof Error ? error.message : 'Unknown error'}
      </div>
    );
  }
};

export default ToolBackgroundTaskRenderer;
