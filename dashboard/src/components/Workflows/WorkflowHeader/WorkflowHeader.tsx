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
import { useUser } from '../../../hooks/useUsers';

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
  isAgentChatOpen?: boolean;
  onAgentChatToggle?: () => void;
  /** Git branch for Jenkins builds (from workflow gitInfo) */
  gitBranch?: string | undefined;
  workflowType?: string | undefined;
  onTriggerWorkflow?: () => void;
  executorType?: string | undefined;
  useQuestioningMode?: boolean | undefined;
  model?: string | undefined;
  prLink?: string | undefined;
  createdBy?: string | undefined;
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
      bg: 'bg-muted border border-border',
      text: 'text-muted-foreground',
      dot: 'bg-gray-400',
      label: status || 'Unknown',
    }
  );
};

const MenuItem: React.FC<
  {
    onClick: () => void;
    icon: React.ReactNode;
    children: React.ReactNode;
  } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'>
> = ({ onClick, icon, children, ...rest }) => (
  <button
    onClick={onClick}
    className='w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors'
    data-track-category='Workflows'
    data-track-name='SelectMenuItem'
    {...rest}
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
  executorType,
  useQuestioningMode,
  model,
  prLink,
  createdBy,
}) => {
  const navigate = useNavigate();
  // const [showDesc, setShowDesc] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showJenkinsPanel, setShowJenkinsPanel] = useState(false);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [isTriggering, setIsTriggering] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const jenkinsPanelRef = useRef<HTMLDivElement>(null);
  const statusDropdownRef = useRef<HTMLDivElement>(null);

  const { cancelExecution, isCanceling } = useWorkflowControl();

  const createdByUser = useUser(createdBy ?? '');

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
  const closeStatusDropdown = useCallback(() => setShowStatusDropdown(false), []);
  useClickOutside(menuRef, closeMenu, showMenu);
  useClickOutside(jenkinsPanelRef, closeJenkinsPanel, showJenkinsPanel);
  useClickOutside(statusDropdownRef, closeStatusDropdown, showStatusDropdown);

  const status = executionStatus?.toLowerCase() || '';
  const isRunning = ['running', 'in_progress'].includes(status);
  const statusConfig = getStatusConfig(executionStatus);
  // const desc = ticket.description || '';
  // const displayDesc = !showDesc && desc.length > 150 ? desc.slice(0, 150) + '...' : desc;

  return (
    <div className='flex-shrink-0 bg-white border-b border-gray-100'>
      <div className='flex items-center justify-between px-3 md:px-4 py-2 md:py-2.5 gap-2'>
        <div className='flex items-center gap-1.5 md:gap-2 text-sm min-w-0 flex-1'>
          <button
            onClick={() => void navigate('/tickets?clear=true')}
            className='p-1.5 rounded-md hover:bg-gray-100 transition-colors flex-shrink-0'
            title='Back to Workflows'
            data-track-category='Workflows'
            data-track-name='NavigateBackToWorkflows'
            data-track-metadata={JSON.stringify({ ticketId: ticket.id })}
          >
            <ChevronLeft size={20} className='text-gray-500' />
          </button>
          <span className='font-semibold text-gray-900 truncate text-sm md:text-base'>
            {ticket.xyneId || `RUN-${ticket.id.slice(0, 4).toUpperCase()}`}
          </span>
          {workflowType && (
            <>
              <ChevronRight size={14} className='text-gray-300 flex-shrink-0 hidden sm:block' />
              <span className='text-gray-600 truncate hidden sm:block max-w-[120px] md:max-w-none'>
                {workflowType.length > 15 ? `${workflowType.slice(0, 15)}...` : workflowType}
              </span>
            </>
          )}
          {executionStatus && (
            <>
              <ChevronRight size={14} className='text-gray-300 flex-shrink-0 hidden sm:block' />
              <div className='relative' ref={statusDropdownRef}>
                <button
                  onClick={() => setShowStatusDropdown(!showStatusDropdown)}
                  className={`inline-flex items-center gap-1 px-1.5 md:px-2 py-0.5 rounded-md ${statusConfig.bg} cursor-pointer hover:opacity-80 transition-opacity`}
                  data-track-category='Workflows'
                  data-track-name='ToggleStatusDropdown'
                  data-track-metadata={JSON.stringify({ executionStatus, ticketId: ticket.id })}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${statusConfig.dot} ${isRunning ? 'animate-pulse' : ''}`}
                  />
                  <span className={`text-[10px] md:text-xs font-medium ${statusConfig.text}`}>
                    {statusConfig.label}
                  </span>
                  <ChevronDown size={10} className={`${statusConfig.text} hidden sm:block`} />
                </button>
                {showStatusDropdown && (
                  <div className='absolute left-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg py-2 z-[60]'>
                    {executorType && (
                      <div className='px-3 py-2 text-sm rounded-md hover:bg-gray-50 hover:shadow-sm transition-all'>
                        <span className='font-medium text-gray-900'>Executor: {executorType}</span>
                      </div>
                    )}
                    {model && (
                      <div className='px-3 py-2 text-sm rounded-md hover:bg-gray-50 hover:shadow-sm transition-all'>
                        <span className='font-medium text-gray-900'>Model: {model}</span>
                      </div>
                    )}
                    {prLink && (
                      <div className='px-3 py-2 text-sm rounded-md hover:bg-gray-50 hover:shadow-sm transition-all'>
                        <a
                          href={prLink}
                          target='_blank'
                          rel='noopener noreferrer'
                          className='font-medium text-gray-900 hover:underline'
                          onClick={e => e.stopPropagation()}
                          data-track-category='Workflows'
                          data-track-name='OpenPullRequestLink'
                          data-track-metadata={JSON.stringify({ prLink, ticketId: ticket.id })}
                        >
                          Link to Pull Request
                        </a>
                      </div>
                    )}
                    {useQuestioningMode && (
                      <div className='px-3 py-2 text-sm rounded-md hover:bg-gray-50 hover:shadow-sm transition-all'>
                        <span className='font-medium text-gray-900'>Questioning Enabled</span>
                      </div>
                    )}
                    {createdByUser?.id && (
                      <div className='px-3 py-2 text-sm rounded-md hover:bg-gray-50 hover:shadow-sm transition-all'>
                        <span className='font-medium text-gray-900'>
                          Created By: {createdByUser.name || createdByUser.email || 'Unknown'}
                        </span>
                      </div>
                    )}
                    {!executorType &&
                      !model &&
                      !prLink &&
                      !useQuestioningMode &&
                      !createdByUser?.id && (
                        <div className='px-3 py-2 text-sm text-gray-500'>
                          No additional metadata available
                        </div>
                      )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <div className='flex items-center gap-1 md:gap-2 flex-shrink-0'>
          {onTriggerWorkflow && (
            <button
              onClick={onTriggerWorkflow}
              className='hidden md:inline-flex items-center gap-1 px-2 py-1 rounded-md border border-gray-200 hover:bg-gray-50 hover:border-gray-300 transition-colors text-xs text-gray-700'
              title='Trigger Workflow'
              data-track-category='Workflows'
              data-track-name='TriggerWorkflow'
              data-track-metadata={JSON.stringify({ ticketId: ticket.id, workflowType })}
            >
              <Play size={14} className='text-muted-foreground flex-shrink-0' />
              Trigger
            </button>
          )}
          {isRunning && (
            <button
              onClick={handleCancelWorkflow}
              disabled={isCanceling || !executionId}
              className='inline-flex items-center gap-1 px-2 py-1 rounded-md border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 hover:border-red-300 transition-colors text-xs disabled:opacity-50 disabled:cursor-not-allowed'
              title='Cancel Workflow'
              data-track-category='Workflows'
              data-track-name='CancelWorkflow'
              data-track-metadata={JSON.stringify({ executionId })}
            >
              <XCircle size={14} className='text-red-600 flex-shrink-0' />
              <span className='hidden sm:inline'>{isCanceling ? 'Canceling...' : 'Cancel'}</span>
            </button>
          )}
          {(onOpenWorkflowGraph || onGraphViewToggle) && (
            <button
              className={`hidden md:inline-flex items-center gap-1 px-2 py-1 rounded-md border transition-colors text-xs ${isGraphViewOpen ? 'bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100' : 'border-gray-200 hover:bg-gray-50 hover:border-gray-300'}`}
              title={isGraphViewOpen ? 'Hide Workflow Graph' : 'Show Workflow Graph'}
              onClick={onGraphViewToggle || onOpenWorkflowGraph}
              data-track-category='Workflows'
              data-track-name='ToggleWorkflowGraph'
              data-track-metadata={JSON.stringify({ isGraphViewOpen })}
            >
              <Workflow
                size={14}
                className={`${isGraphViewOpen ? 'text-blue-600' : 'text-gray-500'} flex-shrink-0`}
              />
              Workflow
            </button>
          )}
          {gitBranch && (
            <div className='relative hidden md:block' ref={jenkinsPanelRef}>
              <button
                data-jenkins-trigger
                onClick={() => setShowJenkinsPanel(!showJenkinsPanel)}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border transition-colors text-xs ${
                  showJenkinsPanel
                    ? 'border-orange-300 bg-orange-100 text-orange-700'
                    : 'border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 hover:border-orange-300'
                }`}
                title='Trigger Build'
                data-track-category='Workflows'
                data-track-name='ToggleJenkinsPanel'
                data-track-metadata={JSON.stringify({ branch: gitBranch })}
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
          <div className='relative' ref={menuRef}>
            <button
              className='p-1.5 rounded-md hover:bg-muted transition-colors'
              onClick={() => setShowMenu(!showMenu)}
              title='More'
              data-track-category='Workflows'
              data-track-name='ToggleMoreMenu'
              data-track-metadata={JSON.stringify({ ticketId: ticket.id })}
            >
              <MoreVertical size={18} className='text-gray-500' />
            </button>
            {showMenu && (
              <div className='absolute right-0 top-full mt-1 w-44 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-[100]'>
                {onTriggerWorkflow && (
                  <div className='md:hidden'>
                    <MenuItem
                      onClick={() => {
                        onTriggerWorkflow();
                        setShowMenu(false);
                      }}
                      icon={<Play size={14} className='text-gray-400' />}
                      data-track-category='Workflows'
                      data-track-name='TriggerWorkflow'
                    >
                      Trigger Workflow
                    </MenuItem>
                  </div>
                )}
                {(onOpenWorkflowGraph || onGraphViewToggle) && (
                  <div className='md:hidden'>
                    <MenuItem
                      onClick={() => {
                        (onGraphViewToggle || onOpenWorkflowGraph)?.();
                        setShowMenu(false);
                      }}
                      icon={<Workflow size={14} className='text-gray-400' />}
                      data-track-category='Workflows'
                      data-track-name='ToggleWorkflowGraph'
                    >
                      {isGraphViewOpen ? 'Hide Workflow' : 'Show Workflow'}
                    </MenuItem>
                  </div>
                )}

                {gitBranch && (
                  <div className='md:hidden'>
                    <MenuItem
                      onClick={() => {
                        void handleTriggerJenkinsBuild();
                        setShowMenu(false);
                      }}
                      icon={<Rocket size={14} className='text-orange-500' />}
                      data-track-category='Workflows'
                      data-track-name='TriggerJenkinsBuild'
                    >
                      Trigger Build
                    </MenuItem>
                  </div>
                )}
                <div className='border-t border-gray-100 md:border-t-0' />
                <MenuItem
                  onClick={() => {
                    void navigator.clipboard.writeText(executionId || ticket.id);
                    toast.success('Copied', { description: 'Run ID copied', duration: 2000 });
                    setShowMenu(false);
                  }}
                  icon={<Copy size={14} className='text-muted-foreground' />}
                  data-track-category='Workflows'
                  data-track-name='CopyRunId'
                  data-track-metadata={JSON.stringify({ ticketId: ticket.id })}
                >
                  Copy Run ID
                </MenuItem>
                {onOpenTableView && (
                  <MenuItem
                    onClick={() => {
                      onOpenTableView();
                      setShowMenu(false);
                    }}
                    icon={<Table2 size={14} className='text-muted-foreground' />}
                    data-track-category='Workflows'
                    data-track-name='OpenTableView'
                    data-track-metadata={JSON.stringify({ ticketId: ticket.id })}
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
                    icon={<GitDiff size={14} className='text-muted-foreground' />}
                  >
                    View Git Diff
                  </MenuItem>
                )} */}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className='px-3 md:px-4 pb-2 md:pb-3'>
        <h1 className='text-sm md:text-base font-semibold text-gray-900 leading-tight line-clamp-2'>
          {ticket.title}
        </h1>
      </div>
    </div>
  );
};

export default WorkflowHeader;
