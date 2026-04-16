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
  AlertTriangle,
  Terminal,
  CheckCheck,
  X,
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
  failureOutput?: { name?: string; message?: string; stack?: string } | null;
}

type StatusConfig = { bg: string; text: string; dot: string; label: string };
const STATUS_MAP: Record<string, StatusConfig> = {
  running: {
    bg: 'bg-muted border border-border',
    text: 'text-status-scheduled',
    dot: 'bg-status-scheduled',
    label: 'In-Progress',
  },
  inProgress: {
    bg: 'bg-muted border border-border',
    text: 'text-status-scheduled',
    dot: 'bg-status-scheduled',
    label: 'In-Progress',
  },
  completed: {
    bg: 'bg-stage-completed border border-stage-completed-border',
    text: 'text-status-success',
    dot: 'bg-status-success',
    label: 'Completed',
  },
  success: {
    bg: 'bg-stage-completed border border-stage-completed-border',
    text: 'text-status-success',
    dot: 'bg-status-success',
    label: 'Completed',
  },
  failed: {
    bg: 'bg-stage-cancelled border border-stage-cancelled-border',
    text: 'text-status-failure',
    dot: 'bg-status-failure',
    label: 'Failed',
  },
  failure: {
    bg: 'bg-stage-cancelled border border-stage-cancelled-border',
    text: 'text-status-failure',
    dot: 'bg-status-failure',
    label: 'Failed',
  },
  paused: {
    bg: 'bg-muted border border-border',
    text: 'text-status-pending',
    dot: 'bg-status-pending',
    label: 'Paused',
  },
};
const getStatusConfig = (status?: string): StatusConfig => {
  const key = status?.toLowerCase().replace(/_/g, '') || '';
  return (
    STATUS_MAP[key] || {
      bg: 'bg-muted border border-border',
      text: 'text-muted-foreground',
      dot: 'bg-muted-foreground',
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
  failureOutput,
}) => {
  const navigate = useNavigate();
  // const [showDesc, setShowDesc] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showJenkinsPanel, setShowJenkinsPanel] = useState(false);
  const [showMetadataDropdown, setShowMetadataDropdown] = useState(false);
  const [showFailurePopover, setShowFailurePopover] = useState(false);
  const [stackCopied, setStackCopied] = useState(false);
  const [isTriggering, setIsTriggering] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const jenkinsPanelRef = useRef<HTMLDivElement>(null);
  const metadataDropdownRef = useRef<HTMLDivElement>(null);
  const mobileMetadataRef = useRef<HTMLDivElement>(null);
  const failurePopoverRef = useRef<HTMLDivElement>(null);

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
  const closeFailurePopover = useCallback(() => setShowFailurePopover(false), []);
  useClickOutside(menuRef, closeMenu, showMenu);
  useClickOutside(jenkinsPanelRef, closeJenkinsPanel, showJenkinsPanel);
  useClickOutside(metadataDropdownRef, closeMetadataDropdown, showMetadataDropdown);
  useClickOutside(mobileMetadataRef, closeMetadataDropdown, showMetadataDropdown);
  useClickOutside(failurePopoverRef, closeFailurePopover, showFailurePopover);

  const handleCopyStack = useCallback(() => {
    if (!failureOutput?.stack) return;
    void navigator.clipboard.writeText(failureOutput.stack);
    setStackCopied(true);
    setTimeout(() => setStackCopied(false), 2000);
  }, [failureOutput]);

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
              <ChevronRight
                size={14}
                className='hidden md:block text-muted-foreground/50 flex-shrink-0'
              />
              <div className='hidden md:block relative' ref={metadataDropdownRef}>
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
                  <div className='absolute left-0 top-full mt-1 w-72 bg-background border border-border rounded-lg shadow-lg py-2 z-[60]'>
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
                        <span className='font-medium text-foreground block'>Repository Url:</span>
                        <span className='text-foreground break-all text-xs'>{repositoryUrl}</span>
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
              {failureOutput && ['failed', 'failure'].includes(status) ? (
                <div className='relative' ref={failurePopoverRef}>
                  <button
                    onClick={() => setShowFailurePopover(!showFailurePopover)}
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md cursor-pointer transition-all hover:shadow-sm hover:scale-[1.02] active:scale-[0.98] ${statusConfig.bg} group`}
                    title='Click to see failure details'
                    data-track-category='Workflows'
                    data-track-name='OpenFailureDetails'
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${statusConfig.dot} animate-pulse`}
                    />
                    <span className={`text-xs font-medium ${statusConfig.text}`}>
                      {statusConfig.label}
                    </span>
                    <AlertTriangle
                      size={11}
                      className={`${statusConfig.text} opacity-70 group-hover:opacity-100 transition-opacity`}
                    />
                  </button>
                  {showFailurePopover && (
                    <div className='fixed left-2 right-2 top-14 sm:absolute sm:left-0 sm:right-auto sm:top-full sm:mt-2 sm:w-[480px] bg-background border border-red-500/20 rounded-xl shadow-xl z-[200] overflow-hidden'>
                      {/* Header */}
                      <div className='flex items-center gap-2.5 px-4 py-3 bg-red-500/10 border-b border-red-500/20'>
                        <div className='flex-shrink-0 w-7 h-7 rounded-lg bg-red-500/15 flex items-center justify-center'>
                          <XCircle size={14} className='text-red-500' />
                        </div>
                        <div className='flex-1 min-w-0'>
                          <p className='text-[10px] font-semibold text-red-600 dark:text-red-400 uppercase tracking-wider'>
                            Workflow Failed
                          </p>
                          {failureOutput.name && (
                            <p className='text-xs font-bold text-foreground truncate'>
                              {failureOutput.name}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => setShowFailurePopover(false)}
                          className='flex-shrink-0 p-1 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-foreground transition-colors'
                          data-track-category='Workflows'
                          data-track-name='CloseFailurePopover'
                        >
                          <X size={14} />
                        </button>
                      </div>

                      {/* Error message */}
                      {failureOutput.message && (
                        <div className='px-4 py-3 border-b border-border/60'>
                          <p className='text-[10px] font-medium text-muted-foreground mb-1 uppercase tracking-wider'>
                            Reason
                          </p>
                          <p className='text-xs text-foreground leading-relaxed'>
                            {failureOutput.message}
                          </p>
                        </div>
                      )}

                      {/* Stack trace */}
                      {failureOutput.stack && (
                        <div className='px-4 py-3'>
                          <div className='flex items-center justify-between mb-2'>
                            <div className='flex items-center gap-1.5'>
                              <Terminal size={12} className='text-muted-foreground' />
                              <p className='text-[10px] font-medium text-muted-foreground uppercase tracking-wider'>
                                Stack Trace
                              </p>
                            </div>
                            <button
                              onClick={handleCopyStack}
                              className='inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-all'
                              data-track-category='Workflows'
                              data-track-name='CopyFailureStackTrace'
                            >
                              {stackCopied ? (
                                <>
                                  <CheckCheck size={11} className='text-emerald-500' />
                                  <span className='text-emerald-500'>Copied!</span>
                                </>
                              ) : (
                                <>
                                  <Copy size={11} />
                                  <span>Copy</span>
                                </>
                              )}
                            </button>
                          </div>
                          <div className='bg-muted/60 rounded-lg p-3 max-h-52 overflow-y-auto scrollbar-thin scrollbar-thumb-border'>
                            <pre className='text-xs text-muted-foreground whitespace-pre-wrap break-all font-mono leading-relaxed'>
                              {failureOutput.stack}
                            </pre>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
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
              )}
            </>
          )}
        </div>
        <div className='flex items-center gap-1 md:gap-2 flex-shrink-0'>
          {onTriggerWorkflow && (
            <button
              onClick={onTriggerWorkflow}
              className='hidden md:inline-flex items-center gap-1 px-2 py-1 rounded-2xl border border-border hover:bg-muted hover:border-border transition-colors text-xs text-foreground'
              title='Rerun Workflow'
              data-track-category='Workflows'
              data-track-name='TriggerWorkflow'
              data-track-metadata={JSON.stringify({ ticketId: ticket.id, workflowType })}
            >
              <Play size={14} className='text-muted-foreground flex-shrink-0' />
              Rerun
            </button>
          )}
          {isRunning && (
            <button
              onClick={handleCancelWorkflow}
              disabled={isCanceling || !executionId}
              className='hidden md:inline-flex items-center gap-1 px-2 py-1 rounded-2xl border border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400 hover:bg-red-500/20 hover:border-red-500/30 transition-colors text-xs disabled:opacity-50 disabled:cursor-not-allowed'
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
              className={`hidden md:inline-flex items-center gap-1 px-2 py-1 rounded-2xl border transition-colors text-xs ${isGraphViewOpen ? 'bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-400 hover:bg-blue-500/20' : 'border-border hover:bg-muted hover:border-border text-foreground'}`}
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
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-2xl border transition-colors text-xs ${
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
              className='p-1.5 rounded-2xl hover:bg-muted transition-colors'
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
                      Rerun Workflow
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
                {isRunning && (
                  <div className='md:hidden'>
                    <MenuItem
                      onClick={() => {
                        handleCancelWorkflow();
                        setShowMenu(false);
                      }}
                      disabled={isCanceling || !executionId}
                      icon={<XCircle size={14} className='text-red-500' />}
                      data-track-category='Workflows'
                      data-track-name='CancelWorkflow'
                    >
                      {isCanceling ? 'Canceling...' : 'Cancel Workflow'}
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
      <div className='px-4 pb-2.5'>
        <h1 className='text-base font-semibold text-foreground leading-tight flex items-center gap-2'>
          {workflowNumber !== undefined && (
            <span className='inline-flex items-center justify-center flex-shrink-0 min-w-[28px] h-6 px-2 bg-blue-500/10 text-blue-700 dark:text-blue-400 text-xs font-bold rounded-full border border-blue-500/20'>
              #{workflowNumber}
            </span>
          )}
          <span className='truncate'>{workflowTitle ?? ticket.title}</span>
        </h1>
        {workflowType && (
          <div className='relative md:hidden mt-1' ref={mobileMetadataRef}>
            <button
              onClick={() => setShowMetadataDropdown(!showMetadataDropdown)}
              className='inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors'
              data-track-category='Workflows'
              data-track-name='ToggleStatusDropdown'
              data-track-metadata={JSON.stringify({ executionStatus, ticketId: ticket.id })}
            >
              <span className='truncate max-w-[200px]'>{workflowType}</span>
              {showMetadataDropdown ? (
                <ChevronUp size={12} className='flex-shrink-0' />
              ) : (
                <ChevronDown size={12} className='flex-shrink-0' />
              )}
            </button>
            {showMetadataDropdown && (
              <div className='absolute left-0 top-full mt-1 w-72 bg-background border border-border rounded-lg shadow-lg py-2 z-[60]'>
                {executorType && (
                  <div className='px-3 py-2 text-sm rounded-md hover:bg-muted transition-all'>
                    <span className='font-medium text-foreground'>Executor: {executorType}</span>
                  </div>
                )}
                {model && (
                  <div className='px-3 py-2 text-sm rounded-md hover:bg-muted transition-all'>
                    <span className='font-medium text-foreground'>Model: {model}</span>
                  </div>
                )}
                {repositoryUrl && (
                  <div className='px-3 py-2 text-sm rounded-md hover:bg-muted transition-all'>
                    <span className='font-medium text-foreground block'>Repository Url:</span>
                    <span className='text-foreground break-all text-xs'>{repositoryUrl}</span>
                  </div>
                )}
                {prLink && (
                  <div className='px-3 py-2 text-sm rounded-md hover:bg-muted transition-all'>
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
                  <div className='px-3 py-2 text-sm rounded-md hover:bg-muted transition-all'>
                    <span className='font-medium text-foreground'>Questioning Enabled</span>
                  </div>
                )}
                {createdByUser?.id && (
                  <div className='px-3 py-2 text-sm rounded-md hover:bg-muted transition-all'>
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
                      No additional metadata
                    </div>
                  )}
              </div>
            )}
          </div>
        )}
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
