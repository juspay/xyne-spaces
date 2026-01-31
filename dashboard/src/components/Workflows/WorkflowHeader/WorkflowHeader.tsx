/**
 * WorkflowHeader - Compact Linear-style header with status, actions, and breadcrumb.
 * Uses useWorkflowControl hook for pause/resume/cancel actions.
 */
import React, { useState, useRef, useEffect, useCallback, RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  MoreVertical,
  Copy,
  Table2,
  Workflow,
  XCircle,
  Rocket,
  Play,
} from 'lucide-react';
import { toast } from 'sonner';
import { Ticket } from '../../../hooks/useTickets';
import { ExecutionMetadata } from '../../../services/Workflow/workflowGraphService.types';
import { useWorkflowControl } from '../../../services/Workflow/workflowGraphService';
import { JenkinsBuildPanel } from '../JenkinsBuildPanel/JenkinsBuildPanel';
import { jenkinsService } from '../../../services/Jenkins';

const useClickOutside = (
  ref: RefObject<HTMLElement | null>,
  handler: () => void,
  enabled = true,
): void => {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;

    const handleClick = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        handlerRef.current();
      }
    };

    document.addEventListener('mousedown', handleClick);
    return (): void => {
      document.removeEventListener('mousedown', handleClick);
    };
  }, [ref, enabled]);
};

export interface WorkflowHeaderProps {
  ticket: Ticket;
  executionId?: string;
  executionStatus?: string;
  executionMetadata?: ExecutionMetadata[];
  selectedExecutionId?: string;
  onExecutionSelect?: (executionId: string) => void;
  onOpenTableView?: () => void;
  onOpenDebugView?: () => void;
  onOpenGitDiff?: () => void;
  onOpenWorkflowGraph?: () => void;
  isGraphViewOpen?: boolean;
  onGraphViewToggle?: () => void;
  /** Git branch for Jenkins builds (from workflow gitInfo) */
  gitBranch?: string | undefined;
  workflowType?: string | undefined;
  onTriggerWorkflow?: () => void;
}

type StatusConfig = { bg: string; text: string; dot: string; label: string };
const STATUS_MAP: Record<string, StatusConfig> = {
  running: {
    bg: 'bg-blue-50 border border-blue-200',
    text: 'text-blue-700',
    dot: 'bg-blue-500',
    label: 'In-Progress',
  },
  inProgress: {
    bg: 'bg-blue-50 border border-blue-200',
    text: 'text-blue-700',
    dot: 'bg-blue-500',
    label: 'In-Progress',
  },
  completed: {
    bg: 'bg-emerald-50 border border-emerald-200',
    text: 'text-emerald-700',
    dot: 'bg-emerald-500',
    label: 'Completed',
  },
  success: {
    bg: 'bg-emerald-50 border border-emerald-200',
    text: 'text-emerald-700',
    dot: 'bg-emerald-500',
    label: 'Completed',
  },
  failed: {
    bg: 'bg-red-50 border border-red-200',
    text: 'text-red-700',
    dot: 'bg-red-500',
    label: 'Failed',
  },
  failure: {
    bg: 'bg-red-50 border border-red-200',
    text: 'text-red-700',
    dot: 'bg-red-500',
    label: 'Failed',
  },
  paused: {
    bg: 'bg-amber-50 border border-amber-200',
    text: 'text-amber-700',
    dot: 'bg-amber-500',
    label: 'Paused',
  },
};
const getStatusConfig = (status?: string): StatusConfig => {
  const key = status?.toLowerCase().replace(/_/g, '') || '';
  return (
    STATUS_MAP[key] || {
      bg: 'bg-gray-50 border border-gray-200',
      text: 'text-gray-600',
      dot: 'bg-gray-400',
      label: status || 'Unknown',
    }
  );
};

const MenuItem: React.FC<{
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}> = ({ onClick, icon, children }) => (
  <button
    onClick={onClick}
    className='w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors'
  >
    {icon}
    {children}
  </button>
);

export const WorkflowHeader: React.FC<WorkflowHeaderProps> = ({
  ticket,
  executionId,
  executionStatus,
  executionMetadata: _executionMetadata = [],
  selectedExecutionId: _selectedExecutionId,
  onExecutionSelect: _onExecutionSelect,
  onOpenTableView,
  onOpenWorkflowGraph,
  isGraphViewOpen,
  onGraphViewToggle,
  gitBranch,
  workflowType,
  onTriggerWorkflow,
}) => {
  const navigate = useNavigate();
  // const [showDesc, setShowDesc] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showJenkinsPanel, setShowJenkinsPanel] = useState(false);
  const [isTriggering, setIsTriggering] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const jenkinsPanelRef = useRef<HTMLDivElement>(null);

  const { cancelExecution, isCanceling } = useWorkflowControl();

  const handleCancelWorkflow = (): void => {
    if (!executionId) return;
    cancelExecution(executionId);
    toast.info('Canceling', {
      description: 'Workflow cancellation requested',
      duration: 3000,
    });
  };

  const handleTriggerJenkinsBuild = async (): Promise<void> => {
    if (!gitBranch) return;
    setIsTriggering(true);
    try {
      const result = await jenkinsService.triggerBuild(gitBranch);
      if (result.success) {
        toast.success('Jenkins Build Triggered', {
          description: result.message || 'Build queued successfully',
          duration: 4000,
        });
        setShowJenkinsPanel(true);
      } else {
        toast.error('Failed to trigger build', {
          description: 'Please try again later',
          duration: 4000,
        });
      }
    } catch {
      toast.error('Failed to trigger build', {
        description: 'Please try again later',
        duration: 4000,
      });
    } finally {
      setIsTriggering(false);
    }
  };

  const closeMenu = useCallback(() => setShowMenu(false), []);
  const closeJenkinsPanel = useCallback(() => setShowJenkinsPanel(false), []);
  useClickOutside(menuRef, closeMenu, showMenu);
  useClickOutside(jenkinsPanelRef, closeJenkinsPanel, showJenkinsPanel);

  const status = executionStatus?.toLowerCase() || '';
  const isRunning = ['running', 'in_progress'].includes(status);
  const statusConfig = getStatusConfig(executionStatus);
  // const desc = ticket.description || '';
  // const displayDesc = !showDesc && desc.length > 150 ? desc.slice(0, 150) + '...' : desc;

  return (
    <div className='flex-shrink-0 bg-white border-b border-red-100'>
      <div className='flex items-center justify-between px-4 py-2.5'>
        <div className='flex items-center gap-2 text-sm min-w-0'>
          <button
            onClick={() => void navigate('/tickets?clear=true')}
            className='p-1.5 rounded-md hover:bg-gray-100 transition-colors'
            title='Back to Workflows'
          >
            <ChevronLeft size={24} className='text-gray-500' />
          </button>
          <span className='font-semibold text-gray-900 truncate'>
            {ticket.xyneId || `RUN-${ticket.id.slice(0, 4).toUpperCase()}`}
          </span>
          {workflowType && (
            <>
              <ChevronRight size={14} className='text-gray-300 flex-shrink-0' />
              <span className='text-gray-600 truncate'>
                {workflowType.length > 20 ? `${workflowType.slice(0, 20)}...` : workflowType}
              </span>
            </>
          )}
          {executionStatus && (
            <>
              <ChevronRight size={14} className='text-gray-300 flex-shrink-0' />
              <div
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md ${statusConfig.bg}`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${statusConfig.dot} ${isRunning ? 'animate-pulse' : ''}`}
                />
                <span className={`text-xs font-medium ${statusConfig.text}`}>
                  {statusConfig.label}
                </span>
              </div>
            </>
          )}
        </div>
        <div className='flex items-center gap-2 flex-shrink-0'>
          {onTriggerWorkflow && (
            <button
              onClick={onTriggerWorkflow}
              className='inline-flex items-center gap-1 px-2 py-1 rounded-md border border-gray-200 hover:bg-gray-50 hover:border-gray-300 transition-colors text-xs text-gray-700'
              title='Trigger Workflow'
            >
              <Play size={14} className='text-gray-600 flex-shrink-0' />
              Trigger
            </button>
          )}
          {isRunning && (
            <button
              onClick={handleCancelWorkflow}
              disabled={isCanceling || !executionId}
              className='inline-flex items-center gap-1 px-2 py-1 rounded-md border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 hover:border-red-300 transition-colors text-xs disabled:opacity-50 disabled:cursor-not-allowed'
              title='Cancel Workflow'
            >
              <XCircle size={14} className='text-red-600 flex-shrink-0' />
              {isCanceling ? 'Canceling...' : 'Cancel'}
            </button>
          )}
          {(onOpenWorkflowGraph || onGraphViewToggle) && (
            <button
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border transition-colors text-xs ml-2 ${isGraphViewOpen ? 'bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100' : 'hover:bg-blue-100 hover:border-blue-300'}`}
              title={isGraphViewOpen ? 'Hide Workflow Graph' : 'Show Workflow Graph'}
              onClick={onGraphViewToggle || onOpenWorkflowGraph}
            >
              <Workflow
                size={14}
                className={`${isGraphViewOpen ? 'text-blue-600' : 'text-gray-300'} flex-shrink-0`}
              />
              {isGraphViewOpen ? 'Workflow' : 'Workflow'}
            </button>
          )}
          {/* {executionMetadata.length > 0 && onExecutionSelect && (
            <ExecutionAttemptDropdown
              executionMetadata={executionMetadata}
              {...(selectedExecutionId && { selectedExecutionId })}
              onExecutionSelect={onExecutionSelect}
            />
          )} */}
          {/* Jenkins build Button - only show if branch is available */}
          {gitBranch && (
            <div className='relative' ref={jenkinsPanelRef}>
              <button
                data-jenkins-trigger
                onClick={() => setShowJenkinsPanel(!showJenkinsPanel)}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border transition-colors text-xs ${
                  showJenkinsPanel
                    ? 'border-orange-300 bg-orange-100 text-orange-700'
                    : 'border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 hover:border-orange-300'
                }`}
                title='Trigger Build'
              >
                <Rocket size={14} className='text-orange-600 flex-shrink-0' />
                Build
                {showJenkinsPanel ? (
                  <ChevronUp size={12} className='text-orange-600' />
                ) : (
                  <ChevronDown size={12} className='text-orange-600' />
                )}
              </button>
              {showJenkinsPanel && (
                <div>
                  <JenkinsBuildPanel
                    onClose={() => setShowJenkinsPanel(false)}
                    branch={gitBranch}
                    onTriggerBuild={handleTriggerJenkinsBuild}
                    isTriggering={isTriggering}
                  />
                </div>
              )}
            </div>
          )}
          {/* {onOpenDebugView && (
            <button
              onClick={onOpenDebugView}
              className='inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white border border-gray-200 hover:bg-gray-50 hover:border-gray-300 transition-all'
              title='Debug View'
            >
              <GitBranch size={14} className='text-gray-600' />
              <span className='text-xs font-medium text-gray-600'>Workflow</span>
            </button>
          )} */}
          {/* {!isFinished && (
            <>
              <ActionBtn
                onClick={() => handleAction('cancel')}
                disabled={isCanceling || !executionId}
              >
                <XCircle size={14} />
                Cancel
              </ActionBtn>
              {isPaused ? (
                <ActionBtn
                  onClick={() => handleAction('resume')}
                  disabled={isResuming || !executionId}
                  primary
                >
                  <Play size={14} />
                  Resume
                </ActionBtn>
              ) : (
                <ActionBtn
                  onClick={() => handleAction('pause')}
                  disabled={isPausing || !executionId}
                >
                  <Pause size={14} />
                  Pause
                </ActionBtn>
              )}
            </>
          )} */}
          <div className='relative' ref={menuRef}>
            <button
              className='p-1.5 rounded-md hover:bg-gray-100 transition-colors'
              onClick={() => setShowMenu(!showMenu)}
              title='More'
            >
              <MoreVertical size={16} className='text-gray-400' />
            </button>
            {showMenu && (
              <div className='absolute right-0 top-full mt-1 w-40 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50'>
                <MenuItem
                  onClick={() => {
                    void navigator.clipboard.writeText(executionId || ticket.id);
                    toast.success('Copied', { description: 'Run ID copied', duration: 2000 });
                    setShowMenu(false);
                  }}
                  icon={<Copy size={14} className='text-gray-400' />}
                >
                  Copy Run ID
                </MenuItem>
                {onOpenTableView && (
                  <MenuItem
                    onClick={() => {
                      onOpenTableView();
                      setShowMenu(false);
                    }}
                    icon={<Table2 size={14} className='text-gray-400' />}
                  >
                    Table View
                  </MenuItem>
                )}
                {/* {onOpenGitDiff && (
                  <MenuItem
                    onClick={() => {
                      onOpenGitDiff();
                      setShowMenu(false);
                    }}
                    icon={<GitDiff size={14} className='text-gray-400' />}
                  >
                    View Git Diff
                  </MenuItem>
                )} */}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className='px-4 pb-3'>
        <h1 className='text-base font-semibold text-gray-900 leading-tight'>{ticket.title}</h1>
        {/* {desc && (
          <div className='mt-1.5 flex items-start gap-2'>
            <p className='text-sm text-gray-500 leading-relaxed flex-1'>{displayDesc}</p>
            {desc.length > 150 && (
              <button
                onClick={() => setShowDesc(!showDesc)}
                className='text-xs font-medium text-blue-500 hover:text-blue-600 whitespace-nowrap flex-shrink-0 mt-0.5'
              >
                {showDesc ? 'View Less' : 'View More'}
              </button>
            )}
          </div>
        )} */}
      </div>
    </div>
  );
};

export default WorkflowHeader;
