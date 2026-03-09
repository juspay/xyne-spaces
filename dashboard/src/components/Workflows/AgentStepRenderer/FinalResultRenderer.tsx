// FinalResultRenderer.tsx
import React, { useState } from 'react';
import MarkdownPreview from '@uiw/react-markdown-preview';
import { formatStepData, isGitInfo, buildBranchUrl } from '../utils/utils';

interface FinalResultRendererProps {
  data?: unknown;
  isExpanded?: boolean;
}

export const FinalResultRenderer: React.FC<FinalResultRendererProps> = ({
  data,
  isExpanded = false,
}) => {
  const [showFull, setShowFull] = useState(false);
  const [showFullFallback, setShowFullFallback] = useState(false);

  // If data is valid GitInfo, render link + JSON preview.
  if (isGitInfo(data)) {
    const { branch, repoUrl } = data;
    const branchUrl = buildBranchUrl(repoUrl, branch);

    const jsonString = formatStepData(data);
    const previewLimit = 500;
    const needsTruncation = jsonString.length > previewLimit;
    const preview = needsTruncation ? jsonString.slice(0, previewLimit) + '…' : jsonString;

    return (
      <div className='text-foreground dark:text-gray-200 border-0 px-1 py-2'>
        <div className='mb-2 text-sm space-y-1'>
          <div>
            <a
              href={branchUrl}
              target='_blank'
              rel='noopener noreferrer'
              className='text-blue-600 dark:text-blue-400 underline'
            >
              Open Branch: {branch}
            </a>
          </div>
          {'pr_link' in data && typeof data['pr_link'] === 'string' && (
            <div>
              <a
                href={data['pr_link']}
                target='_blank'
                rel='noopener noreferrer'
                className='text-green-600 dark:text-green-400 underline'
              >
                Open Pull Request
              </a>
            </div>
          )}
        </div>

        {isExpanded || showFull ? (
          <MarkdownPreview
            source={`\`\`\`json\n${jsonString}\n\`\`\``}
            style={{ backgroundColor: 'transparent', color: 'inherit' }}
            data-color-mode='auto'
          />
        ) : (
          <div>
            <MarkdownPreview
              source={`\`\`\`json\n${preview}\n\`\`\``}
              style={{ backgroundColor: 'transparent', color: 'inherit' }}
              data-color-mode='auto'
            />

            {needsTruncation && !showFull && (
              <button
                type='button'
                className='text-blue-600 dark:text-blue-400 hover:underline ml-1 text-xs'
                onClick={e => {
                  e.stopPropagation();
                  setShowFull(true);
                }}
                data-track-category='Workflows'
                data-track-name='ShowFullResult'
              >
                (show more)
              </button>
            )}
          </div>
        )}

        {!isExpanded && showFull && needsTruncation && (
          <button
            type='button'
            className='text-blue-600 dark:text-blue-400 hover:underline ml-1 text-xs'
            onClick={e => {
              e.stopPropagation();
              setShowFull(false);
            }}
            data-track-category='Workflows'
            data-track-name='ShowLessResult'
          >
            (show less)
          </button>
        )}
      </div>
    );
  }

  // Fallback: show formatted data (handles missing/invalid gitInfo)
  const fallbackJson = formatStepData(data);
  const previewLimit = 500;
  const needsTruncation = fallbackJson.length > previewLimit;
  const preview = needsTruncation ? fallbackJson.slice(0, previewLimit) + '…' : fallbackJson;

  return (
    <div className='text-foreground dark:text-gray-200 border-0 px-1 py-2'>
      <div className='mb-2 text-sm text-muted-foreground'>Branch link not available</div>

      {isExpanded || showFullFallback ? (
        <MarkdownPreview
          source={`\`\`\`json\n${fallbackJson}\n\`\`\``}
          style={{ backgroundColor: 'transparent', color: 'inherit' }}
          data-color-mode='auto'
        />
      ) : (
        <div>
          <MarkdownPreview
            source={`\`\`\`json\n${preview}\n\`\`\``}
            style={{ backgroundColor: 'transparent', color: 'inherit' }}
            data-color-mode='auto'
          />

          {needsTruncation && !showFullFallback && (
            <button
              type='button'
              className='text-blue-600 dark:text-blue-400 hover:underline ml-1 text-xs'
              onClick={e => {
                e.stopPropagation();
                setShowFullFallback(true);
              }}
              data-track-category='Workflows'
              data-track-name='ShowMoreFallbackResult'
            >
              (show more)
            </button>
          )}
        </div>
      )}

      {!isExpanded && showFullFallback && needsTruncation && (
        <button
          type='button'
          className='text-blue-600 dark:text-blue-400 hover:underline ml-1 text-xs'
          onClick={e => {
            e.stopPropagation();
            setShowFullFallback(false);
          }}
          data-track-category='Workflows'
          data-track-name='ShowLessFallbackResult'
        >
          (show less)
        </button>
      )}
    </div>
  );
};

export default FinalResultRenderer;
