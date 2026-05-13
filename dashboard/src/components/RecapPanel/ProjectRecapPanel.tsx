import { ReactElement } from 'react';
import DOMPurify from 'dompurify';
import { useNavigate } from 'react-router-dom';
import { Clock, TrendingUp, TrendingDown, FolderOpen } from 'lucide-react';
import {
  useProjectRecapData,
  type ProjectRecapSummary,
  type ProjectRecapPoint,
} from '../../hooks/useProjectRecapData';
import { usePlatform } from '../../hooks/usePlatform';

// ─── Greetings ────────────────────────────────────────────────────────────────

const PROJECT_GREETINGS = [
  'Project Pulse ⚡',
  'Daily Digest 📋',
  'What moved the needle 🎯',
  'Yesterday in review 🔍',
  'Your project highlights 🌟',
  "Here's what happened 📬",
  "The day's work 💼",
  'Across your projects 🗂️',
  'Key signals from yesterday 📡',
  'Project activity roundup 🔄',
];

// Stable per session
const sessionGreeting = PROJECT_GREETINGS[Math.floor(Math.random() * PROJECT_GREETINGS.length)]!;

// ─── Component ────────────────────────────────────────────────────────────────

const ProjectRecapPanel = (): ReactElement => {
  const { recaps, isLoading, error, isAccessDenied } = useProjectRecapData();
  const { isMobile } = usePlatform();
  const navigate = useNavigate();

  // Same navigation logic as RecapPanel: drill into message → conversation → channel
  const handleCitationClick = (point: ProjectRecapPoint): void => {
    if (point.conversationId && point.messageId) {
      const hash = `#origin=${point.conversationId}&messageId=${point.messageId}`;
      void navigate(`/chat/dir/recap/${point.channelId}/${point.conversationId}${hash}`);
    } else if (point.conversationId) {
      const hash = `#origin=${point.conversationId}`;
      void navigate(`/chat/dir/recap/${point.channelId}/${point.conversationId}${hash}`);
    } else {
      void navigate(`/chat/dir/recap/${point.channelId}`);
    }
  };

  if (isLoading) {
    return (
      <div className='flex flex-col items-center justify-center h-full p-8 text-center'>
        <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-4' />
        <p className='text-muted-foreground text-sm'>Loading project recaps…</p>
      </div>
    );
  }

  if (isAccessDenied) {
    return (
      <div className='flex flex-col items-center justify-center h-full p-8 text-center'>
        <Clock className='text-muted-foreground mb-4' size={48} />
        <p className='text-muted-foreground text-lg font-medium'>Project Recaps not available</p>
        <p className='text-xs text-muted-foreground/60 mt-2'>
          This feature is currently in early access.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className='flex flex-col items-center justify-center h-full p-8 text-center'>
        <p className='text-destructive text-sm'>{error}</p>
      </div>
    );
  }

  if (recaps.length === 0) {
    return (
      <div className='flex flex-col items-center justify-center h-full p-8 text-center'>
        <Clock className='text-muted-foreground mb-4' size={48} />
        <p className='text-muted-foreground text-lg font-medium'>
          No project recaps available for yesterday.
        </p>
        <p className='text-xs text-muted-foreground/60 mt-4'>
          Project recaps are generated nightly from your channels.
        </p>
      </div>
    );
  }

  const totalMessages = recaps.reduce((sum, r) => sum + r.messageCount, 0);
  const totalChannels = recaps.reduce((sum, r) => sum + r.channelCount, 0);

  // Render a single key point — same style as channel recap citation buttons
  const renderPoint = (point: ProjectRecapPoint, idx: number): ReactElement => (
    <li key={idx} className='flex items-start'>
      <span
        className={`text-foreground ${isMobile ? 'text-xs' : 'text-sm'} leading-relaxed font-normal font-['Inter'] inline`}
      >
        <span className='mr-2 text-muted-foreground'>•</span>
        <span
          dangerouslySetInnerHTML={{
            __html: DOMPurify.sanitize(
              point.point.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'),
              { ALLOWED_TAGS: ['strong'] },
            ),
          }}
        />
        <button
          onClick={() => handleCitationClick(point)}
          className="ml-1 inline-flex h-[17px] px-1 justify-center items-center rounded-[3px] bg-muted text-muted-foreground font-['Inter'] text-[10px] font-normal leading-[18px] hover:bg-accent transition-colors cursor-pointer align-middle"
          title={
            point.messageId
              ? `Jump to message in #${point.channelName}`
              : `View in #${point.channelName}`
          }
          data-track-category='PROJECT_RECAP_PANEL'
          data-track-name='CLICK_CITATION'
        >
          {point.citationIndex}
        </button>
      </span>
    </li>
  );

  const renderProjectCard = (recap: ProjectRecapSummary): ReactElement => (
    <div
      key={recap.projectId}
      className='border rounded-xl p-5 bg-card shadow-sm mb-5 transition-all duration-300 hover:shadow-md border-border'
    >
      {/* Header */}
      <div className='flex items-center gap-2 mb-3'>
        <FolderOpen size={16} className='text-muted-foreground' />
        <h3 className='text-foreground font-semibold text-base'>{recap.projectName}</h3>
        <span className='text-xs text-muted-foreground ml-auto'>
          {recap.channelCount} channel{recap.channelCount !== 1 ? 's' : ''} · {recap.messageCount}{' '}
          messages
        </span>
      </div>

      {/* Overall summary */}
      {recap.summary && (
        <p
          className={`text-muted-foreground ${isMobile ? 'text-xs' : 'text-sm'} mb-4 leading-relaxed`}
        >
          {recap.summary}
        </p>
      )}

      {/* Highlights (good) */}
      {recap.good.length > 0 && (
        <div className='mb-4'>
          <div className='flex items-center gap-1.5 mb-2'>
            <TrendingUp size={14} className='text-green-500' />
            <span className='text-xs font-semibold text-green-600 uppercase tracking-wide'>
              Highlights
            </span>
            <span className='text-xs text-muted-foreground'>({recap.good.length})</span>
          </div>
          <ul className='space-y-2 pl-1'>
            {recap.good.map((point, idx) => renderPoint(point, idx))}
          </ul>
        </div>
      )}

      {/* Concerns (bad) */}
      {recap.bad.length > 0 && (
        <div>
          <div className='flex items-center gap-1.5 mb-2'>
            <TrendingDown size={14} className='text-red-500' />
            <span className='text-xs font-semibold text-red-600 uppercase tracking-wide'>
              Concerns
            </span>
            <span className='text-xs text-muted-foreground'>({recap.bad.length})</span>
          </div>
          <ul className='space-y-2 pl-1'>
            {recap.bad.map((point, idx) => renderPoint(point, idx))}
          </ul>
        </div>
      )}
    </div>
  );

  return (
    <div className='h-full flex flex-col overflow-hidden'>
      {/* Header — mirrors channel recap structure */}
      <div className='text-center p-5 pb-4 flex-shrink-0'>
        <h2 className={`${isMobile ? 'text-lg' : 'text-2xl'} font-semibold text-foreground mb-1`}>
          {sessionGreeting}
        </h2>
        <p className='text-sm text-muted-foreground'>
          {recaps.length} project{recaps.length !== 1 ? 's' : ''} · {totalChannels} channel
          {totalChannels !== 1 ? 's' : ''} · {totalMessages} messages from yesterday
        </p>
      </div>

      {/* Scrollable cards */}
      <div className='flex-1 min-h-0 overflow-y-auto px-5 pb-6'>
        {recaps.map(renderProjectCard)}
        <p className='text-xs text-muted-foreground/60 text-center mt-2'>
          This tool uses AI to generate responses, so some information may be inaccurate.
        </p>
      </div>
    </div>
  );
};

export default ProjectRecapPanel;
