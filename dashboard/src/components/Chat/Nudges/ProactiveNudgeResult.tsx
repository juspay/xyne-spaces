import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../ui/Button/Button';
import { cn } from '../../../utils/classNames';
import { navigateToSearchResult } from '../../../utils/searchNavigation';
import type { DisplaySearchResult, SearchContext } from '../../../types/search';
import { standaloneNavigate } from '../../../utils/electronApp';
import { useRouteContext } from '../../../hooks/useRouteContext';

interface ProactiveNudgeResultProps {
  actionResult: Record<string, unknown> | null;
  channelId?: string | undefined;
}

type TransformedSearchResult = {
  id: string;
  type: 'user' | 'conversation' | 'channel' | 'ticket' | 'attachment';
  title: string;
  subtitle?: string;
  context?: string;
  relevanceScore: number;
  avatar?: string;
  metadata: {
    timestamp?: string;
    channelName?: string;
    status?: string;
    fileSize?: string;
  };
  searchContext?: Record<string, unknown>;
  debugInfo?: Record<string, unknown>;
};

const mapToDisplayResult = (result: TransformedSearchResult): DisplaySearchResult => {
  const metadata: DisplaySearchResult['metadata'] = {};
  if (typeof result.metadata?.channelName === 'string') {
    metadata.channelName = result.metadata.channelName;
  }
  if (typeof result.metadata?.timestamp === 'string') {
    metadata.timestamp = result.metadata.timestamp;
  }
  if (typeof result.metadata?.status === 'string') {
    metadata.status = result.metadata.status;
  }
  if (typeof result.metadata?.fileSize === 'string') {
    metadata.fileSize = result.metadata.fileSize;
  }

  return {
    type: result.type,
    id: result.id,
    title: result.title,
    subtitle: result.subtitle || '',
    metadata,
    relevanceScore: result.relevanceScore,
    ...(typeof result.context === 'string' ? { context: result.context } : {}),
    ...(typeof result.avatar === 'string' ? { avatar: result.avatar } : {}),
    ...(result.searchContext ? { searchContext: result.searchContext as SearchContext } : {}),
    ...(result.debugInfo
      ? { debugInfo: result.debugInfo as NonNullable<DisplaySearchResult['debugInfo']> }
      : {}),
  };
};

export const ProactiveNudgeResult: React.FC<ProactiveNudgeResultProps> = ({
  actionResult,
  channelId,
}) => {
  const navigate = useNavigate();
  const { baseRoute } = useRouteContext();

  const normalized = useMemo(() => {
    if (!actionResult) return null;
    const actionType =
      (actionResult['actionType'] as string | undefined) ||
      (actionResult['action_type'] as string | undefined);
    const result =
      (actionResult['result'] as Record<string, unknown> | undefined) ||
      (actionResult['data'] as Record<string, unknown> | undefined) ||
      actionResult;
    return { actionType, result };
  }, [actionResult]);

  if (!normalized || !normalized.actionType) return null;

  if (normalized.actionType === 'CREATE_TICKET_FROM_MESSAGE') {
    return null;
  }

  if (normalized.actionType === 'OPEN_TICKET') {
    const result = normalized.result ?? {};
    const ticketId = typeof result['ticketId'] === 'string' ? result['ticketId'] : null;
    const targetChannelId =
      typeof result['channelId'] === 'string' ? result['channelId'] : (channelId ?? null);
    const conversationId =
      typeof result['conversationId'] === 'string' ? result['conversationId'] : null;

    if (!ticketId || !targetChannelId) return null;

    return (
      <div className='mt-2 flex items-center justify-end'>
        <Button
          size='sm'
          onClick={() =>
            standaloneNavigate(
              navigate,
              `${baseRoute}/${targetChannelId}?tab=tickets&ticketId=${ticketId}${
                conversationId ? `&conversationId=${conversationId}` : ''
              }`,
            )
          }
        >
          Open ticket
        </Button>
      </div>
    );
  }

  if (normalized.actionType === 'CREATE_KB_DRAFT_FROM_MESSAGE') {
    const viewAccessId = normalized.result?.['viewAccessId'] as string | undefined;
    const url =
      (normalized.result?.['url'] as string | undefined) ||
      (viewAccessId ? `/chat/canvas/${viewAccessId}` : undefined);
    if (!url) return null;

    return (
      <div className='mt-2 flex items-center justify-end'>
        <Button size='sm' onClick={() => standaloneNavigate(navigate, url)}>
          Open draft
        </Button>
      </div>
    );
  }

  if (normalized.actionType === 'SEARCH_TICKETS') {
    const results = (normalized.result?.['results'] as TransformedSearchResult[]) ?? [];
    if (results.length === 0) return null;

    const displayResults = results.map(mapToDisplayResult).slice(0, 3);

    return (
      <div className='mt-2 space-y-1'>
        <div className='text-xs font-medium text-gray-500'>Top matches</div>
        {displayResults.map(result => (
          <button
            key={result.id}
            className={cn(
              'w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-left text-xs',
              'hover:bg-gray-50 transition-colors',
            )}
            onClick={() => void navigateToSearchResult(result, navigate)}
          >
            <div className='font-semibold text-gray-800 truncate'>{result.title}</div>
            {result.subtitle && (
              <div className='text-[11px] text-gray-500 truncate'>{result.subtitle}</div>
            )}
          </button>
        ))}
        <div className='flex items-center justify-end pt-1'>
          <Button
            size='sm'
            variant='ghost'
            onClick={() => standaloneNavigate(navigate, '/tickets')}
          >
            View all tickets
          </Button>
        </div>
      </div>
    );
  }

  if (normalized.actionType === 'SEARCH_KB') {
    const results =
      (normalized.result?.['results'] as Array<{ title: string; content?: string }>) ?? [];
    if (results.length === 0) return null;

    return (
      <div className='mt-2 space-y-1'>
        <div className='text-xs font-medium text-gray-500'>Related knowledge</div>
        {results.slice(0, 3).map((doc, index) => (
          <div
            key={`${doc.title}-${index}`}
            className='w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-left text-xs'
          >
            <div className='font-semibold text-gray-800 truncate'>{doc.title}</div>
            {doc.content && <div className='text-[11px] text-gray-500 truncate'>{doc.content}</div>}
          </div>
        ))}
        <div className='flex items-center justify-end pt-1'>
          <Button
            size='sm'
            variant='ghost'
            onClick={() => standaloneNavigate(navigate, '/knowledge-base')}
          >
            View knowledge base
          </Button>
        </div>
      </div>
    );
  }

  return null;
};
