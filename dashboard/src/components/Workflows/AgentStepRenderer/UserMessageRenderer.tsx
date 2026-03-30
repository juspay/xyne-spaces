import React, { useState } from 'react';
import { User } from 'lucide-react';
import { BaseStepRendererProps } from './types';
import { USER_REPLY_PREFIX, USER_MESSAGE_CHAR_LIMIT } from '../constants';

type SafeRecord = Record<string, unknown>;

interface UserMessageData {
  message: string;
  timestamp?: string | undefined;
}

const parseUserMessageData = (data: UserMessageData | string | SafeRecord): UserMessageData => {
  try {
    const record: SafeRecord =
      typeof data === 'string' ? (JSON.parse(data) as SafeRecord) : (data as SafeRecord);

    // Support both 'message' and 'content' fields (backend uses 'content')
    const message =
      typeof record['message'] === 'string'
        ? record['message']
        : typeof record['content'] === 'string'
          ? record['content']
          : '';
    const timestamp = typeof record['timestamp'] === 'string' ? record['timestamp'] : undefined;

    const strippedMessage = message.startsWith(USER_REPLY_PREFIX)
      ? message.slice(USER_REPLY_PREFIX.length)
      : message;
    const result: UserMessageData = { message: strippedMessage };
    if (timestamp !== undefined) {
      result.timestamp = timestamp;
    }
    return result;
  } catch {
    return { message: '' };
  }
};

export const UserMessageRenderer: React.FC<
  BaseStepRendererProps<UserMessageData | string | SafeRecord>
> = ({ data }) => {
  const { message, timestamp } = parseUserMessageData(data);
  const [isExpanded, setIsExpanded] = useState(false);

  if (!message) {
    return null;
  }

  const isTruncated = message.length > USER_MESSAGE_CHAR_LIMIT;
  const displayedMessage =
    isTruncated && !isExpanded ? message.slice(0, USER_MESSAGE_CHAR_LIMIT) + '…' : message;

  return (
    <div
      className='text-foreground dark:text-gray-200 border-0 px-1 py-2 overflow-hidden max-w-full min-w-0'
      style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
    >
      <div className='flex items-start gap-3'>
        <div className='flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center'>
          <User className='w-4 h-4 text-blue-600 dark:text-blue-300' />
        </div>
        <div className='flex-1 min-w-0'>
          <div className='flex items-center gap-2 mb-1'>
            <span className='text-sm font-medium text-foreground dark:text-muted'>User Input</span>
            {timestamp && (
              <span className='text-xs text-muted-foreground dark:text-muted-foreground'>
                {timestamp}
              </span>
            )}
            {isTruncated && isExpanded && (
              <button
                onClick={() => setIsExpanded(false)}
                className='ml-auto text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline focus:outline-none'
                data-track-category='UserMessageRenderer'
                data-track-name='ShowLess'
              >
                Show less
              </button>
            )}
          </div>
          <div className='bg-blue-50 dark:bg-blue-900/30 rounded-lg p-3 border border-blue-200 dark:border-blue-700'>
            <p className='text-sm text-foreground dark:text-gray-200 whitespace-pre-wrap'>
              {displayedMessage}
            </p>
            {isTruncated && (
              <button
                onClick={() => setIsExpanded(prev => !prev)}
                className='mt-2 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline focus:outline-none'
                data-track-category='UserMessageRenderer'
                data-track-name='ToggleExpand'
              >
                {isExpanded ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserMessageRenderer;
