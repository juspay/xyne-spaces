import { TeamHighlight } from '@/services/TeamIntelligence/teamIntelligenceService';
import { cn } from '@/utils/classNames';
import { formatReportDate } from '@/utils/teamIntelligenceUtils';
import {
  AwardIcon,
  BookOpenIcon,
  GraduationCapIcon,
  HandshakeIcon,
  RocketIcon,
  StarIcon,
  TargetIcon,
} from 'lucide-react';
import { ReactElement } from 'react';

export const highlightTypeConfig = {
  default: { icon: StarIcon, label: 'Highlight', color: 'text-action-accent bg-action-accent/10' },
  shipped: {
    icon: RocketIcon,
    label: 'Shipped',
    color: 'text-pink-600 bg-pink-600/10',
  },
  achievement: { icon: AwardIcon, label: 'Achievement', color: 'text-green-600 bg-green-600/10' },
  collaboration: {
    icon: HandshakeIcon,
    label: 'Collaboration',
    color: 'text-blue-500 bg-blue-500/10',
  },
  learning: { icon: GraduationCapIcon, label: 'Learning', color: 'text-cyan-600 bg-cyan-600/10' },
  recognition: { icon: StarIcon, label: 'Recognition', color: 'text-purple-600 bg-purple-600/10' },
  learned: { icon: BookOpenIcon, label: 'Learned', color: 'text-emerald-600 bg-emerald-600/10' },
  helped: { icon: HandshakeIcon, label: 'Helped', color: 'text-pink-600 bg-pink-600/10' },
  milestone: { icon: TargetIcon, label: 'Milestone', color: 'text-indigo-600 bg-indigo-600/10' },
};

export type HighlightType = Exclude<keyof typeof highlightTypeConfig, 'default'>;

export const getHighlightTypeConfig = (
  type?: string,
): (typeof highlightTypeConfig)[keyof typeof highlightTypeConfig] =>
  highlightTypeConfig[type as HighlightType] ?? highlightTypeConfig.default;

const HighlightCard = ({
  highlight,
  type = 'default',
}: {
  highlight: TeamHighlight;
  type: string;
}): ReactElement => {
  const config = getHighlightTypeConfig(type);
  const Icon = config.icon;

  // If bulletTitle not present, derive use the first 6 words of bulletText as title
  const title =
    highlight.bulletTitle ||
    highlight.bulletText.split(' ').slice(0, 6).join(' ') +
      (highlight.bulletText.split(' ').length > 6 ? '...' : '');

  return (
    <article className='rounded-xl border border-border/50 bg-card p-5 transition-all hover:border-border'>
      <div className='space-y-3'>
        <div className='flex items-center justify-between'>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
              config.color,
            )}
          >
            <Icon className='h-3 w-3' />
            {config.label}
          </span>
          <span className='text-xs text-muted-foreground'>
            {formatReportDate(highlight.reportDate)}
          </span>
        </div>
        <h4 className='text-base font-medium text-foreground'>{title}</h4>
        <p className='text-sm leading-relaxed text-muted-foreground'>{highlight.bulletText}</p>
      </div>
    </article>
  );
};

export default HighlightCard;
