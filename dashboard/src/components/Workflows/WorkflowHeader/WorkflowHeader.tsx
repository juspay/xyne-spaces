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
  workflowNumber?: number | undefined;
  workflowTitle?: string | undefined;
  repositoryUrl?: string | undefined;
}

type StatusConfig = { bg: string; text: string; dot: string; label: string };
const STATUS_MAP: Record<string, StatusConfig> = {
  running: {
    bg: 'bg-blue-500/10 border border-blue-500/20',
    text: 'text-blue-700 dark:text-blue-400',
    dot: 'bg-blue-500',
    label: 'In-Progress',
  },
  inProgress: {
    bg: 'bg-blue-500/10 border border-blue-500/20',
    text: 'text-blue-700 dark:text-blue-400',
    dot: 'bg-blue-500',
    label: 'In-Progress',
  },
  completed: {
    bg: 'bg-emerald-500/10 border border-emerald-500/20',
    text: 'text-emerald-700 dark:text-emerald-400',
    dot: 'bg-emerald-500',
    label: 'Completed',
  },
  success: {
    bg: 'bg-emerald-500/10 border border-emerald-500/20',
    text: 'text-emerald-700 dark:text-emerald-400',
    dot: 'bg-emerald-500',
    label: 'Completed',
  },
  failed: {
    bg: 'bg-red-500/10 border border-red-500/20',
    text: 'text-red-700 dark:text-red-400',
    dot: 'bg-red-500',
    label: 'Failed',
  },
  failure: {
    bg: 'bg-red-500/10 border border-red-500/20',
    text: 'text-red-700 dark:text-red-400',
    dot: 'bg-red-500',
    label: 'Failed',
  },
  paused: {
    bg: 'bg-amber-500/10 border border-amber-500/20',
    text: 'text-amber-700 dark:text-amber-400',
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
  workflowNumber,
  workflowTitle,
  repositoryUrl,
}) => {
  const navigate = useNavigate();
  // const [showDesc, setShowDesc] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showJenkinsPanel, setShowJenkinsPanel] = useState(false);
  const [showMetadataDropdown, setShowMetadataDropdown] = useState(false);
  const [isTriggering, setIsTriggering] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const jenkinsPanelRef = useRef<HTMLDivElement>(null);
  const metadataDropdownRef = useRef<HTMLDivElement>(null);

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
  const closeMetadataDropdown = useCallback(() => setShowMetadataDropdown(false), []);
  useClickOutside(menuRef, closeMenu, showMenu);
  useClickOutside(jenkinsPanelRef, closeJenkinsPanel, showJenkinsPanel);
  useClickOutside(metadataDropdownRef, closeMetadataDropdown, showMetadataDropdown);

  const status = executionStatus?.toLowerCase() || '';
  const isRunning = ['running', 'in_progress'].includes(status);
  const statusConfig = getStatusConfig(executionStatus);
  // const desc = ticket.description || '';
  // const displayDesc = !showDesc && desc.length > 150 ? desc.slice(0, 150) + '...' : desc;

  return (
    <div className='flex-shrink-0 bg-background border-b border-border'>
      <div className='flex items-center justify-between px-3 md:px-4 py-2 md:py-2.5 gap-2'>
        <div className='flex items-center gap-1.5 md:gap-2 text-sm min-w-0 flex-1'>
          <button
            onClick={() => void navigate('/tickets?clear=true')}
            className='rounded-md hover:bg-muted transition-colors flex-shrink-0 -ml-1'
            title='Back to Workflows'
            data-track-category='Workflows'
            data-track-name='NavigateBackToWorkflows'
            data-track-metadata={JSON.stringify({ ticketId: ticket.id })}
          >
            <ChevronLeft size={20} className='text-muted-foreground' />
          </button>
          <span className='font-semibold text-foreground truncate text-sm md:text-base'>
            {ticket.xyneId || `RUN-${ticket.id.slice(0, 4).toUpperCase()}`}
          </span>
          {workflowType && (
            <>
              <ChevronRight size={14} className='text-muted-foreground/50 flex-shrink-0' />
              <div className='relative' ref={metadataDropdownRef}>
                <button
                  onClick={() => setShowMetadataDropdown(!showMetadataDropdown)}
                  className='text-muted-foreground truncate cursor-pointer hover:opacity-80 transition-opacity bg-transparent border-none p-0 inline-flex items-center gap-0.5'
                  data-track-category='Workflows'
                  data-track-name='ToggleStatusDropdown'
                  data-track-metadata={JSON.stringify({ executionStatus, ticketId: ticket.id })}
                >
                  <span>
                    {workflowType.length > 20 ? `${workflowType.slice(0, 20)}...` : workflowType}
                  </span>
                  <ChevronDown size={14} className='text-muted-foreground flex-shrink-0' />
                </button>
                {showMetadataDropdown && (
                  <div className='absolute left-0 top-full mt-1 w-48 bg-background border border-border rounded-lg shadow-lg py-2 z-[60]'>
                    {executorType && (
                      <div className='px-3 py-2 text-sm rounded-md hover:bg-muted hover:shadow-sm transition-all'>
                        <span className='font-medium text-foreground'>
                          Executor: {executorType}
                        </span>
                      </div>
                    )}
                    {model && (
                      <div className='px-3 py-2 text-sm rounded-md hover:bg-muted hover:shadow-sm transition-all'>
                        <span className='font-medium text-foreground'>Model: {model}</span>
                      </div>
                    )}
                    {repositoryUrl && (
                      <div className='px-3 py-2 text-sm rounded-md hover:bg-muted hover:shadow-sm transition-all'>
                        <span className='font-medium text-foreground'>
                          Repository Url: {repositoryUrl}
                        </span>
                      </div>
                    )}
                    {prLink && (
                      <div className='px-3 py-2 text-sm rounded-md hover:bg-muted hover:shadow-sm transition-all'>
                        <a
                          href={prLink}
                          target='_blank'
                          rel='noopener noreferrer'
                          className='font-medium text-foreground hover:underline'
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
                      <div className='px-3 py-2 text-sm rounded-md hover:bg-muted hover:shadow-sm transition-all'>
                        <span className='font-medium text-foreground'>Questioning Enabled</span>
                      </div>
                    )}
                    {createdByUser?.id && (
                      <div className='px-3 py-2 text-sm rounded-md hover:bg-muted hover:shadow-sm transition-all'>
                        <span className='font-medium text-foreground'>
                          Ran By: {createdByUser.name || createdByUser.email || 'Unknown'}
                        </span>
                      </div>
                    )}
                    {!executorType &&
                      !model &&
                      !prLink &&
                      !useQuestioningMode &&
                      !createdByUser?.id && (
                        <div className='px-3 py-2 text-sm text-muted-foreground'>
                          No additional metadata available
                        </div>
                      )}
                  </div>
                )}
              </div>
            </>
          )}
          {executionStatus && (
            <>
              <ChevronRight size={14} className='text-muted-foreground/50 flex-shrink-0' />
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
        <div className='flex items-center gap-1 md:gap-2 flex-shrink-0'>
          {onTriggerWorkflow && (
            <button
              onClick={onTriggerWorkflow}
              className='hidden md:inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border hover:bg-muted hover:border-border transition-colors text-xs text-foreground'
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
              className='inline-flex items-center gap-1 px-2 py-1 rounded-md border border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400 hover:bg-red-500/20 hover:border-red-500/30 transition-colors text-xs disabled:opacity-50 disabled:cursor-not-allowed'
              title='Cancel Workflow'
              data-track-category='Workflows'
              data-track-name='CancelWorkflow'
              data-track-metadata={JSON.stringify({ executionId })}
            >
              <XCircle size={14} className='text-red-600 dark:text-red-400 flex-shrink-0' />
              <span className='hidden sm:inline'>{isCanceling ? 'Canceling...' : 'Cancel'}</span>
            </button>
          )}
          {(onOpenWorkflowGraph || onGraphViewToggle) && (
            <button
              className={`hidden md:inline-flex items-center gap-1 px-2 py-1 rounded-md border transition-colors text-xs ${isGraphViewOpen ? 'bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-400 hover:bg-blue-500/20' : 'border-border hover:bg-muted hover:border-border text-foreground'}`}
              title={isGraphViewOpen ? 'Hide Workflow Graph' : 'Show Workflow Graph'}
              onClick={onGraphViewToggle || onOpenWorkflowGraph}
              data-track-category='Workflows'
              data-track-name='ToggleWorkflowGraph'
              data-track-metadata={JSON.stringify({ isGraphViewOpen })}
            >
              <Workflow
                size={14}
                className={`${isGraphViewOpen ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'} flex-shrink-0`}
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
                    ? 'border-orange-500/30 bg-orange-500/20 text-orange-700 dark:text-orange-400'
                    : 'border-orange-500/20 bg-orange-500/10 text-orange-700 dark:text-orange-400 hover:bg-orange-500/20 hover:border-orange-500/30'
                }`}
                title='Trigger Build'
                data-track-category='Workflows'
                data-track-name='ToggleJenkinsPanel'
                data-track-metadata={JSON.stringify({ branch: gitBranch })}
              >
                <Rocket size={14} className='text-orange-600 dark:text-orange-400 flex-shrink-0' />
                Build
                {showJenkinsPanel ? (
                  <ChevronUp size={12} className='text-orange-600 dark:text-orange-400' />
                ) : (
                  <ChevronDown size={12} className='text-orange-600 dark:text-orange-400' />
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
              <MoreVertical size={18} className='text-muted-foreground' />
            </button>
            {showMenu && (
              <div className='absolute right-0 top-full mt-1 w-44 bg-background border border-border rounded-lg shadow-lg py-1 z-[100]'>
                {onTriggerWorkflow && (
                  <div className='md:hidden'>
                    <MenuItem
                      onClick={() => {
                        onTriggerWorkflow();
                        setShowMenu(false);
                      }}
                      icon={<Play size={14} className='text-muted-foreground' />}
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
                      icon={<Workflow size={14} className='text-muted-foreground' />}
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
                      icon={<Rocket size={14} className='text-orange-500 dark:text-orange-400' />}
                      data-track-category='Workflows'
                      data-track-name='TriggerJenkinsBuild'
                    >
                      Trigger Build
                    </MenuItem>
                  </div>
                )}
                <div className='border-t border-border md:border-t-0' />
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
      <div className='px-4 pb-3'>
        <h1 className='text-base font-semibold text-foreground leading-tight flex items-center gap-2'>
          {workflowNumber !== undefined && (
            <span className='inline-flex items-center justify-center flex-shrink-0 min-w-[28px] h-6 px-2 bg-blue-500/10 text-blue-700 dark:text-blue-400 text-xs font-bold rounded-full border border-blue-500/20'>
              #{workflowNumber}
            </span>
          )}
          <span className='truncate'>{workflowTitle ?? ticket.title}</span>
        </h1>
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
