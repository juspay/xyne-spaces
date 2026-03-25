import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { useMachine } from '@xstate/react';
import { WorkflowChatPanel } from '../../components/Workflows/WorkflowChatPanel';
import { WorkflowHeader } from '../../components/Workflows/WorkflowHeader';
import { WorkflowTabPanel, useWorkflowTabs } from '../../components/Workflows/WorkflowTabPanel';
import WorkflowTriggerModal from '../../components/Workflow/WorkflowTriggerModal';
import { WorkflowPreviewPanel } from '../../components/Workflows/WorkflowPreviewPanel';
import { isElectronApp } from '../../utils/electronApp';
import { WorkflowGraphOnly } from '../../components/Workflows/WorkflowGraphOnly';
import WorkflowTableView from '../../components/Workflows/WorkflowTableView';
import LivePreviewPanel from '../../components/Workflows/LivePreviewPanel';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { useWorkflowSubscription } from '../../hooks/useWorkflowSubscription';
import { apiInstance } from '../../services/clients/apiClient';
import {
  CombinedWorkflowData,
  StepDetailsResponse,
} from '../../services/Workflow/workflowGraphService.types';
import { Loader2, AlertCircle, ArrowLeft, Globe, Table2, GitBranch, Eye, Code } from 'lucide-react';
import MemoryHeader from '../../components/Memory/MemoryHeader';
import MemoryTable from '../../components/Memory/MemoryTable';
import { MemoryScope, MemoryFilters } from '../../types/memory';
import GitDiffPanel from '../../components/Workflows/GitDiffPanel';
import LiveEditsPanel from '../../components/Workflows/LiveEditsPanel';
import { RCADetailsPanel, type RCAItem } from '../../components/Workflows/RCADetailsPanel';
import { workflowScreenMachine } from '../../machines/workflowScreenMachine';
import { VSCodePanel } from '../../components/Workflows/VSCodePanel';
import { usePlatform } from '../../hooks/usePlatform';

const LAST_WORKFLOW_PATH_KEY = 'last-viewed-workflow-path';

const RERUN_EXCLUDED_KEYS = new Set(['workflowType', 'ticketId', 'conversationId', 'xyneId']);

const WorkflowScreen: React.FC = () => {
  const { ticketId, workflowId } = useParams<{ ticketId: string; workflowId?: string }>();
  const [searchParams] = useSearchParams();
  const workflowNumber = searchParams.get('workflowNumber');

  const [ticketData, ticketQueryDetails] = useCachedQuery(
    queries.ticketById({ ticketId: ticketId ?? '' }),
    { enabled: !!ticketId },
  );
  const ticket = ticketData ?? undefined;
  const ticketsLoading = ticketQueryDetails.type === 'unknown';

  const isElectron = useMemo(() => isElectronApp(), []);
  const { isMobile } = usePlatform();

  // Initialize state machine for persistent state management
  const [state, send] = useMachine(workflowScreenMachine);

  // Initialize machine when ticketId is available
  useEffect(() => {
    if (ticketId) {
      send({ type: 'INIT', ticketId, defaultAgentChatOpen: isMobile });
    }
  }, [ticketId, send, isMobile]);

  // Save the full path (including workflowNumber query param) to sessionStorage whenever
  // the ticket or search params (e.g. workflowNumber) change, so navigating away and
  // back to /tickets restores the exact workflow the user was viewing.
  useEffect(() => {
    if (ticketId) {
      sessionStorage.setItem(
        LAST_WORKFLOW_PATH_KEY,
        window.location.pathname + window.location.search,
      );
    }
  }, [ticketId, searchParams]);

  // State from machine
  const selectedExecutionId = state.context.selectedExecutionId;
  const isGraphViewOpen = state.context.isGraphViewOpen;
  const isAgentChatOpen = state.context.isAgentChatOpen;
  const selectedNodeStepIds = state.context.selectedNodeStepIds;

  const [selectedStep, setSelectedStep] = useState<
    (StepDetailsResponse & { workflowStepIds: string[] }) | null
  >(null);

  // Memory/Context filter state for the Context tab
  const [memoryFilters, setMemoryFilters] = useState<MemoryFilters>({
    searchQuery: '',
    scope: MemoryScope.MY,
    includeQuery: true,
    includeSummary: true,
    docTypeFilter: [],
    tagsFilter: '',
    repoUrlFilter: '',
    commitIdFilter: '',
    sessionIdFilter: '',
    filePointersFilter: '',
    ticketIdFilter: ticketId || '',
  });

  // Fetch combined steps data using React Query
  const {
    data: combinedStepsData,
    isLoading: loading,
    error,
    refetch: refetchCombinedSteps,
  } = useQuery({
    queryKey: ['combined-steps-light', ticket?.id, workflowId, selectedExecutionId],
    queryFn: async (): Promise<CombinedWorkflowData> => {
      if (!ticket?.id) throw new Error('Ticket ID is required');
      const params = new URLSearchParams();
      if (selectedExecutionId) {
        params.append('executionId', selectedExecutionId);
      }
      if (workflowId) {
        params.append('workflowId', workflowId);
      }
      const queryString = params.toString();
      const url = queryString
        ? `/workflows/${ticketId}/combined-steps-light?${queryString}`
        : `/workflows/${ticketId}/combined-steps-light`;
      const response = await apiInstance.get<CombinedWorkflowData>(url);
      return response.data;
    },
    staleTime: 0, // no cache
    enabled: Boolean(ticket?.id), // Only fetch when ticket is available
    placeholderData: keepPreviousData,
  });

  // Extract executionId and executionStatus from combined steps data for workflow control
  const executionId = useMemo(() => {
    return combinedStepsData?.workflows?.[0]?.executionId;
  }, [combinedStepsData]);

  const executionStatus = useMemo(() => {
    return combinedStepsData?.workflows?.[0]?.executionStatus;
  }, [combinedStepsData]);

  const workflowType = useMemo(() => {
    return combinedStepsData?.workflows?.[0]?.workflowType;
  }, [combinedStepsData]);

  const [isWorkflowModalOpen, setIsWorkflowModalOpen] = useState(false);

  const executionMetadata = useMemo(() => {
    return combinedStepsData?.workflows?.[0]?.executionMetadata || [];
  }, [combinedStepsData]);

  // Extract workflow output (for error messages when workflow fails)
  const workflowOutput = useMemo((): { name?: string; message?: string; stack?: string } | null => {
    const output = combinedStepsData?.workflows?.[0]?.output;
    return output ?? null;
  }, [combinedStepsData]);

  // Extract gitInfo from workflow data
  const gitInfo = useMemo(() => {
    return combinedStepsData?.workflows?.[0]?.gitInfo;
  }, [combinedStepsData]);

  // Extract PR link from pullRequests array (preferred) or gitInfo (fallback)
  const prLink = useMemo(() => {
    // First check pullRequests array from the latest execution
    const pullRequests = combinedStepsData?.workflows?.[0]?.pullRequests;
    if (pullRequests && pullRequests.length > 0) {
      // pullRequests are already ordered by updatedAt desc, so first one is latest
      return pullRequests[0]?.prUrl;
    }
    // Fallback to gitInfo.pr_link for backward compatibility
    return combinedStepsData?.workflows?.[0]?.gitInfo?.pr_link;
  }, [combinedStepsData]);

  // Extract executor type, questioning mode, and model from workflow API data
  const executorType = useMemo(() => {
    return combinedStepsData?.workflows?.[0]?.executorType;
  }, [combinedStepsData]);

  const useQuestioningMode = useMemo(() => {
    return combinedStepsData?.workflows?.[0]?.useQuestioningMode;
  }, [combinedStepsData]);

  const model = useMemo(() => {
    return combinedStepsData?.workflows?.[0]?.model;
  }, [combinedStepsData]);

  const createdBy = useMemo(() => {
    return combinedStepsData?.workflows?.[0]?.createdBy ?? undefined;
  }, [combinedStepsData]);

  const workflowTitle = useMemo(() => {
    return combinedStepsData?.workflows?.[0]?.metadata?.originalRequest?.title ?? undefined;
  }, [combinedStepsData]);

  const repositoryUrl = useMemo(() => {
    const url = combinedStepsData?.workflows?.[0]?.metadata?.originalRequest?.['repositoryUrl'];
    return typeof url === 'string' ? url : undefined;
  }, [combinedStepsData]);

  const rerunDefaultFields = useMemo((): Record<string, unknown> => {
    const req = combinedStepsData?.workflows?.[0]?.metadata?.originalRequest;
    if (!req || typeof req !== 'object') return {};
    return Object.fromEntries(
      Object.entries(req).filter(
        ([key, value]) =>
          !RERUN_EXCLUDED_KEYS.has(key) && value !== undefined && value !== null && value !== '',
      ),
    );
  }, [combinedStepsData]);

  // Check if preview tab should be enabled
  const previewInfo = useMemo(() => {
    return gitInfo?.preview;
  }, [gitInfo]);

  const effectiveSelectedExecutionId = useMemo(() => {
    return selectedExecutionId || executionId;
  }, [selectedExecutionId, executionId]);

  const handleRefresh = useCallback((): void => {
    void refetchCombinedSteps();
  }, [refetchCombinedSteps]);

  const handleExecutionSelect = useCallback(
    (newExecutionId: string): void => {
      send({ type: 'SET_SELECTED_EXECUTION_ID', executionId: newExecutionId });
    },
    [send],
  );

  // Subscribe to real-time workflow step updates
  useWorkflowSubscription(effectiveSelectedExecutionId, handleRefresh);

  // Tab management - use machine state for activeTabId
  const {
    tabs,
    activeTabId,
    setActiveTabId: setActiveTabIdInternal,
    addTab,
    closeTab,
  } = useWorkflowTabs(
    [
      // code viewer tab commented out, not useful for now
      // ...(isElectron
      //   ? [
      //       {
      //         id: 'vscode',
      //         title: 'Code Viewer',
      //         type: 'vscode' as const,
      //         icon: <Eye size={15} />,
      //         closable: false,
      //         disabled: false,
      //       },
      //     ]
      //   : []),
      {
        id: 'git-diff',
        title: 'Final Git Diff',
        type: 'git-diff',
        icon: <GitBranch size={15} />,
        closable: false,
        disabled: false,
        disabledTooltip: 'Git diff will be available after workflow completes',
      },
      {
        id: 'live-edits',
        title: 'Live Edits',
        type: 'live-edits',
        icon: <Code size={15} />,
        closable: false,
        disabled: false,
      },
      // context tab commented out, not useful for now
      // {
      //   id: 'context',
      //   title: 'Context',
      //   type: 'context' as const,
      //   icon: <Brain size={15} />,
      //   closable: false,
      //   disabled: false,
      // },
      ...(isElectron
        ? [
            {
              id: 'live-preview',
              title: 'Preview',
              type: 'live-preview' as const,
              icon: <Eye size={14} />,
              closable: false,
              disabled: false,
              disabledTooltip: 'Preview will be available after workflow completes',
            },
          ]
        : []),
    ],
    state.context.activeTabId || 'live-edits',
  ); // Pass persisted activeTabId

  // Wrapper to sync tab changes with state machine
  const setActiveTabId = useCallback(
    (tabId: string) => {
      setActiveTabIdInternal(tabId);
      send({ type: 'SET_ACTIVE_TAB_ID', tabId });
    },
    [setActiveTabIdInternal, send],
  );

  // Type guard for RCA data extraction
  interface StepDataWithRca {
    rca?: unknown[];
    output?: {
      rca?: unknown[];
      data?: {
        rca?: unknown[];
      };
    };
    result?: {
      rca?: unknown[];
    };
  }

  const getRcaDataForSteps = useCallback(
    (stepIds: string[]): RCAItem[] => {
      if (!combinedStepsData || stepIds.length === 0) return [];

      // 1. Find the name of the step we clicked
      let targetStepName: string | null = null;
      for (const workflow of combinedStepsData.workflows) {
        const step = workflow.steps.find(s => stepIds.includes(s.id));
        if (step) {
          targetStepName = step.stepName;
          break;
        }
      }

      if (!targetStepName) {
        return [];
      }

      // 2. Search ALL steps with that name for RCA data
      // We search in reverse order to prefer the latest attempt (often the one with results)
      for (const workflow of combinedStepsData.workflows) {
        const candidates = workflow.steps.filter(s => s.stepName === targetStepName);
        // Reverse to check latest first
        for (let i = candidates.length - 1; i >= 0; i--) {
          const step = candidates[i];
          if (!step) continue;
          let stepData: StepDataWithRca | null = null;

          // Handle stringified JSON
          if (typeof step.data === 'string') {
            try {
              stepData = JSON.parse(step.data) as StepDataWithRca;
            } catch {
              // Ignore parsing errors
            }
          } else if (step.data && typeof step.data === 'object') {
            stepData = step.data as StepDataWithRca;
          }

          if (!stepData) continue;

          if (stepData.rca && Array.isArray(stepData.rca)) return stepData.rca as RCAItem[];
          if (stepData.output?.rca && Array.isArray(stepData.output.rca))
            return stepData.output.rca as RCAItem[];
          if (stepData.output?.data?.rca && Array.isArray(stepData.output.data.rca))
            return stepData.output.data.rca as RCAItem[];

          // Also check if it's inside a 'result' property which sometimes happens
          if (stepData.result?.rca && Array.isArray(stepData.result.rca))
            return stepData.result.rca as RCAItem[];
        }
      }
      return [];
    },
    [combinedStepsData],
  );

  const handleStepSelect = useCallback(
    (_stepId: string | null, workflowStepIds: string[]) => {
      // Update selected node step IDs to filter chat panel
      send({ type: 'SET_SELECTED_NODE_STEP_IDS', stepIds: workflowStepIds });
      setSelectedStep(null); // Reset for now

      // Check for RCA data in the selected step
      const rcaData = getRcaDataForSteps(workflowStepIds);

      if (rcaData.length > 0) {
        // Add RCA tab with idempotent ID to prevent duplicates
        addTab({
          id: 'rca-details', // Fixed ID ensures idempotency
          title: 'RCA Details',
          type: 'rca-details',
          icon: <AlertCircle size={14} className='text-red-500' />,
          closable: true,
        });
      }
    },
    [addTab, getRcaDataForSteps, send],
  );

  const handleClearSelection = useCallback(() => {
    send({ type: 'SET_SELECTED_NODE_STEP_IDS', stepIds: [] });
  }, [send]);

  const handleOpenTableView = useCallback(() => {
    // Check if table view tab already exists
    const existingTableTab = tabs.find(t => t.type === 'table');
    if (existingTableTab) {
      setActiveTabId(existingTableTab.id);
    } else {
      addTab({
        title: 'Table View',
        type: 'table',
        icon: <Table2 size={14} />,
        closable: true,
      });
    }
  }, [tabs, setActiveTabId, addTab]);

  const handleAddTab = useCallback(() => {
    addTab({
      title: 'New Preview',
      type: 'preview',
      icon: <Globe size={14} />,
      closable: true,
    });
  }, [addTab]);

  // Check if tickets are still loading
  const ticketsStillLoading = ticketsLoading;

  // Check if we have a specific ticket not found case (tickets loaded but ticket not found)
  const ticketNotFound = !ticketsStillLoading && !ticket && ticketId;

  // Loading state - show loading if workflow data is still loading or if tickets are still loading
  const isLoading =
    (loading && !combinedStepsData) ||
    (ticketsStillLoading && !ticket) ||
    (!ticket && !ticketNotFound && !ticketId);

  const handleOpenDebugView = useCallback(() => {
    // Check if debug view tab already exists
    const existingDebugTab = tabs.find(t => t.type === 'debug');
    if (existingDebugTab) {
      setActiveTabId(existingDebugTab.id);
    } else {
      addTab({
        title: 'Workflow',
        type: 'debug',
        icon: <GitBranch size={14} />,
        closable: true,
      });
    }
  }, [tabs, setActiveTabId, addTab]);

  // Render tab content based on tab type
  const renderTabContent = useCallback(
    (tabId: string) => {
      const tab = tabs.find(t => t.id === tabId);
      if (!tab) return null;

      switch (tab.type) {
        case 'vscode':
          return effectiveSelectedExecutionId ? (
            <VSCodePanel
              executionId={effectiveSelectedExecutionId}
              {...(gitInfo ? { gitInfo } : {})}
              {...(executionStatus !== undefined && { executionStatus })}
              isActive={activeTabId === 'vscode'}
              workflowOutput={workflowOutput}
            />
          ) : null;
        case 'git-diff':
          return (
            <GitDiffPanel executionId={effectiveSelectedExecutionId} onRefresh={handleRefresh} />
          );
        case 'live-edits':
          return combinedStepsData ? (
            <LiveEditsPanel combinedStepsData={combinedStepsData} />
          ) : null;
        case 'live-preview':
          return previewInfo ? (
            <LivePreviewPanel
              url={previewInfo.url}
              userAgent={previewInfo.userAgent}
              isActive={activeTabId === 'live-preview' && !isGraphViewOpen}
            />
          ) : null;

        case 'workflow':
        case 'debug':
          return combinedStepsData ? (
            <WorkflowGraphOnly
              workflowType={combinedStepsData.workflows?.[0]?.workflowType}
              workflowId={combinedStepsData.workflows?.[0]?.workflowId}
              combinedStepsData={combinedStepsData}
              {...(loading !== undefined && { loading })}
              {...(handleRefresh && { onRefresh: handleRefresh })}
              {...(handleStepSelect && { onNodeSelect: handleStepSelect })}
              onExecutionChange={handleExecutionSelect}
            />
          ) : null;
        case 'table':
          return ticket && combinedStepsData ? (
            <div className='h-full bg-background overflow-auto'>
              <WorkflowTableView
                ticket={ticket}
                combinedStepsData={combinedStepsData}
                loading={loading}
                onRefresh={handleRefresh}
              />
            </div>
          ) : null;
        case 'preview':
          return <WorkflowPreviewPanel />;
        case 'context':
          return (
            <div className='h-full overflow-auto bg-background'>
              <div className='px-6 py-4'>
                <MemoryHeader filters={memoryFilters} onFiltersChange={setMemoryFilters} />
                <MemoryTable
                  filters={memoryFilters}
                  enableCompare={memoryFilters.scope === MemoryScope.MY}
                />
              </div>
            </div>
          );
        case 'rca-details':
          // Derive RCA data from selected node
          // eslint-disable-next-line no-case-declarations
          const rcaData = getRcaDataForSteps(selectedNodeStepIds);
          return <RCADetailsPanel data={rcaData} />;
        default:
          return <WorkflowPreviewPanel />;
      }
    },
    [
      tabs,
      combinedStepsData,
      ticket,
      loading,
      handleRefresh,
      handleStepSelect,
      effectiveSelectedExecutionId,
      previewInfo,
      gitInfo,
      executionStatus,
      workflowOutput,
      getRcaDataForSteps,
      selectedNodeStepIds,
      activeTabId,
      isGraphViewOpen,
      handleExecutionSelect,
      memoryFilters,
    ],
  );

  // Loading state UI
  if (isLoading) {
    return (
      <div className='h-screen bg-background flex flex-col'>
        {ticket && (
          <WorkflowHeader
            ticket={ticket}
            {...(executionId !== undefined && { executionId })}
            {...(executionStatus !== undefined && { executionStatus })}
            executionMetadata={executionMetadata}
            {...(effectiveSelectedExecutionId && {
              selectedExecutionId: effectiveSelectedExecutionId,
            })}
            onExecutionSelect={handleExecutionSelect}
            gitBranch={gitInfo?.branch}
            workflowType={workflowType}
            onTriggerWorkflow={() => setIsWorkflowModalOpen(true)}
          />
        )}
        <div className='flex-1 flex items-center justify-center'>
          <div className='text-center'>
            <Loader2 className='w-8 h-8 text-blue-500 animate-spin mx-auto mb-4' />
            <p className='text-muted-foreground text-sm'>Loading workflow data...</p>
          </div>
        </div>
      </div>
    );
  }

  // Ticket not found state
  if (ticketNotFound) {
    return (
      <div className='h-screen bg-background flex flex-col'>
        <div className='h-14 border-b border-border flex items-center px-4'>
          <button
            onClick={() => window.history.back()}
            className='flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors'
            data-track-category='Workflow'
            data-track-name='BackFromTicketNotFound'
          >
            <ArrowLeft size={18} />
            <span className='text-sm'>Back</span>
          </button>
        </div>
        <div className='flex-1 flex items-center justify-center'>
          <div className='text-center max-w-md px-4'>
            <AlertCircle className='w-12 h-12 text-orange-500 mx-auto mb-4' />
            <h3 className='text-lg font-semibold text-foreground mb-2'>Ticket Not Found</h3>
            <p className='text-muted-foreground text-sm mb-6'>
              The ticket with ID{' '}
              <code className='bg-muted px-1.5 py-0.5 rounded text-xs'>{ticketId}</code> could not
              be found.
            </p>
            <button
              onClick={() => window.history.back()}
              className='px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 transition-colors'
              data-track-category='Workflow'
              data-track-name='GoBackButton'
            >
              Go Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  const hasError = error;

  if (hasError) {
    const errorMessage = error?.message || 'Failed to load workflow data';

    return (
      <div className='h-screen bg-background flex flex-col'>
        {ticket && (
          <WorkflowHeader
            ticket={ticket}
            {...(executionId !== undefined && { executionId })}
            {...(executionStatus !== undefined && { executionStatus })}
            executionMetadata={executionMetadata}
            {...(effectiveSelectedExecutionId && {
              selectedExecutionId: effectiveSelectedExecutionId,
            })}
            onExecutionSelect={handleExecutionSelect}
            gitBranch={gitInfo?.branch}
            workflowType={workflowType}
            onTriggerWorkflow={() => setIsWorkflowModalOpen(true)}
            createdBy={createdBy}
          />
        )}
        <div className='flex-1 flex items-center justify-center'>
          <div className='text-center max-w-md px-4'>
            <AlertCircle className='w-12 h-12 text-red-500 mx-auto mb-4' />
            <h3 className='text-lg font-semibold text-foreground mb-2'>Failed to load workflow</h3>
            <p className='text-muted-foreground text-sm mb-6'>{errorMessage}</p>
            <button
              onClick={handleRefresh}
              className='px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 transition-colors'
              data-track-category='Workflow'
              data-track-name='TryAgain'
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Safety check
  if (!ticket) {
    return (
      <div className='h-screen bg-background flex items-center justify-center'>
        <div className='text-center'>
          <AlertCircle className='w-12 h-12 text-muted-foreground mx-auto mb-4' />
          <h3 className='text-lg font-medium text-foreground mb-2'>Unexpected Error</h3>
          <p className='text-muted-foreground text-sm mb-4'>Please refresh the page.</p>
          <button
            onClick={() => window.location.reload()}
            className='px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 transition-colors'
            data-track-category='Workflow'
            data-track-name='Refresh'
          >
            Refresh
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className='h-full bg-background flex flex-col overflow-hidden rounded-lg shadow-md relative'
      data-component='WorkflowScreen'
    >
      {/* Minimal Header */}
      <WorkflowHeader
        ticket={ticket}
        {...(executionId !== undefined && { executionId })}
        {...(executionStatus !== undefined && { executionStatus })}
        executionMetadata={executionMetadata}
        {...(effectiveSelectedExecutionId && {
          selectedExecutionId: effectiveSelectedExecutionId,
        })}
        onExecutionSelect={handleExecutionSelect}
        onOpenTableView={handleOpenTableView}
        onOpenDebugView={handleOpenDebugView}
        isGraphViewOpen={isGraphViewOpen}
        onGraphViewToggle={() => send({ type: 'SET_GRAPH_VIEW_OPEN', isOpen: !isGraphViewOpen })}
        isAgentChatOpen={isAgentChatOpen}
        onAgentChatToggle={() => send({ type: 'SET_AGENT_CHAT_OPEN', isOpen: !isAgentChatOpen })}
        gitBranch={gitInfo?.branch}
        workflowType={workflowType}
        onTriggerWorkflow={() => setIsWorkflowModalOpen(true)}
        executorType={executorType}
        useQuestioningMode={useQuestioningMode}
        model={model}
        prLink={prLink}
        createdBy={createdBy}
        {...(workflowNumber && { workflowNumber: parseInt(workflowNumber, 10) })}
        {...(workflowTitle && { workflowTitle })}
        {...(repositoryUrl && { repositoryUrl })}
      />

      {ticket && (
        <WorkflowTriggerModal
          isOpen={isWorkflowModalOpen}
          onClose={() => setIsWorkflowModalOpen(false)}
          ticketId={ticket.id}
          redirectOnSuccess={true}
          isRerun={true}
          {...(workflowType && { defaultWorkflowType: workflowType })}
          defaultCustomFields={rerunDefaultFields}
        />
      )}

      {/* Main Content - Split Panel */}
      <div className='flex-1 overflow-hidden'>
        <PanelGroup direction='horizontal' autoSaveId='workflow-screen'>
          {/* Left Panel - Chat */}
          <Panel defaultSize={30} minSize={22} maxSize={45}>
            <WorkflowChatPanel
              combinedStepsData={combinedStepsData || null}
              selectedStep={selectedStep}
              onStepSelect={handleStepSelect}
              {...(effectiveSelectedExecutionId && { executionId: effectiveSelectedExecutionId })}
              ticketTitle={ticket.title}
              {...(ticket.description ? { ticketDescription: ticket.description } : {})}
              onRefresh={handleRefresh}
              isLoading={loading}
              {...(selectedNodeStepIds.length > 0 && { selectedNodeStepIds })}
              onClearSelection={handleClearSelection}
              onExecutionChange={handleExecutionSelect}
              isGraphViewOpen={isGraphViewOpen}
              onGraphViewChange={isOpen => send({ type: 'SET_GRAPH_VIEW_OPEN', isOpen })}
              isAgentChatOpen={isAgentChatOpen}
              onAgentChatChange={isOpen => send({ type: 'SET_AGENT_CHAT_OPEN', isOpen })}
              scrollPosition={state.context.scrollPosition}
              onScrollPositionChange={position => send({ type: 'SET_SCROLL_POSITION', position })}
              conversationId={ticket.conversationId}
              channelId={ticket.channelId}
            />
          </Panel>

          {/* Resize Handle */}
          <PanelResizeHandle className='w-px bg-border hover:bg-blue-400 transition-colors cursor-col-resize' />

          {/* Right Panel - Tabs */}
          <Panel defaultSize={70} minSize={45}>
            <WorkflowTabPanel
              tabs={tabs.map(tab => ({
                ...tab,
                content: renderTabContent(tab.id),
              }))}
              activeTabId={activeTabId}
              onTabChange={setActiveTabId}
              onTabClose={closeTab}
              onTabAdd={handleAddTab}
            />
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
};

export default WorkflowScreen;
