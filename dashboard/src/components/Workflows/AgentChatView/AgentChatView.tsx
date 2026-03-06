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
} from 'lucide-react';
import { CombinedWorkflowData } from '../../../services/Workflow/workflowGraphService.types';
import { usePlatform } from '../../../hooks/usePlatform';
import { AgentAvatar } from './AgentAvatar';
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
} from './AgentChatView.utils';
import { ResponseModal } from './ResponseModal';
import LiveEditsPanel from '../LiveEditsPanel';

const StatusIcon: React.FC<{ status: string; size?: number }> = ({ status, size = 12 }) => {
  switch (status) {
    case 'running':
      return <Loader2 size={size} className='text-sky-500 animate-spin' />;
    case 'completed':
      return <CheckCircle size={size} className='text-emerald-500' />;
    case 'failed':
      return <AlertCircle size={size} className='text-rose-500 stroke-[2.5]' />;
    case 'pending':
      return <Clock size={size} className='text-gray-400 stroke-[2.5]' />;
    default:
      return <Circle size={size} className='text-gray-300 stroke-[2.5]' />;
  }
};

const MarkdownContent: React.FC<{ content: string; small?: boolean }> = ({
  content,
  small = false,
}) => (
  <div
    className={`overflow-hidden max-w-full [&_*]:max-w-full [&_pre]:overflow-x-auto [&_pre]:!bg-white/70 [&_.wmde-markdown]:bg-transparent [&_.wmde-markdown_code]:!bg-white/70 prose-xs ${small ? 'text-xs' : 'text-sm'} text-gray-800`}
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
        className={`overflow-hidden max-w-full [&_*]:max-w-full [&_pre]:overflow-x-auto [&_pre]:!bg-white/70 [&_.wmde-markdown]:bg-transparent [&_.wmde-markdown_code]:!bg-white/70 prose-xs ${small ? 'text-xs' : 'text-sm'} text-gray-800`}
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
  <div className='flex items-start gap-2 py-2 border-t border-gray-100 first:border-t-0'>
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
        <span className='text-[10px] text-gray-400 font-mono bg-gray-100 px-1 rounded'>
          {formatStepName(subMsg.stepName)}
        </span>
        {subMsg.createdAt && (
          <span className='text-[9px] text-gray-400 ml-auto'>{formatTime(subMsg.createdAt)}</span>
        )}
      </div>
      <MarkdownContent content={subMsg.content} small />
    </div>
  </div>
);

const EmptyState: React.FC = () => (
  <div className='flex flex-col items-center justify-center h-full py-16 text-center'>
    <div className='w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3'>
      <MessageSquare size={24} className='text-gray-300' />
    </div>
    <p className='text-gray-500 text-sm font-medium'>No agent conversation yet</p>
    <p className='text-gray-400 text-xs mt-1'>Messages will appear here as the workflow runs</p>
  </div>
);

export interface AgentChatViewProps {
  combinedStepsData: CombinedWorkflowData | null;
  graphNodes: GraphNodeInfo[];
  onClose?: () => void;
}

export const AgentChatView: React.FC<AgentChatViewProps> = ({ combinedStepsData, graphNodes }) => {
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
                  const record: SafeRecord =
                    typeof step.data === 'string'
                      ? (JSON.parse(step.data) as SafeRecord)
                      : (step.data as SafeRecord);
                  const turn = record['turn'] as SafeRecord | undefined;
                  const turnResult = turn?.['result'] as SafeRecord | undefined;
                  const turnContent = turnResult?.['content'];
                  if (typeof turnContent === 'string' && turnContent.trim())
                    return turnContent.trim();
                  const response = record['response'];
                  if (typeof response === 'string' && response.trim()) return response.trim();
                }
              }
              return '';
            })();
      const createdAt = getNodeCreatedAt(node.stepIds, combinedStepsData);

      return {
        nodeIndex: node.index,
        stepName: node.stepName,
        status: node.status,
        agentInfo,
        summary,
        subMessages,
        editSteps,
        createdAt: createdAt ?? undefined,
      };
    });
  }, [combinedStepsData, graphNodes]);

  useEffect(() => {
    const currentCount = agentMessages.filter(m => m.summary || m.status === 'running').length;
    if (currentCount > prevMessageCountRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevMessageCountRef.current = currentCount;
  }, [agentMessages]);

  const visibleMessages = agentMessages.filter(
    m =>
      m.summary ||
      m.subMessages.length > 0 ||
      m.editSteps.length > 0 ||
      m.status === 'running' ||
      m.status === 'failed',
  );

  const allEditSteps = useMemo(() => {
    return visibleMessages.flatMap(m => m.editSteps);
  }, [visibleMessages]);

  return (
    <div className='flex flex-col h-full bg-white overflow-hidden'>
      <div className='flex-shrink-0 px-3 md:px-4 py-3 md:py-4 border-b border-gray-100 bg-gray-50/50'>
        <div className='flex flex-col gap-3 w-full'>
          <div className='flex items-center justify-between w-full'>
            <div className='flex bg-gray-200/60 p-1 rounded-lg w-full'>
              <button
                onClick={() => setActiveTab('chat')}
                className={`flex-1 py-1.5 px-3 text-xs font-semibold rounded-md transition-all flex items-center justify-center gap-1.5 ${
                  activeTab === 'chat'
                    ? 'bg-white text-gray-800 shadow-sm ring-1 ring-gray-900/5'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100/50'
                }`}
                data-track-category='Workflows'
                data-track-name='SwitchToAgentChatTab'
              >
                <MessageSquare
                  size={13}
                  className={activeTab === 'chat' ? 'text-sky-500' : 'text-gray-400'}
                />
                Chat View
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[9px] ${activeTab === 'chat' ? 'bg-gray-100 text-gray-600' : 'bg-gray-200/80 text-gray-500'}`}
                >
                  {visibleMessages.length}
                </span>
              </button>
              <button
                onClick={() => setActiveTab('diff')}
                className={`flex-1 py-1.5 px-3 text-xs font-semibold rounded-md transition-all flex items-center justify-center gap-1.5 ${
                  activeTab === 'diff'
                    ? 'bg-white text-gray-800 shadow-sm ring-1 ring-gray-900/5'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100/50'
                }`}
                data-track-category='Workflows'
                data-track-name='SwitchToAgentDiffTab'
              >
                <FileEdit
                  size={13}
                  className={activeTab === 'diff' ? 'text-amber-500' : 'text-gray-400'}
                />
                Diff View
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[9px] ${activeTab === 'diff' ? 'bg-gray-100 text-gray-600' : 'bg-gray-200/80 text-gray-500'}`}
                >
                  {allEditSteps.length}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className='flex-1 overflow-y-auto px-3 md:px-6 lg:px-8 py-4 space-y-4 no-scrollbar'>
        {activeTab === 'diff' ? (
          <div className='h-full -mx-3 md:-mx-6 lg:-mx-8 -my-4'>
            <LiveEditsPanel combinedStepsData={combinedStepsData} />
          </div>
        ) : visibleMessages.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {visibleMessages.map((msg, i) => (
              <AgentMessageBubble
                key={`${msg.stepName}-${msg.nodeIndex}`}
                message={msg}
                isLatest={i === visibleMessages.length - 1}
                onViewMore={openModal}
              />
            ))}
          </>
        )}
        <div ref={bottomRef} />
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

      <div className='flex-1 min-w-0 max-w-full md:max-w-[85%] lg:max-w-[75%]'>
        <div className='flex items-center gap-1.5 md:gap-2 mb-1.5 flex-wrap'>
          <span className={`text-xs font-semibold ${agentInfo.labelColor}`}>{agentInfo.name}</span>

          {hasMultipleTurns && (
            <span className='flex items-center gap-1 text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded'>
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

          <span className='flex items-center gap-1 text-[10px] text-gray-400 ml-auto'>
            <StatusIcon status={status} size={10} />
            <span className='capitalize hidden sm:inline'>{status}</span>
          </span>
          {/* Validation/Status metadata row ending */}
        </div>

        {(summary || isRunning || canShowTurns) && (
          <div
            className={`rounded-xl md:rounded-2xl rounded-tl-sm border px-3 md:px-4 py-2.5 md:py-3 ${agentInfo.bubbleBg} ${agentInfo.bubbleBorder} transition-shadow ${isLatest && isRunning ? 'shadow-sm ring-1 ring-sky-200' : ''}`}
          >
            {summary ? (
              <TruncatableMarkdownContent
                content={summary}
                onExpandChange={setIsSummaryFullyVisible}
                onViewMore={handleViewMore}
              />
            ) : isRunning ? (
              <div className='flex items-center gap-2 text-sm text-gray-500 py-0.5'>
                <Loader2 size={14} className='animate-spin text-sky-400' />
                <span>Running…</span>
              </div>
            ) : (
              <span className='text-sm text-gray-400 italic'>No output available</span>
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
                  <div className='mt-3 space-y-0 divide-y divide-gray-100 rounded-xl border border-black/5 bg-white/60 p-3'>
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
          <span className='text-[10px] text-gray-400 mt-1 block'>{formatTime(createdAt)}</span>
        )}
      </div>
    </div>
  );
};

export default AgentChatView;
