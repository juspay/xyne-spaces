import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { useParams } from 'react-router-dom';
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
import { useTickets } from '../../hooks/useTickets';
import { useWorkflowSubscription } from '../../hooks/useWorkflowSubscription';
import { apiInstance } from '../../services/clients/apiClient';
import {
  CombinedWorkflowData,
  StepDetailsResponse,
} from '../../services/Workflow/workflowGraphService.types';
import { Loader2, AlertCircle, ArrowLeft, Globe, Table2, GitBranch, Eye, Code } from 'lucide-react';
import GitDiffPanel from '../../components/Workflows/GitDiffPanel';
import LiveEditsPanel from '../../components/Workflows/LiveEditsPanel';
import { RCADetailsPanel, type RCAItem } from '../../components/Workflows/RCADetailsPanel';
import { workflowScreenMachine } from '../../machines/workflowScreenMachine';

const LAST_WORKFLOW_PATH_KEY = 'last-viewed-workflow-path';

const WorkflowScreen: React.FC = () => {
  const { ticketId, workflowId } = useParams<{ ticketId: string; workflowId?: string }>();
  const { tickets, isLoading: ticketsLoading } = useTickets();
  const ticket = useMemo(() => tickets.find(t => t.id === ticketId), [tickets, ticketId]);

  const isElectron = useMemo(() => isElectronApp(), []);

  // Initialize state machine for persistent state management
  const [state, send] = useMachine(workflowScreenMachine);

  // Initialize machine when ticketId is available and save current path
  useEffect(() => {
    if (ticketId) {
      send({ type: 'INIT', ticketId });
      // Save the full path to restore later
      sessionStorage.setItem(LAST_WORKFLOW_PATH_KEY, window.location.pathname);
    }
  }, [ticketId, send]);

  // State from machine
  const selectedExecutionId = state.context.selectedExecutionId;
  const isGraphViewOpen = state.context.isGraphViewOpen;
  const selectedNodeStepIds = state.context.selectedNodeStepIds;

  const [selectedStep, setSelectedStep] = useState<
    (StepDetailsResponse & { workflowStepIds: string[] }) | null
  >(null);

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
      {
        id: 'git-diff',
        title: 'Final Git Diff',
        type: 'git-diff',
        icon: <GitBranch size={14} />,
        closable: false,
        disabled: false,
        disabledTooltip: 'Git diff will be available after workflow completes',
      },
      {
        id: 'live-edits',
        title: 'Live Edits',
        type: 'live-edits',
        icon: <Code size={14} />,
        closable: false,
        disabled: false,
      },
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
            <div className='h-full bg-white overflow-auto'>
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
    ],
  );

  // Loading state UI
  if (isLoading) {
    return (
      <div className='h-screen bg-white flex flex-col'>
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
            <p className='text-gray-600 text-sm'>Loading workflow data...</p>
          </div>
        </div>
      </div>
    );
  }

  // Ticket not found state
  if (ticketNotFound) {
    return (
      <div className='h-screen bg-white flex flex-col'>
        <div className='h-14 border-b border-gray-200 flex items-center px-4'>
          <button
            onClick={() => window.history.back()}
            className='flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors'
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
            <h3 className='text-lg font-semibold text-gray-900 mb-2'>Ticket Not Found</h3>
            <p className='text-gray-600 text-sm mb-6'>
              The ticket with ID{' '}
              <code className='bg-gray-100 px-1.5 py-0.5 rounded text-xs'>{ticketId}</code> could
              not be found.
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
      <div className='h-screen bg-white flex flex-col'>
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
          <div className='text-center max-w-md px-4'>
            <AlertCircle className='w-12 h-12 text-red-500 mx-auto mb-4' />
            <h3 className='text-lg font-semibold text-gray-900 mb-2'>Failed to load workflow</h3>
            <p className='text-gray-600 text-sm mb-6'>{errorMessage}</p>
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
      <div className='h-screen bg-white flex items-center justify-center'>
        <div className='text-center'>
          <AlertCircle className='w-12 h-12 text-gray-400 mx-auto mb-4' />
          <h3 className='text-lg font-medium text-gray-900 mb-2'>Unexpected Error</h3>
          <p className='text-gray-600 text-sm mb-4'>Please refresh the page.</p>
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
      className='h-full bg-white flex flex-col overflow-hidden rounded-lg shadow-[0_0_8px_0_rgba(0,0,0,0.15)] relative'
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
        gitBranch={gitInfo?.branch}
        workflowType={workflowType}
        onTriggerWorkflow={() => setIsWorkflowModalOpen(true)}
      />

      {ticket && (
        <WorkflowTriggerModal
          isOpen={isWorkflowModalOpen}
          onClose={() => setIsWorkflowModalOpen(false)}
          ticketId={ticket.id}
          redirectOnSuccess={true}
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
              {...(executionId !== undefined && { executionId })}
              ticketTitle={ticket.title}
              {...(ticket.description ? { ticketDescription: ticket.description } : {})}
              onRefresh={handleRefresh}
              isLoading={loading}
              {...(selectedNodeStepIds.length > 0 && { selectedNodeStepIds })}
              onClearSelection={handleClearSelection}
              onExecutionChange={handleExecutionSelect}
              isGraphViewOpen={isGraphViewOpen}
              onGraphViewChange={isOpen => send({ type: 'SET_GRAPH_VIEW_OPEN', isOpen })}
              scrollPosition={state.context.scrollPosition}
              onScrollPositionChange={position => send({ type: 'SET_SCROLL_POSITION', position })}
              conversationId={ticket.conversationId}
              channelId={ticket.channelId}
            />
          </Panel>

          {/* Resize Handle */}
          <PanelResizeHandle className='w-px bg-gray-200 hover:bg-blue-400 transition-colors cursor-col-resize' />

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
