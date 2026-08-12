import { type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { File02Ai } from '@xyne/icons';
import { stripCitationTokens } from '../../routes/DailyBriefScreen/briefText';
import { dailyBriefApi } from '../../api/dailyBriefApi';

const MENTION_TOKEN_RE = /<[@#]([A-Za-z0-9_-]+)>/g;

function toPreview(line: string | undefined): string {
  if (!line) return '';
  return stripCitationTokens(line)
    .replace(MENTION_TOKEN_RE, '')
    .replace(/\*\*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function MorningBriefCard({
  to,
  label,
  active,
  className,
}: {
  to: string;
  label: string;
  active: boolean;
  className: string;
}): ReactElement {
  const { data: preview = '' } = useQuery({
    queryKey: ['daily-brief', 'latest-preview'],
    queryFn: async (): Promise<string> => {
      const latest = await dailyBriefApi.getLatest();
      if (latest.status === 'none') return '';
      return toPreview(latest.data?.what_needs_you?.[0]);
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false,
  });

  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      data-track-category='XyneAI'
      data-track-name='OPEN_DAILY_BRIEF'
      className={className}
    >
      <span className='flex size-4 shrink-0 items-center justify-center pt-0.5'>
        <File02Ai className='size-4' aria-hidden />
      </span>
      <span className='flex min-w-0 flex-1 flex-col gap-1 text-left'>
        <span className='block truncate leading-5'>{label}</span>
        {preview && (
          <span className='line-clamp-2 text-[12px] font-normal leading-4 tracking-[0.12px] text-sidebar-foreground'>
            {preview}
          </span>
        )}
      </span>
    </Link>
  );
}
