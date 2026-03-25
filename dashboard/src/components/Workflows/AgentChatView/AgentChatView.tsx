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
  Zap,
  Layers,
  User,
} from 'lucide-react';
import { toast } from 'sonner';
import { useWorkflowControl } from '../../../services/Workflow/workflowGraphService';
import { StepRerunButton } from './StepRerunButton';
import ExecutionAttemptDropdown from '../ExecutionAttemptDropdown';
import {
  CombinedWorkflowData,
  ExecutionMetadata,
  WorkflowStep,
} from '../../../services/Workflow/workflowGraphService.types';
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
  parseIteration,
  parseLLMResponse,
  extractUserMessages,
  extractAllSubMessages,
  getNodeCreatedAt,
} from './AgentChatView.utils';
import { USER_REPLY_PREFIX } from '../constants';
import { ResponseModal } from './ResponseModal';
import LiveEditsPanel from '../LiveEditsPanel';
import { useUser } from '../../../hooks/useUsers';
import Avatar from '../../ui/Avatar/Avatar';
import { Dialog } from '../../ui/Dialog/Dialog';
import Tooltip from '../../ui/Tooltip/Tooltip';

const StatusIcon: React.FC<{ status: string; size?: number }> = ({ status, size = 12 }) => {
  const containerClass = 'flex items-center justify-center rounded-md p-0.5';
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
  onClose?: () => void | undefined;
  hideTabs?: boolean | undefined;
  isLoading?: boolean;
  ticketDescription?: string | undefined;
  createdBy?: string | null | undefined;
  executionId?: string | undefined;
  onExecutionChange?: ((executionId: string) => void) | undefined;
  onNavigateToStep?: (nodeIndex: number) => void;
}

const WorkflowRequestCard: React.FC<{
  description: string;
  createdBy: string;
  executionMetadata?: ExecutionMetadata[] | undefined;
  selectedExecutionId?: string | undefined;
  onExecutionSelect?: ((executionId: string) => void) | undefined;
}> = ({ description, createdBy, executionMetadata, selectedExecutionId, onExecutionSelect }) => {
  const user = useUser(createdBy);
  const displayName = user?.name || user?.email || createdBy;

  return (
    <div className='flex items-start gap-2 md:gap-3 py-1 mb-2'>
      <div className='flex-shrink-0'>
        <Avatar userId={createdBy} size='rg' showActiveStatus={false} className='rounded-full' />
      </div>
      <div className='flex-1 min-w-0'>
        <div className='flex items-center gap-1.5 mb-1.5 flex-wrap'>
          <span className='text-xs font-semibold text-slate-700'>{displayName}</span>
          {executionMetadata && selectedExecutionId && onExecutionSelect && (
            <ExecutionAttemptDropdown
              executionMetadata={executionMetadata}
              selectedExecutionId={selectedExecutionId}
              onExecutionSelect={onExecutionSelect}
            />
          )}
        </div>
        <div className='rounded-xl rounded-tl-sm px-3 md:px-4 py-2 md:py-2.5 bg-slate-50 border border-slate-200/60'>
          <TruncatableMarkdownContent
            content={description}
            maxLinesDesktop={6}
            maxLinesMobile={4}
          />
        </div>
      </div>
    </div>
  );
};

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
  isLoading,
  ticketDescription,
  createdBy: createdByProp,
  executionId,
  onExecutionChange,
  onNavigateToStep,
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(0);
  const { continueAgenticStepAsync } = useWorkflowControl();
  const [isSettingMode, setIsSettingMode] = useState(false);

  const [activeTab, setActiveTab] = useState<'chat' | 'diff'>('chat');

  const requestDescription = useMemo(() => {
    const fromMeta = combinedStepsData?.workflows?.[0]?.metadata?.originalRequest?.['description'];
    return (typeof fromMeta === 'string' ? fromMeta : undefined) ?? ticketDescription;
  }, [combinedStepsData, ticketDescription]);

  const requestCreatedBy = useMemo(() => {
    return combinedStepsData?.workflows?.[0]?.createdBy ?? createdByProp ?? null;
  }, [combinedStepsData, createdByProp]);

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

    return graphNodes
      .map((node): AgentMessage => {
        const agentInfo = getAgentInfo(node.stepName);
        const subMessages = extractAllSubMessages(node.stepIds, combinedStepsData);
        const editSteps = extractEditSteps(node.stepIds, combinedStepsData);

        // Extract user messages injected during reruns for "reply context"
        const userMessageSteps = extractUserMessages(node.stepIds, combinedStepsData);
        let replyContext: string | undefined = undefined;
        if (userMessageSteps.length > 0) {
          const uStep = userMessageSteps[userMessageSteps.length - 1]!;
          try {
            const record: SafeRecord =
              typeof uStep.data === 'string'
                ? (JSON.parse(uStep.data) as SafeRecord)
                : (uStep.data as SafeRecord);
            const content = record['content'];
            if (typeof content === 'string' && content.startsWith(USER_REPLY_PREFIX)) {
              replyContext = content.slice(USER_REPLY_PREFIX.length);
            }
          } catch {
            // Ignore
          }
        }

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

                      // Optional fallback in case user_message is a top level step
                      if (step.stepName === 'user_message') {
                        return (record['content'] as string) || '';
                      }

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
          ...(replyContext !== undefined ? { replyContext } : {}),
        };
      })
      .filter((msg): msg is AgentMessage => msg !== null);
  }, [combinedStepsData, graphNodes]);

  const visibleMessages = agentMessages;

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

  const currentExecutionMetadata = combinedStepsData?.workflows?.[0]?.executionMetadata?.find(
    meta => meta.executionId === executionId,
  );
  const executionMode = currentExecutionMetadata?.mode;
  const executionStatus = currentExecutionMetadata?.executionStatus;

  const handleGoToAutomatic = async (): Promise<void> => {
    if (!executionId) return;

    let lastAgentInputStep: WorkflowStep | null = null;
    if (combinedStepsData?.workflows?.length) {
      for (const workflow of combinedStepsData.workflows) {
        for (const step of workflow.steps) {
          if (step.stepExecutorType?.toLowerCase() === 'agent' && step.type === 'input') {
            lastAgentInputStep = step;
          }
        }
      }
    }

    if (!lastAgentInputStep) {
      toast.error('Cannot switch mode', {
        description: 'No agent checkpoint found',
        duration: 3000,
      });
      return;
    }

    setIsSettingMode(true);
    try {
      await continueAgenticStepAsync({
        executionId: lastAgentInputStep.workflowExecutionId || executionId,
        stepId: lastAgentInputStep.id,
        message: '',
      });
      toast.success('Mode switched', {
        description: 'Execution will proceed automatically',
        duration: 3000,
      });
    } catch (error: unknown) {
      toast.error('Failed to switch mode', {
        description: error instanceof Error ? error.message : 'Unknown error',
        duration: 4000,
      });
    } finally {
      setIsSettingMode(false);
    }
  };

  const showGoToAutomaticButton =
    executionMode === 'MANUAL' && executionStatus === 'WAIT_FOR_EVENT';

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

      <div className='flex-1 overflow-y-auto px-3 md:px-4 py-4 space-y-4 no-scrollbar pb-16'>
        {isLoading ? (
          <div className='flex flex-col items-center justify-center py-12 text-center'>
            <Loader2 size={24} className='text-blue-500 animate-spin mb-2' />
            <p className='text-muted-foreground text-xs font-medium'>Loading attempt data...</p>
          </div>
        ) : !hideTabs && activeTab === 'diff' ? (
          <div className='h-full -mx-3 md:-mx-4 -my-4'>
            <LiveEditsPanel combinedStepsData={combinedStepsData} />
          </div>
        ) : (
          <div className='flex flex-col gap-4'>
            {requestCreatedBy && requestDescription && (
              <WorkflowRequestCard
                description={requestDescription}
                createdBy={requestCreatedBy}
                executionMetadata={combinedStepsData?.workflows?.[0]?.executionMetadata}
                selectedExecutionId={executionId}
                onExecutionSelect={onExecutionChange}
              />
            )}
            {visibleMessages.length === 0 ? (
              <EmptyState />
            ) : (
              <>
                {groupedContent.map((item, i) => {
                  if ('type' in item && item.type === 'loop') {
                    return (
                      <div key={`loop-${item.baseName}-${i}`} className='relative'>
                        {/* Loop Header */}
                        <div className='flex items-center gap-2 mb-3'>
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
                                {...(executionId && combinedStepsData && graphNodes
                                  ? {
                                      executionId,
                                      combinedStepsData,
                                      graphNodes,
                                      onExecutionChange,
                                      executionMode,
                                      executionStatus,
                                      onNavigateToStep,
                                    }
                                  : {})}
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
                      {...(executionId && combinedStepsData && graphNodes
                        ? {
                            executionId,
                            combinedStepsData,
                            graphNodes,
                            onExecutionChange,
                            executionMode,
                            executionStatus,
                            onNavigateToStep,
                          }
                        : {})}
                    />
                  );
                })}

                {showGoToAutomaticButton && (
                  <div className='flex justify-center mt-2 mb-4'>
                    <button
                      onClick={() => void handleGoToAutomatic()}
                      disabled={isSettingMode}
                      className='flex items-center gap-2 px-4 py-2 text-sm font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition-all shadow-sm hover:shadow disabled:opacity-50'
                      data-track-category='Workflows'
                      data-track-name='GoToAutomaticFromChat'
                      data-track-metadata={JSON.stringify({ executionId })}
                    >
                      {isSettingMode ? (
                        <Loader2 size={16} className='animate-spin' />
                      ) : (
                        <Zap size={16} fill='currentColor' />
                      )}
                      Continue
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
        <div ref={bottomRef} className='h-6 flex-shrink-0' />
      </div>

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
  ) => void | undefined;
  executionId?: string | undefined;
  combinedStepsData?: CombinedWorkflowData | null | undefined;
  graphNodes?: GraphNodeInfo[] | undefined;
  onExecutionChange?: ((executionId: string) => void) | undefined;
  executionMode?: string | undefined;
  executionStatus?: string | undefined;
  onNavigateToStep?: (nodeIndex: number) => void;
}> = ({
  message,
  isLatest,
  onViewMore,
  executionId,
  combinedStepsData,
  graphNodes,
  onExecutionChange,
  executionMode,
  executionStatus,
  onNavigateToStep,
}) => {
  const [isTurnsExpanded, setIsTurnsExpanded] = useState(false);
  const [isSummaryFullyVisible, setIsSummaryFullyVisible] = useState(true);
  const [isReplyModalOpen, setIsReplyModalOpen] = useState(false);
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

  const replyThreshold = 80;
  const isReplyLong = message.replyContext && message.replyContext.length > replyThreshold;
  const displayReply = isReplyLong
    ? message.replyContext!.slice(0, replyThreshold) + '...'
    : message.replyContext;

  return (
    <div className='flex flex-col w-full relative group/message'>
      {message.replyContext && (
        <>
          <div className='flex items-end gap-2 md:gap-3 mb-0.5'>
            <div className='flex-shrink-0 w-[31px] flex justify-end h-5'>
              <div className='w-4 h-full border-l-2 border-t-2 border-slate-300 rounded-tl-[6px]' />
            </div>

            {/* Reply content — column-aligned with the message content below */}
            <div className='flex items-center gap-1.5 flex-1 min-w-0 text-[11px] text-muted-foreground/80 pb-2 overflow-hidden'>
              <div className='w-4 h-4 rounded-full bg-slate-600 flex items-center justify-center text-white flex-shrink-0 shadow-sm'>
                <User size={9} strokeWidth={2.5} />
              </div>
              <span className='font-semibold flex-shrink-0 text-foreground/60'>User</span>
              <div className='flex items-center gap-1 min-w-0 flex-1 overflow-hidden'>
                <span className='text-muted-foreground/90 truncate'>{displayReply}</span>
                {isReplyLong && (
                  <button
                    onClick={() => setIsReplyModalOpen(true)}
                    className='text-[10px] font-bold text-sky-600 hover:text-sky-700 flex-shrink-0 transition-colors px-1.5 py-0.5 rounded hover:bg-sky-50 cursor-pointer pointer-events-auto bg-transparent border-none'
                    data-track-category='Workflows'
                    data-track-name='ExpandReply'
                  >
                    show more
                  </button>
                )}
              </div>
            </div>
          </div>

          {isReplyLong && (
            <Dialog
              open={isReplyModalOpen}
              onOpenChange={setIsReplyModalOpen}
              title='User message'
              description='Full user message that triggered this agent response'
            >
              <div className='p-4 space-y-2 max-h-[70vh] overflow-y-auto'>
                <p className='text-xs font-semibold text-foreground/60 uppercase tracking-wide'>
                  User message
                </p>
                <p className='text-sm text-foreground whitespace-pre-wrap break-words'>
                  {message.replyContext}
                </p>
              </div>
            </Dialog>
          )}
        </>
      )}
      <div
        className={`flex items-start gap-2 md:gap-3 py-1 ${isRunning ? 'animate-pulse-subtle' : ''}`}
      >
        <div className='flex-shrink-0 group relative'>
          <AgentAvatar agentInfo={agentInfo} />
        </div>

        <div className='flex-1 min-w-0 w-full'>
          <div className='flex items-center gap-1.5 md:gap-2 mb-1.5 flex-wrap'>
            <span className={`text-xs font-semibold ${agentInfo.labelColor}`}>
              {agentInfo.name}
            </span>

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

            <div className='flex items-center gap-1 text-[10px] text-muted-foreground ml-auto'>
              <Tooltip content={status.charAt(0).toUpperCase() + status.slice(1)}>
                <div className='flex'>
                  <StatusIcon
                    status={
                      isRunning &&
                      executionMode === 'MANUAL' &&
                      executionStatus === 'WAIT_FOR_EVENT' &&
                      isLatest
                        ? 'pending'
                        : status
                    }
                    size={13}
                  />
                </div>
              </Tooltip>
              {onNavigateToStep && (
                <Tooltip content='Jump to chat view'>
                  <button
                    onClick={() => onNavigateToStep(message.nodeIndex)}
                    className='p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors'
                    data-track-category='Workflows'
                    data-track-name='NavigateToAdvancedStep'
                    data-track-metadata={JSON.stringify({ nodeIndex: message.nodeIndex })}
                  >
                    <Layers size={14} className='text-muted-foreground' />
                  </button>
                </Tooltip>
              )}
              {/* Rerun button */}
              {executionId &&
                combinedStepsData &&
                graphNodes &&
                message.nodeIndex < graphNodes.length && (
                  <StepRerunButton
                    executionId={executionId}
                    stepIds={graphNodes[message.nodeIndex]?.stepIds || []}
                    combinedStepsData={combinedStepsData}
                    {...(onExecutionChange ? { onRerun: onExecutionChange } : {})}
                    size={13}
                  />
                )}
            </div>
            {/* Validation/Status metadata row ending */}
          </div>

          {(summary || isRunning || canShowTurns) && (
            <div
              className={`rounded-xl md:rounded-2xl rounded-tl-sm px-3 md:px-4 py-2 md:py-2.5 ${agentInfo.bubbleBg} transition-shadow ${isLatest && isRunning ? 'shadow-sm ring-1 ring-sky-100' : ''}`}
            >
              {summary ? (
                parseReviewerFeedback(summary) ? (
                  <ReviewerFeedback
                    issues={parseReviewerFeedback(summary)!}
                    onViewMore={handleViewMore}
                  />
                ) : (
                  <TruncatableMarkdownContent
                    content={summary}
                    onExpandChange={setIsSummaryFullyVisible}
                    onViewMore={handleViewMore}
                  />
                )
              ) : isRunning ? (
                <div className='flex items-center gap-2 text-sm text-muted-foreground py-0.5'>
                  {executionMode === 'MANUAL' &&
                  executionStatus === 'WAIT_FOR_EVENT' &&
                  isLatest ? (
                    <>
                      <Clock size={14} className='text-amber-500' />
                      <span>Waiting for input…</span>
                    </>
                  ) : (
                    <>
                      <Loader2 size={14} className='animate-spin text-sky-400' />
                      <span>Running…</span>
                    </>
                  )}
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
                        <SubMessageRow
                          key={sub.id}
                          subMsg={sub}
                          index={idx}
                          agentInfo={agentInfo}
                        />
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
    </div>
  );
};

export default AgentChatView;
