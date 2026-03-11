import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import MarkdownPreview from '@uiw/react-markdown-preview';
import {
  Loader2,
  CheckCircle,
  AlertCircle,
  Clock,
  Circle,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  FileEdit,
  Bot,
  Repeat,
} from 'lucide-react';
import { CombinedWorkflowData } from '../../../services/Workflow/workflowGraphService.types';
import { usePlatform } from '../../../hooks/usePlatform';
import { AgentAvatar } from './AgentAvatar';
import { ReviewerFeedback, parseReviewerFeedback } from './ReviewerFeedback';
import {
  GraphNodeInfo,
  AgentInfo,
  AgentMessage,
  SubMessage,
  SafeRecord,
  getAgentInfo,
  formatStepName,
  formatTime,
  extractEditSteps,
  extractAllSubMessages,
  getNodeCreatedAt,
  parseIteration,
  parseLLMResponse,
} from './AgentChatView.utils';
import { ResponseModal } from './ResponseModal';
import LiveEditsPanel from '../LiveEditsPanel';

const StatusIcon: React.FC<{ status: string; size?: number }> = ({ status, size = 12 }) => {
  const containerClass = 'flex items-center justify-center rounded-md p-1';
  switch (status) {
    case 'running':
      return (
        <div className={`${containerClass} bg-blue-500/10`}>
          <Loader2 size={size} className='text-blue-500 animate-spin' />
        </div>
      );
    case 'completed':
      return (
        <div className={`${containerClass} bg-emerald-500/10`}>
          <CheckCircle size={size} className='text-emerald-500' />
        </div>
      );
    case 'failed':
      return (
        <div className={`${containerClass} bg-red-500/10`}>
          <AlertCircle size={size} className='text-red-500' />
        </div>
      );
    case 'pending':
      return (
        <div className={`${containerClass} bg-muted`}>
          <Clock size={size} className='text-muted-foreground' />
        </div>
      );
    default:
      return <Circle size={size} className='text-gray-300' />;
  }
};

const MarkdownContent: React.FC<{ content: string; small?: boolean }> = ({
  content,
  small = false,
}) => (
  <div
    className={`overflow-hidden max-w-full [&_*]:max-w-full [&_pre]:overflow-x-auto [&_pre]:!bg-muted/70 [&_.wmde-markdown]:bg-transparent [&_.wmde-markdown_code]:!bg-muted/70 prose-xs ${small ? 'text-xs' : 'text-sm'} text-foreground`}
  >
    <MarkdownPreview
      source={content}
      style={{
        backgroundColor: 'transparent',
        color: 'inherit',
        maxWidth: '100%',
        fontSize: small ? '12px' : '13px',
        lineHeight: '1.5',
      }}
      // eslint-disable-next-line @typescript-eslint/naming-convention
      wrapperElement={{ 'data-color-mode': 'light' }}
    />
  </div>
);

interface TruncatableMarkdownContentProps {
  content: string;
  small?: boolean;
  maxLinesDesktop?: number;
  maxLinesMobile?: number;
  onExpandChange?: (isFullyVisible: boolean) => void;
  onViewMore?: () => void;
}

const TruncatableMarkdownContent: React.FC<TruncatableMarkdownContentProps> = ({
  content,
  small = false,
  maxLinesDesktop = 25,
  maxLinesMobile = 10,
  onExpandChange,
  onViewMore,
}) => {
  const { isMobile } = usePlatform();
  const [isExpanded, setIsExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const maxLines = isMobile ? maxLinesMobile : maxLinesDesktop;
  const [needsTruncation, setNeedsTruncation] = useState(false);

  useEffect(() => {
    if (contentRef.current) {
      const lineHeight = 20;
      const maxHeight = maxLines * lineHeight;
      const actualHeight = contentRef.current.scrollHeight;
      setNeedsTruncation(actualHeight > maxHeight + 50);
    }
  }, [content, maxLines]);

  useEffect(() => {
    const isFullyVisible = !needsTruncation || isExpanded;
    onExpandChange?.(isFullyVisible);
  }, [needsTruncation, isExpanded, onExpandChange]);

  const shouldTruncate = !isExpanded && needsTruncation;

  const handleViewMore = (): void => {
    if (isMobile && onViewMore) {
      onViewMore();
    } else {
      setIsExpanded(v => !v);
    }
  };

  return (
    <div className='relative'>
      <div
        ref={contentRef}
        className={`overflow-hidden max-w-full [&_*]:max-w-full [&_pre]:overflow-x-auto [&_pre]:!bg-muted/70 [&_.wmde-markdown]:bg-transparent [&_.wmde-markdown_code]:!bg-muted/70 prose-xs ${small ? 'text-xs' : 'text-sm'} text-foreground`}
        style={
          shouldTruncate
            ? {
                maxHeight: `${maxLines * 20}px`,
                maskImage: 'linear-gradient(to bottom, black 85%, transparent 100%)',
                WebkitMaskImage: 'linear-gradient(to bottom, black 85%, transparent 100%)',
              }
            : undefined
        }
      >
        <MarkdownPreview
          source={content}
          style={{
            backgroundColor: 'transparent',
            color: 'inherit',
            maxWidth: '100%',
            fontSize: small ? '12px' : '13px',
            lineHeight: '1.5',
          }}
          // eslint-disable-next-line @typescript-eslint/naming-convention
          wrapperElement={{ 'data-color-mode': 'light' }}
        />
      </div>
      {needsTruncation && (
        <button
          onClick={handleViewMore}
          className='flex items-center gap-1 mt-2 text-[11px] font-medium text-sky-600 hover:text-sky-700 transition-colors'
          data-track-category='Workflows'
          data-track-name='ViewMoreResponse'
        >
          {isMobile ? (
            <>
              <ChevronDown size={12} />
              View more
            </>
          ) : isExpanded ? (
            <>
              <ChevronUp size={12} />
              Read less
            </>
          ) : (
            <>
              <ChevronDown size={12} />
              View more
            </>
          )}
        </button>
      )}
    </div>
  );
};

const SubMessageRow: React.FC<{
  subMsg: SubMessage;
  index: number;
  agentInfo: AgentInfo;
}> = ({ subMsg, index, agentInfo }) => (
  <div className='flex items-start gap-2 py-2 border-t border-border first:border-t-0'>
    <div className='flex-shrink-0 flex flex-col items-center gap-0.5 mt-0.5'>
      <div
        className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${agentInfo.avatarBg} ${agentInfo.avatarText} opacity-70`}
      >
        {index + 1}
      </div>
    </div>

    <div className='flex-1 min-w-0'>
      <div className='flex items-center gap-1.5 mb-1'>
        <span className={`text-[10px] font-semibold ${agentInfo.labelColor}`}>
          {agentInfo.name}
        </span>
        <span className='text-[10px] text-muted-foreground font-mono bg-muted px-1 rounded'>
          {formatStepName(subMsg.stepName)}
        </span>
        {subMsg.createdAt && (
          <span className='text-[9px] text-muted-foreground ml-auto'>
            {formatTime(subMsg.createdAt)}
          </span>
        )}
      </div>
      {((): React.ReactNode => {
        const parsed = parseReviewerFeedback(subMsg.content);
        return parsed ? (
          <ReviewerFeedback issues={parsed} />
        ) : (
          <MarkdownContent content={subMsg.content} small />
        );
      })()}
    </div>
  </div>
);

const EmptyState: React.FC = () => (
  <div className='flex flex-col items-center justify-center h-full py-16 text-center'>
    <div className='w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3'>
      <MessageSquare size={24} className='text-muted-foreground opacity-50' />
    </div>
    <p className='text-foreground/70 text-sm font-medium'>No agent conversation yet</p>
    <p className='text-muted-foreground text-xs mt-1'>
      Messages will appear here as the workflow runs
    </p>
  </div>
);

export interface AgentChatViewProps {
  combinedStepsData: CombinedWorkflowData | null;
  graphNodes: GraphNodeInfo[];
  onClose?: () => void;
  hideTabs?: boolean;
}

const LoopRunningLoader: React.FC = () => (
  <div className='flex items-center gap-1.5 ml-11 py-2'>
    <div className='flex gap-0.5'>
      <div className='w-1 h-1 rounded-full bg-slate-400 animate-[bounce_1s_infinite_0ms]' />
      <div className='w-1 h-1 rounded-full bg-slate-300 animate-[bounce_1s_infinite_150ms]' />
      <div className='w-1 h-1 rounded-full bg-slate-400 animate-[bounce_1s_infinite_300ms]' />
    </div>
    <span className='text-[10px] font-medium text-slate-500 uppercase tracking-wider'>
      Cycling...
    </span>
  </div>
);

export const AgentChatView: React.FC<AgentChatViewProps> = ({
  combinedStepsData,
  graphNodes,
  hideTabs,
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(0);

  const [activeTab, setActiveTab] = useState<'chat' | 'diff'>('chat');

  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    content: string;
    agentInfo: AgentInfo | null;
    stepName: string;
    timestamp: string | undefined;
  }>({ isOpen: false, content: '', agentInfo: null, stepName: '', timestamp: undefined });

  const openModal = useCallback(
    (content: string, agentInfo: AgentInfo, stepName: string, timestamp: string | undefined) => {
      setModalState({ isOpen: true, content, agentInfo, stepName, timestamp });
    },
    [],
  );

  const closeModal = useCallback(() => {
    setModalState(prev => ({ ...prev, isOpen: false }));
  }, []);

  const agentMessages = useMemo((): AgentMessage[] => {
    if (!combinedStepsData || graphNodes.length === 0) return [];

    return graphNodes.map((node): AgentMessage => {
      const agentInfo = getAgentInfo(node.stepName);
      const subMessages = extractAllSubMessages(node.stepIds, combinedStepsData);
      const editSteps = extractEditSteps(node.stepIds, combinedStepsData);

      const summary =
        subMessages.length > 0
          ? subMessages[subMessages.length - 1]!.content
          : ((): string => {
              const stepIdSet = new Set(node.stepIds);
              for (const workflow of combinedStepsData.workflows) {
                for (const step of workflow.steps) {
                  if (!stepIdSet.has(step.id)) continue;
                  try {
                    const record: SafeRecord =
                      typeof step.data === 'string'
                        ? (JSON.parse(step.data) as SafeRecord)
                        : (step.data as SafeRecord);

                    const content = parseLLMResponse(record);

                    if (step.stepExecutorType === 'deterministic') {
                      const success = record['success'];
                      const error = record['error'];
                      const output = record['output'];

                      const displayContent =
                        typeof error === 'string' && error
                          ? error
                          : typeof output === 'string' && output
                            ? output
                            : content;

                      if (displayContent) {
                        const isError = success === false || !!error;
                        const prefix = isError ? '**Failed**\\n' : '**Success**\\n';
                        return `${prefix}\`\`\`bash\\n${displayContent.trim()}\\n\`\`\``;
                      }
                    } else if (content) {
                      return content;
                    }
                  } catch {
                    // Ignore parse errors
                  }
                }
              }
              return '';
            })();
      const createdAt = getNodeCreatedAt(node.stepIds, combinedStepsData);
      const iteration = parseIteration(node.stepName);

      return {
        nodeIndex: node.index,
        stepName: node.stepName,
        status: node.status,
        agentInfo,
        summary,
        subMessages,
        editSteps,
        createdAt: createdAt ?? undefined,
        ...(iteration ? { iteration } : {}),
      };
    });
  }, [combinedStepsData, graphNodes]);

  const visibleMessages = agentMessages.filter(
    m =>
      m.summary ||
      m.subMessages.length > 0 ||
      m.editSteps.length > 0 ||
      m.status === 'running' ||
      m.status === 'failed',
  );

  const groupedContent = useMemo(() => {
    const result: (AgentMessage | { type: 'loop'; baseName: string; messages: AgentMessage[] })[] =
      [];
    let currentLoop: { type: 'loop'; baseName: string; messages: AgentMessage[] } | null = null;

    visibleMessages.forEach(msg => {
      if (msg.iteration) {
        if (currentLoop && currentLoop.baseName === msg.iteration.baseName) {
          currentLoop.messages.push(msg);
        } else {
          currentLoop = { type: 'loop', baseName: msg.iteration.baseName, messages: [msg] };
          result.push(currentLoop);
        }
      } else {
        currentLoop = null;
        result.push(msg);
      }
    });

    return result;
  }, [visibleMessages]);

  useEffect(() => {
    const currentCount = agentMessages.filter(m => m.summary || m.status === 'running').length;
    if (currentCount > prevMessageCountRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevMessageCountRef.current = currentCount;
  }, [agentMessages]);

  const allEditSteps = useMemo(() => {
    return visibleMessages.flatMap(m => m.editSteps);
  }, [visibleMessages]);

  return (
    <div className='flex flex-col h-full bg-background overflow-hidden relative'>
      {!hideTabs && (
        <div className='flex-shrink-0 px-3 py-2 border-b border-border bg-background shadow-sm z-20'>
          <div className='flex items-center justify-center md:justify-between gap-3'>
            <div className='hidden md:flex items-center gap-2 px-1'>
              <div className='w-8 h-8 rounded-lg bg-muted border border-border flex items-center justify-center'>
                <Bot size={16} className='text-foreground/70' />
              </div>
              <div className='flex flex-col'>
                <span className='text-xs font-bold text-foreground tracking-tight leading-none mb-0.5'>
                  Agent Chat
                </span>
                <div className='flex items-center gap-1.5'>
                  <div className='w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse' />
                  <span className='text-[10px] text-muted-foreground font-medium uppercase tracking-wider'>
                    Live Channel
                  </span>
                </div>
              </div>
            </div>

            <div className='flex bg-muted/80 backdrop-blur-md p-1 rounded-xl border border-border w-full md:w-auto md:min-w-[260px] shadow-inner'>
              <button
                onClick={() => setActiveTab('chat')}
                className={`flex-1 py-1.5 px-4 text-[11px] font-bold rounded-lg transition-all duration-200 flex items-center justify-center gap-2.5 ${
                  activeTab === 'chat'
                    ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
                }`}
                data-track-category='Workflows'
                data-track-name='SwitchToAgentChatTab'
              >
                <div
                  className={`p-1 rounded-md transition-colors duration-200 ${activeTab === 'chat' ? 'bg-muted text-foreground' : 'bg-transparent text-muted-foreground'}`}
                >
                  <Bot size={13} strokeWidth={2.5} />
                </div>
                Chat View
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold font-mono transition-colors duration-200 ${activeTab === 'chat' ? 'bg-muted/60 text-foreground' : 'bg-muted/40 text-muted-foreground'}`}
                >
                  {visibleMessages.length}
                </span>
              </button>
              <button
                onClick={() => setActiveTab('diff')}
                className={`flex-1 py-1.5 px-4 text-[11px] font-bold rounded-lg transition-all duration-200 flex items-center justify-center gap-2.5 ${
                  activeTab === 'diff'
                    ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
                }`}
                data-track-category='Workflows'
                data-track-name='SwitchToAgentDiffTab'
              >
                <div
                  className={`p-1 rounded-md transition-colors duration-200 ${activeTab === 'diff' ? 'bg-muted text-foreground' : 'bg-transparent text-muted-foreground'}`}
                >
                  <FileEdit size={13} strokeWidth={2.5} />
                </div>
                Diff View
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold font-mono transition-colors duration-200 ${activeTab === 'diff' ? 'bg-muted/60 text-foreground' : 'bg-muted/40 text-muted-foreground'}`}
                >
                  {allEditSteps.length}
                </span>
              </button>
            </div>

            <div className='w-[100px] hidden md:flex justify-end'></div>
          </div>
        </div>
      )}

      <div className='flex-1 overflow-y-auto px-3 md:px-4 py-4 space-y-4 no-scrollbar'>
        {!hideTabs && activeTab === 'diff' ? (
          <div className='h-full -mx-3 md:-mx-4 -my-4'>
            <LiveEditsPanel combinedStepsData={combinedStepsData} />
          </div>
        ) : visibleMessages.length === 0 ? (
          <EmptyState />
        ) : (
          <div className='flex flex-col gap-4'>
            {groupedContent.map((item, i) => {
              if ('type' in item && item.type === 'loop') {
                return (
                  <div key={`loop-${item.baseName}-${i}`} className='relative'>
                    {/* Loop Header */}
                    <div className='flex items-center gap-2 mb-3 ml-2'>
                      <div className='flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100/80 border border-slate-200/60'>
                        <Repeat size={11} className='text-slate-500' strokeWidth={2.5} />
                        <span className='text-[10px] font-semibold uppercase tracking-wide text-slate-600'>
                          {formatStepName(item.baseName)}
                        </span>
                        <span className='text-[9px] font-mono text-slate-400 bg-slate-200/50 px-1 rounded'>
                          ×{item.messages.length}
                        </span>
                      </div>
                      <div className='h-px flex-1 bg-gradient-to-r from-slate-200/60 via-slate-100/40 to-transparent' />
                    </div>

                    {/* Vertical Timeline */}
                    <div className='absolute left-[15px] top-12 bottom-6 w-[2px] bg-slate-200 z-0' />

                    {/* Loop Messages */}
                    <div className='space-y-3 relative z-10'>
                      {item.messages.map((msg, _) => (
                        <div
                          key={`${msg.stepName}-${msg.nodeIndex}`}
                          className='relative group flex flex-col'
                        >
                          <AgentMessageBubble
                            message={msg}
                            isLatest={msg === visibleMessages[visibleMessages.length - 1]}
                            onViewMore={openModal}
                          />
                        </div>
                      ))}
                    </div>

                    {/* Loop Running Loader */}
                    {item.messages[item.messages.length - 1]?.status === 'running' && (
                      <div className='relative z-10'>
                        <LoopRunningLoader />
                      </div>
                    )}
                  </div>
                );
              }
              const msg = item as AgentMessage;
              return (
                <AgentMessageBubble
                  key={`${msg.stepName}-${msg.nodeIndex}`}
                  message={msg}
                  isLatest={msg === visibleMessages[visibleMessages.length - 1]}
                  onViewMore={openModal}
                />
              );
            })}
          </div>
        )}
        <div ref={bottomRef} className='h-12 flex-shrink-0' />
      </div>

      <div className='absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-background via-background/80 to-transparent pointer-events-none z-10' />

      {modalState.agentInfo && (
        <ResponseModal
          isOpen={modalState.isOpen}
          onClose={closeModal}
          content={modalState.content}
          agentInfo={modalState.agentInfo}
          stepName={modalState.stepName}
          timestamp={modalState.timestamp}
        />
      )}
    </div>
  );
};

const AgentMessageBubble: React.FC<{
  message: AgentMessage;
  isLatest: boolean;
  onViewMore?: (
    content: string,
    agentInfo: AgentInfo,
    stepName: string,
    timestamp?: string,
  ) => void;
}> = ({ message, isLatest, onViewMore }) => {
  const [isTurnsExpanded, setIsTurnsExpanded] = useState(false);
  const [isSummaryFullyVisible, setIsSummaryFullyVisible] = useState(true);
  const { agentInfo, stepName, status, summary, createdAt, subMessages, editSteps } = message;
  const isRunning = status === 'running';

  const hasMultipleTurns = subMessages.length > 1;
  const canShowTurns = hasMultipleTurns && isSummaryFullyVisible;
  const hasEdits = editSteps.length > 0;

  const handleViewMore = (): void => {
    if (onViewMore) {
      onViewMore(summary, agentInfo, formatStepName(stepName), createdAt);
    }
  };

  return (
    <div
      className={`flex items-start gap-2 md:gap-3 py-1 ${isRunning ? 'animate-pulse-subtle' : ''}`}
    >
      <div className='flex-shrink-0 group relative'>
        <AgentAvatar agentInfo={agentInfo} />
      </div>

      <div className='flex-1 min-w-0 w-full'>
        <div className='flex items-center gap-1.5 md:gap-2 mb-1.5 flex-wrap'>
          <span className={`text-xs font-semibold ${agentInfo.labelColor}`}>{agentInfo.name}</span>

          {hasMultipleTurns && (
            <span className='flex items-center gap-1 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded'>
              <MessageSquare size={9} />
              {subMessages.length} turns
            </span>
          )}

          {hasEdits && (
            <span className='flex items-center gap-1 text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded'>
              <FileEdit size={9} />
              {editSteps.length} edit{editSteps.length !== 1 ? 's' : ''}
            </span>
          )}

          <span className='flex items-center gap-1 text-[10px] text-muted-foreground ml-auto'>
            <StatusIcon status={status} size={10} />
            <span className='capitalize hidden sm:inline'>{status}</span>
          </span>
          {/* Validation/Status metadata row ending */}
        </div>

        {(summary || isRunning || canShowTurns) && (
          <div
            className={`rounded-xl md:rounded-2xl rounded-tl-sm px-3 md:px-4 py-2 md:py-2.5 ${agentInfo.bubbleBg} transition-shadow ${isLatest && isRunning ? 'shadow-sm ring-1 ring-sky-100' : ''}`}
          >
            {summary ? (
              parseReviewerFeedback(summary) ? (
                <ReviewerFeedback issues={parseReviewerFeedback(summary)!} />
              ) : (
                <TruncatableMarkdownContent
                  content={summary}
                  onExpandChange={setIsSummaryFullyVisible}
                  onViewMore={handleViewMore}
                />
              )
            ) : isRunning ? (
              <div className='flex items-center gap-2 text-sm text-muted-foreground py-0.5'>
                <Loader2 size={14} className='animate-spin text-sky-400' />
                <span>Running…</span>
              </div>
            ) : (
              <span className='text-sm text-muted-foreground italic'>No output available</span>
            )}

            {canShowTurns && (
              <div className='mt-3 pt-2 border-t border-black/5'>
                <button
                  onClick={() => setIsTurnsExpanded(v => !v)}
                  className={`flex items-center gap-1.5 text-[11px] font-medium transition-colors ${agentInfo.labelColor} hover:opacity-80`}
                  data-track-category='Workflows'
                  data-track-name='ToggleTurnsExpansion'
                >
                  {isTurnsExpanded ? (
                    <>
                      <ChevronUp size={12} />
                      Hide {subMessages.length} turns
                    </>
                  ) : (
                    <>
                      <ChevronDown size={12} />
                      Show all {subMessages.length} turns
                    </>
                  )}
                </button>

                {isTurnsExpanded && (
                  <div className='mt-3 space-y-0 divide-y divide-border rounded-xl border border-border bg-muted/60 p-3'>
                    {subMessages.map((sub: SubMessage, idx: number) => (
                      <SubMessageRow key={sub.id} subMsg={sub} index={idx} agentInfo={agentInfo} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {createdAt && (
          <span className='text-[10px] text-muted-foreground mt-1 block'>
            {formatTime(createdAt)}
          </span>
        )}
      </div>
    </div>
  );
};

export default AgentChatView;
