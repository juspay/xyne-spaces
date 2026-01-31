import React from 'react';
import MarkdownPreview from '@uiw/react-markdown-preview';
import { BaseStepRendererProps, LLMCallData } from './types';

type SafeRecord = Record<string, unknown>;

const parseLlmData = (data: LLMCallData | string | SafeRecord): { response: string } => {
  try {
    const record: SafeRecord =
      typeof data === 'string' ? (JSON.parse(data) as SafeRecord) : (data as SafeRecord);

    const turn = record['turn'] as SafeRecord | undefined;
    const result = turn?.['result'] as SafeRecord | undefined;
    const responseValue = record['response'] || record['content'] || result?.['content'];
    const response = typeof responseValue === 'string' ? responseValue : '';
    return { response };
  } catch {
    return { response: '' };
  }
};

export const LLMCallRenderer: React.FC<
  BaseStepRendererProps<LLMCallData | string | SafeRecord>
> = ({ data }) => {
  // Parse data safely - any parsing errors are handled by parseLlmData
  const { response } = parseLlmData(data);

  if (!response || response.trim() === '') {
    return null;
  }

  // Show full content without truncation
  return (
    <div
      className='text-gray-800 dark:text-gray-200 border-0 px-1 py-2 overflow-hidden max-w-full min-w-0 m-2'
      style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
    >
      <div className='overflow-hidden max-w-full [&_*]:max-w-full [&_pre]:overflow-x-auto [&_pre]:max-w-full [&_code]:break-all [&_pre]:!bg-gray-50 [&_pre_code]:!text-gray-900 [&_.wmde-markdown]:bg-transparent [&_.wmde-markdown_code]:!bg-gray-50 [&_.wmde-markdown_code]:!text-gray-900'>
        <MarkdownPreview
          source={response}
          style={{
            backgroundColor: 'transparent',
            color: 'inherit',
            maxWidth: '100%',
            overflow: 'hidden',
          }}
          wrapperElement={{
            'data-color-mode': 'light',
          }}
        />
      </div>
    </div>
  );
};
