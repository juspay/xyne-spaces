/**
 * WorkflowChatPanel - Chat-style panel for viewing workflow steps.
 * Reuses AgentStepRenderer for step display.
 */
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import DOMPurify from 'dompurify';
import {
  Send,
  Loader2,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Bot,
  Sparkles,
  X,
  Zap,
  Check,
  Circle,
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Clock,
  Route,
  History,
  Search,
  MoreVertical,
} from 'lucide-react';
import { format } from 'date-fns';
import { AgentStepRenderer } from '../AgentStepRenderer/StepRenderer';
import {
  CombinedWorkflowData,
  StepDetailsResponse,
  WorkflowStep,
} from '../../../services/Workflow/workflowGraphService.types';
import { useWorkflowControl } from '../../../services/Workflow/workflowGraphService';
import { toast } from 'sonner';
import { WorkflowGraphOnly } from '../WorkflowGraphOnly';
import { createPortal } from 'react-dom';
import { ThreadSummary } from '../../Chat/Summary';
import { MessageSquare } from 'lucide-react';
import { ErrorsPanel } from './ErrorsPanel';

interface WorkflowChatPanelProps {
  combinedStepsData: CombinedWorkflowData | null;
  selectedStep: (StepDetailsResponse & { workflowStepIds: string[] }) | null;
  onStepSelect?: (stepId: string | null, workflowStepIds: string[]) => void;
  executionId?: string;
  ticketTitle?: string;
  ticketDescription?: string;
  onRefresh?: () => void;
  isLoading?: boolean;
  selectedNodeStepIds?: string[];
  onClearSelection?: () => void;
  onExecutionChange?: (executionId: string) => void;
  isGraphViewOpen?: boolean;
  onGraphViewChange?: (isOpen: boolean) => void;
  // Props for Thread tab
  conversationId?: string;
  channelId?: string;
  scrollPosition?: number;
  onScrollPositionChange?: (position: number) => void;
}

type TabId = 'automation' | 'audit' | 'context' | 'workflow';
type MainTabId = 'flow' | 'thread' | 'history' | 'errors';

// Reusable collapsible section
// const CollapsibleSection: React.FC<{
//   title: string;
//   icon?: React.ReactNode;
//   defaultExpanded?: boolean;
//   children: React.ReactNode;
//   badge?: string;
// }> = ({ title, icon, defaultExpanded = false, children, badge }) => {
//   const [isExpanded, setIsExpanded] = useState(defaultExpanded);
//   return (
//     <div className='border border-gray-100 rounded-lg overflow-hidden bg-white mb-2 shadow-sm'>
//       <button
//         onClick={() => setIsExpanded(!isExpanded)}
//         className='w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-gray-50/50 transition-colors'
//       >
//         <span className='text-gray-400'>
//           {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
//         </span>
//         {icon && <span className='text-gray-400'>{icon}</span>}
//         <span className='text-sm font-medium text-gray-700 flex-1'>{title}</span>
//         {badge && (
//           <span className='px-1.5 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-500'>
//             {badge}
//           </span>
//         )}
//       </button>
//       {isExpanded && (
//         <div className='px-3 pb-3 border-t border-gray-50 overflow-hidden'>
//           <div
//             className='pt-2.5 overflow-hidden min-w-0 max-w-full'
//             style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
//           >
//             {children}
//           </div>
//         </div>
//       )}
//     </div>
//   );
// };

// Step item using AgentStepRenderer
const StepItem: React.FC<{
  step: WorkflowStep;
  defaultExpanded?: boolean;
  forceExpanded?: boolean;
}> = ({ step, defaultExpanded = false, forceExpanded = false }) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  useEffect(() => {
    if (forceExpanded) {
      setIsExpanded(true);
    }
  }, [forceExpanded]);
  const stepType = step.stepName?.startsWith('llm_call')
    ? 'llm'
    : step.stepName?.startsWith('tool_')
      ? 'tool'
      : 'step';
  const getStepLabel = (): string => {
    if (step.stepName?.startsWith('llm_call'))
      return step.stepName.replace('llm_call_', 'LLM ').substring(0, 30);
    if (step.stepName?.startsWith('tool_'))
      return step.stepName.replace('tool_', '').replace(/_/g, ' ');
    return step.stepName || 'Step';
  };
  const statusBadge =
    step.status === 'completed'
      ? { bg: 'bg-emerald-50 text-emerald-700', text: 'completed' }
      : step.status === 'failed'
        ? { bg: 'bg-red-50 text-red-700', text: 'failed' }
        : step.status === 'running'
          ? { bg: 'bg-blue-50 text-blue-700', text: 'running' }
          : { bg: 'bg-gray-50 text-gray-600', text: step.status || 'pending' };

  return (
    <div className='py-2'>
      <AgentStepRenderer step={step} defaultOpen={forceExpanded || defaultExpanded} />
    </div>
  );

  return (
    <div className='border border-gray-100 rounded-lg overflow-hidden bg-white mb-1.5 hover:border-gray-200 transition-colors min-w-0 max-w-full'>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className='w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-gray-50/50 transition-colors min-w-0'
        data-track-category='Workflows'
        data-track-name='ToggleStepExpand'
        data-track-metadata={JSON.stringify({ stepId: step.id })}
      >
        <span className='text-gray-400'>
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <span
          className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${stepType === 'llm' ? 'bg-violet-100' : stepType === 'tool' ? 'bg-blue-100' : 'bg-gray-100'}`}
        >
          {stepType === 'llm' ? (
            <Sparkles size={10} className='text-violet-600' />
          ) : stepType === 'tool' ? (
            <Zap size={10} className='text-blue-600' />
          ) : step.status === 'completed' ? (
            <Check size={12} className='text-emerald-600' />
          ) : step.status === 'failed' ? (
            <AlertCircle size={12} className='text-red-500' />
          ) : step.status === 'running' ? (
            <Loader2 size={12} className='text-blue-500 animate-spin' />
          ) : (
            <Circle size={12} className='text-gray-300' />
          )}
        </span>
        <span className='text-sm font-medium text-gray-700 flex-1 truncate capitalize'>
          {getStepLabel()}
        </span>
        <span className={`px-1.5 py-0.5 text-xs rounded ${statusBadge.bg}`}>
          {statusBadge.text}
        </span>
      </button>
      {isExpanded && (
        <div className='px-3 pb-2.5 border-t border-gray-50 overflow-hidden'>
          <div
            className='pt-2 overflow-hidden min-w-0 max-w-full'
            style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
          >
            <AgentStepRenderer step={step} defaultOpen={true} />
          </div>
        </div>
      )}
    </div>
  );
};

interface UserMessage {
  id: string;
  text: string;
  timestamp: Date;
}

// Graph node info for navigation - groups INPUT/OUTPUT steps by stepName
interface GraphNodeInfo {
  index: number;
  stepName: string;
  stepIds: string[]; // All step IDs for this node (INPUT + OUTPUT)
  status: string; // Computed status: running > pending > completed > failed
  hasExpandedExecutions: boolean;
}

export const WorkflowChatPanel: React.FC<WorkflowChatPanelProps> = ({
  combinedStepsData,
  executionId,
  ticketTitle,
  ticketDescription,
  selectedStep: _selectedStep,
  onStepSelect,
  isLoading: _isLoading = false,
  selectedNodeStepIds,
  onClearSelection,
  onExecutionChange,
  isGraphViewOpen: externalIsGraphViewOpen,
  onGraphViewChange,
  // Thread tab props
  conversationId,
  channelId,
  scrollPosition: initialScrollPosition,
  onScrollPositionChange,
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [continuationMessage, setContinuationMessage] = useState('');
  const [activeTab, setActiveTab] = useState<TabId>('automation');
  const [mainTab, setMainTab] = useState<MainTabId>('flow');
  const [showThreadSummary, setShowThreadSummary] = useState(false);
  const [userMessages, setUserMessages] = useState<UserMessage[]>([]);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [internalIsGraphViewOpen, setInternalIsGraphViewOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Use external control if provided, otherwise use internal state
  const isGraphViewOpen = externalIsGraphViewOpen ?? internalIsGraphViewOpen;
  const setIsGraphViewOpen = onGraphViewChange ?? setInternalIsGraphViewOpen;

  const [graphPosition, setGraphPosition] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  }>({
    top: 0,
    left: 0,
    width: 0,
    height: 0,
  });
  const headerRef = useRef<HTMLDivElement>(null);
  const { continueAgenticStepAsync, isContinuing, resetContinue } = useWorkflowControl();

  useEffect(() => {
    const updateGraphPosition = (): void => {
      if (isGraphViewOpen && headerRef.current) {
        const headerRect = headerRef.current.getBoundingClientRect();
        const screenElement = document.querySelector("[data-component='WorkflowScreen']");

        if (screenElement) {
          const screenRect = screenElement.getBoundingClientRect();
          setGraphPosition({
            top: headerRect.bottom,
            left: headerRect.left,
            width: screenRect.right - headerRect.left,
            height: screenRect.bottom - headerRect.bottom,
          });
        } else {
          setGraphPosition({
            top: headerRect.bottom,
            left: headerRect.left,
            width: window.innerWidth - headerRect.left,
            height: window.innerHeight - headerRect.bottom,
          });
        }
      }
    };

    updateGraphPosition();
    window.addEventListener('resize', updateGraphPosition);
    return () => window.removeEventListener('resize', updateGraphPosition);
  }, [isGraphViewOpen]);

  // Graph node navigation state
  const [currentNodeIndex, setCurrentNodeIndex] = useState<number>(0);
  const hasInitializedRef = useRef<boolean>(false);

  // Track current execution ID to detect when it changes
  const currentExecutionId = combinedStepsData?.workflows?.[0]?.executionId;
  const prevExecutionIdRef = useRef<string | undefined>(undefined);

  // Reset navigation state when execution changes (e.g., after rerun)
  useEffect(() => {
    if (currentExecutionId && prevExecutionIdRef.current !== currentExecutionId) {
      // Execution changed - reset state to show new execution
      if (prevExecutionIdRef.current !== undefined) {
        // Only reset if this isn't the initial load
        hasInitializedRef.current = false;
        setCurrentNodeIndex(0);
      }
      prevExecutionIdRef.current = currentExecutionId;
    }
  }, [currentExecutionId]);

  // Build ordered list of graph nodes grouped by stepName (INPUT/OUTPUT pairs become one node)
  const graphNodes = useMemo((): GraphNodeInfo[] => {
    if (!combinedStepsData?.workflows?.length) return [];

    // Get root workflow steps (not child executions)
    const rootWorkflow = combinedStepsData.workflows.find(w => !w.parentWorkflowExecutionId);
    const targetWorkflow = rootWorkflow || combinedStepsData.workflows[0];

    if (!targetWorkflow?.steps) return [];

    // Group steps by stepName (INPUT + OUTPUT pairs become one node)
    const stepsByName = new Map<
      string,
      { stepIds: string[]; statuses: string[]; hasExpanded: boolean }
    >();
    const orderedNames: string[] = [];

    targetWorkflow.steps.forEach(step => {
      const name = step.stepName || 'Unknown Step';
      if (!stepsByName.has(name)) {
        stepsByName.set(name, { stepIds: [], statuses: [], hasExpanded: false });
        orderedNames.push(name);
      }
      const group = stepsByName.get(name)!;
      group.stepIds.push(step.id);
      group.statuses.push(step.computedStatus || step.status || 'pending');
      if ((step.expandedExecutions?.length || 0) > 0) {
        group.hasExpanded = true;
      }
    });

    // Compute aggregate status: running > pending > completed > failed
    const computeStatus = (statuses: string[]): string => {
      if (statuses.includes('running')) return 'running';
      if (statuses.includes('pending')) return 'pending';
      if (statuses.every(s => s === 'completed')) return 'completed';
      if (statuses.includes('failed')) return 'failed';
      return 'pending';
    };

    return orderedNames.map((name, index) => {
      const group = stepsByName.get(name)!;
      return {
        index,
        stepName: name,
        stepIds: group.stepIds,
        status: computeStatus(group.statuses),
        hasExpandedExecutions: group.hasExpanded,
      };
    });
  }, [combinedStepsData]);

  // Find currently running node index
  const runningNodeIndex = useMemo(() => {
    return graphNodes.findIndex(n => n.status === 'running');
  }, [graphNodes]);

  // Initialize to last node on first mount
  useEffect(() => {
    if (!hasInitializedRef.current && graphNodes.length > 0) {
      // Priority: running node → last completed/failed → last node
      let initialIndex = 0;

      if (runningNodeIndex !== -1) {
        initialIndex = runningNodeIndex;
      } else {
        const lastDoneIdx = [...graphNodes]
          .reverse()
          .findIndex(node => node.status === 'completed' || node.status === 'failed');

        if (lastDoneIdx !== -1) {
          initialIndex = graphNodes.length - 1 - lastDoneIdx;
        } else {
          initialIndex = graphNodes.length - 1;
        }
      }

      setCurrentNodeIndex(initialIndex);
      hasInitializedRef.current = true;
    }
  }, [graphNodes, runningNodeIndex]);

  // Ref to track previous selectedNodeStepIds to avoid re-syncing on every render/navigation
  const prevSelectedNodeStepIdsRef = useRef<string[]>([]);

  // Sync with external graph selection (when user clicks node in WorkflowGraph)
  useEffect(() => {
    if (selectedNodeStepIds && selectedNodeStepIds.length > 0) {
      // Check if selection actually changed
      const prevIds = prevSelectedNodeStepIdsRef.current;
      const isSameSelection =
        prevIds.length === selectedNodeStepIds.length &&
        prevIds.every((id, i) => id === selectedNodeStepIds[i]);

      if (isSameSelection) return;

      // Update ref
      prevSelectedNodeStepIdsRef.current = selectedNodeStepIds;

      const selectedSet = new Set(selectedNodeStepIds);
      const matchingIndex = graphNodes.findIndex(n => n.stepIds.some(id => selectedSet.has(id)));
      if (matchingIndex !== -1 && matchingIndex !== currentNodeIndex) {
        setCurrentNodeIndex(matchingIndex);
      }
    }
  }, [selectedNodeStepIds, graphNodes, currentNodeIndex]);

  const handleGraphNodeClick = useCallback(
    (stepId: string | null, workflowStepIds: string[]) => {
      setIsGraphViewOpen(false);
      if (onStepSelect) {
        onStepSelect(stepId, workflowStepIds);
      }
    },
    [onStepSelect, setIsGraphViewOpen],
  );

  // Navigation handlers
  const handlePrevNode = useCallback(() => {
    setIsUserScrolledUp(false); // Reset scroll state when navigating
    setCurrentNodeIndex(prev => Math.max(0, prev - 1));
  }, []);

  const handleNextNode = useCallback(() => {
    setIsUserScrolledUp(false); // Reset scroll state when navigating
    setCurrentNodeIndex(prev => Math.min(graphNodes.length - 1, prev + 1));
  }, [graphNodes.length]);

  const handleJumpToRunning = useCallback(() => {
    if (runningNodeIndex !== -1) {
      setCurrentNodeIndex(runningNodeIndex);
      setIsUserScrolledUp(false); // Reset scroll state when jumping to running
    }
  }, [runningNodeIndex]);

  // Current graph node info
  const currentNode = graphNodes[currentNodeIndex] || null;

  // Check if user is near bottom of scroll container
  const checkIfNearBottom = useCallback((): boolean => {
    const container = scrollContainerRef.current;
    if (!container) return true;
    const threshold = 100; // pixels from bottom
    return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
  }, []);

  // Handle scroll events to detect user scrolling up
  const handleScroll = useCallback(() => {
    const nearBottom = checkIfNearBottom();
    setIsUserScrolledUp(!nearBottom);

    if (onScrollPositionChange && scrollContainerRef.current) {
      onScrollPositionChange(scrollContainerRef.current.scrollTop);
    }
  }, [checkIfNearBottom, onScrollPositionChange]);

  const hasRestoredScrollRef = useRef(false);

  useEffect(() => {
    if (
      initialScrollPosition !== undefined &&
      initialScrollPosition > 0 &&
      scrollContainerRef.current &&
      !hasRestoredScrollRef.current
    ) {
      const timeoutId = setTimeout((): void => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = initialScrollPosition;
          hasRestoredScrollRef.current = true;
        }
      }, 100);
      return () => clearTimeout(timeoutId);
    }
    return undefined;
  }, [initialScrollPosition]);

  useEffect(() => {
    if (!isUserScrolledUp && hasRestoredScrollRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [combinedStepsData, userMessages, isUserScrolledUp, currentNodeIndex]);

  const filteredSteps = useMemo((): WorkflowStep[] => {
    if (!combinedStepsData?.workflows?.length) return [];

    const allSteps: WorkflowStep[] = [];

    // If we have graph nodes, filter by current node's stepIds
    if (graphNodes.length > 0 && currentNode) {
      const currentStepIds = new Set(currentNode.stepIds);

      // Find all steps matching this node and get their expanded executions
      combinedStepsData.workflows.forEach(workflow => {
        workflow.steps.forEach(step => {
          if (currentStepIds.has(step.id)) {
            const executions = step.expandedExecutions || [];
            if (executions.length > 0) {
              // Show child steps from expanded executions
              executions.forEach(exec => exec.steps.forEach(s => allSteps.push(s)));
            } else {
              // Show the parent step itself if no child steps
              allSteps.push(step);
            }
          }
        });
      });

      return allSteps;
    }

    // Fallback: use selectedNodeStepIds if provided (legacy behavior)
    const parentStepIdSet = new Set(selectedNodeStepIds || []);
    combinedStepsData.workflows.forEach(workflow => {
      workflow.steps.forEach(step => {
        const isSelectedParent = parentStepIdSet.size === 0 || parentStepIdSet.has(step.id);
        const executions = step.expandedExecutions || [];
        if (executions.length > 0 && isSelectedParent) {
          executions.forEach(exec => exec.steps.forEach(s => allSteps.push(s)));
        } else if (isSelectedParent) {
          allSteps.push(step);
        }
      });
    });
    return allSteps;
  }, [combinedStepsData, graphNodes, currentNode, selectedNodeStepIds]);

  const errorSteps = useMemo(() => {
    if (!combinedStepsData?.workflows?.length) return [];
    
    // Recursive extraction of errors
    const errors: { step: WorkflowStep; message: string }[] = [];
    const processedIds = new Set<string>();

    const processStep = (step: WorkflowStep) => {
      if (!step || processedIds.has(step.id)) return;
      processedIds.add(step.id);

      if (step.status === 'failed') {
        let extractedError = 'Step failed without explicit error message';

        try {
          // Sometimes step.data is a stringified JSON
          const dataObj = typeof step.data === 'string' ? JSON.parse(step.data) : step.data;

          if (dataObj?.error?.message) {
            extractedError = dataObj.error.message;
          } else if (dataObj?.output?.error) {
            extractedError = dataObj.output.error;
          } else if (typeof dataObj?.output === 'string') {
            extractedError = dataObj.output;
          } else if (dataObj?.output?.message) {
            extractedError = dataObj.output.message;
          }
        } catch (e) {
          // If parsing fails, just leave the fallback message
          console.warn('Failed to parse step error data:', e);
        }

        errors.push({ step, message: String(extractedError) });
      }

      if (step.expandedExecutions?.length) {
        step.expandedExecutions.forEach(exec => {
          exec.steps.forEach(s => processStep(s));
        });
      }
      
      if (step.expandedWorkflows?.length) {
        step.expandedWorkflows.forEach(exec => {
          exec.steps.forEach(s => processStep(s));
        });
      }
      
      if (step.expandedSteps?.length) {
        step.expandedSteps.forEach(s => processStep(s));
      }
    };

    combinedStepsData.workflows.forEach(w => w.steps.forEach(s => processStep(s)));
    return errors;
  }, [combinedStepsData]);

  const searchedSteps = useMemo((): WorkflowStep[] => {
    if (!searchQuery.trim()) return filteredSteps;
    const lowerQuery = searchQuery.toLowerCase();
    return filteredSteps.filter(step => {
      try {
        const stepString = JSON.stringify(step).toLowerCase();
        return stepString.includes(lowerQuery);
      } catch (e) {
        return false;
      }
    });
  }, [filteredSteps, searchQuery]);

  const handleSendMessage = async (): Promise<void> => {
    if (!continuationMessage.trim() || !executionId) {
      toast.error('Cannot send', {
        description: 'Please provide a message',
        duration: 3000,
      });
      return;
    }

    // Use continue API for completed/failed steps
    // Find agent INPUT steps from the parent workflow steps (not expanded child steps)
    // We need to look in the original combinedStepsData workflows
    let lastAgentInputStep: WorkflowStep | null = null;

    if (combinedStepsData?.workflows?.length) {
      for (const workflow of combinedStepsData.workflows) {
        for (const step of workflow.steps) {
          // Look for agent steps that are INPUT type
          if (step.stepExecutorType?.toLowerCase() === 'agent' && step.type === 'input') {
            lastAgentInputStep = step;
          }
        }
      }
    }

    if (!lastAgentInputStep) {
      toast.error('Cannot send', {
        description: 'No agent checkpoint found to continue',
        duration: 3000,
      });
      return;
    }

    // Add user message to display in chat
    const userMessage: UserMessage = {
      id: `user-msg-${Date.now()}`,
      text: continuationMessage.trim(),
      timestamp: new Date(),
    };
    setUserMessages(prev => [...prev, userMessage]);

    resetContinue();
    const targetExecutionId = lastAgentInputStep.workflowExecutionId || executionId;
    if (!targetExecutionId) {
      toast.error('Error', { description: 'No execution ID available', duration: 3000 });
      return;
    }

    try {
      const result = await continueAgenticStepAsync({
        executionId: targetExecutionId,
        stepId: lastAgentInputStep.id,
        message: continuationMessage.trim(),
      });
      setContinuationMessage('');
      toast.info('Sent', { description: 'Agent processing...', duration: 3000 });

      // Switch to the new rerun execution
      if (result.rerunExecutionId && onExecutionChange) {
        onExecutionChange(result.rerunExecutionId);
      }
    } catch (error: unknown) {
      toast.error('Failed to continue', {
        description: error instanceof Error ? error.message : 'Unknown error',
        duration: 4000,
      });
    }
  };

  const tabs = [{ id: 'automation' as TabId, label: 'Automation', icon: <Sparkles size={12} /> }];

  // Format step name for display
  const formatStepName = (name: string): string => {
    return name
      .replace(/_/g, ' ')
      .replace(/^agent\s+/i, '')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const isAgentInputStep = filteredSteps.some(
    step => step.stepExecutorType?.toLowerCase() === 'agent',
  );

  return (
    <div className='h-full flex flex-col bg-white overflow-hidden min-w-0'>
      {/* Thread Tab Content */}
      {mainTab === 'thread' ? (
        conversationId && channelId ? (
          showThreadSummary ? (
            /* Thread Summary View */
            <div className='flex-1 overflow-hidden bg-gray-50'>
              <ThreadSummary
                conversationId={conversationId}
                channelName={ticketTitle || 'Thread'}
                onClose={() => setShowThreadSummary(false)}
              />
            </div>
          ) : (
            /* Thread Messages View */
            <ThreadMessages
              conversationId={conversationId}
              channelId={channelId}
              simpleView={true}
              onSummaryClick={() => {
                setShowThreadSummary(true);
              }}
              onClose={() => setMainTab('flow')}
            />
          )
        ) : (
          <div className='flex-1 flex items-center justify-center text-gray-500 text-sm'>
            No thread available
          </div>
        )
      ) : mainTab === 'history' ? (
        <div className='flex flex-col h-full bg-white'>
          <div className='flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50/50'>
            <h3 className='font-medium text-gray-900 flex items-center gap-2'>
              <History size={16} />
              Execution History
            </h3>
            <button
              onClick={() => setMainTab('flow')}
              className='p-1.5 rounded-md hover:bg-gray-200 text-gray-500 transition-colors'
              data-track-category='Workflows'
              data-track-name='CloseHistoryTab'
              data-track-metadata={JSON.stringify({ executionId })}
            >
              <X size={16} />
            </button>
          </div>
          <div className='flex-1 overflow-y-auto p-3 space-y-2.5 bg-gray-50/30'>
            {(() => {
              const metadata = combinedStepsData?.workflows?.[0]?.executionMetadata || [];

              if (metadata.length === 0) {
                return (
                  <div className='text-center p-4 text-gray-500 text-sm'>No history available</div>
                );
              }

              return metadata.map((exec, index): React.JSX.Element => {
                const attemptNumber = metadata.length - index;
                const isSelected = exec.executionId === executionId;

                let parentAttemptNumber = null;
                if (exec.parentWorkflowExecutionId) {
                  const parentIndex = metadata.findIndex(
                    e => e.executionId === exec.parentWorkflowExecutionId,
                  );
                  if (parentIndex !== -1) {
                    parentAttemptNumber = metadata.length - parentIndex;
                  }
                }

                return (
                  <div
                    key={exec.executionId}
                    role='button'
                    tabIndex={0}
                    onClick={() => {
                      if (onExecutionChange) onExecutionChange(exec.executionId);
                      setMainTab('flow');
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        if (onExecutionChange) onExecutionChange(exec.executionId);
                        setMainTab('flow');
                      }
                    }}
                    className={`p-3 rounded-lg border transition-all cursor-pointer hover:shadow-sm ${
                      isSelected
                        ? 'bg-blue-50 border-blue-200 ring-1 ring-blue-100'
                        : 'bg-white border-gray-200 hover:border-blue-200 hover:bg-gray-50'
                    }`}
                    data-track-category='Workflows'
                    data-track-name='SelectExecutionHistory'
                    data-track-metadata={JSON.stringify({
                      executionId: exec.executionId,
                      attemptNumber,
                    })}
                  >
                    <div className='flex items-start justify-between mb-1'>
                      <span
                        className={`font-medium text-sm ${isSelected ? 'text-blue-700' : 'text-gray-900'}`}
                      >
                        Attempt {attemptNumber} {exec.tag === 'root' ? '(Original)' : ''}
                      </span>
                      {isSelected && <Check size={14} className='text-blue-600' />}
                    </div>

                    <div className='text-xs text-gray-500 flex flex-col gap-1'>
                      <div className='flex items-center gap-1.5'>
                        <Clock size={12} />
                        {format(new Date(exec.createdAt), 'PPpp')}
                      </div>

                      <div className='flex items-center gap-1.5'>
                        <span
                          className={`px-1.5 py-0.5 rounded-full text-[10px] uppercase font-semibold tracking-wide ${
                            (exec.executionStatus || '').toUpperCase() === 'COMPLETED'
                              ? 'bg-emerald-100 text-emerald-700'
                              : (exec.executionStatus || '').toUpperCase() === 'FAILED'
                                ? 'bg-red-100 text-red-700'
                                : (exec.executionStatus || '').toUpperCase() === 'RUNNING'
                                  ? 'bg-blue-100 text-blue-700'
                                  : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {exec.executionStatus}
                        </span>
                      </div>

                      {exec.sourceStepName && parentAttemptNumber && (
                        <div className='text-xs text-gray-600 flex items-start gap-1 mt-1 bg-gray-50 p-1.5 rounded'>
                          <Route size={12} className='mt-0.5' />
                          <span>
                            Forked from Attempt {parentAttemptNumber} at step &apos;
                            {exec.sourceStepName}&apos;
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      ) : mainTab === 'errors' ? (
        <ErrorsPanel 
          errorSteps={errorSteps} 
          onClose={() => setMainTab('flow')} 
        />
      ) : (
        /* Flow Tab Content - Original workflow view */
        <>
          <div ref={headerRef} className='flex-shrink-0 border-b border-gray-100 px-3 py-2.5'>
            <div className='flex items-center gap-2.5'>
              {/* Step Navigation Header */}
              {graphNodes.length > 0 ? (
                <div className='flex items-center gap-2.5 px-2.5 py-2 bg-gray-50 rounded-lg border border-gray-200 flex-1'>
                  {/* Prev Button */}
                  <button
                    onClick={handlePrevNode}
                    disabled={currentNodeIndex === 0}
                    className='p-1 rounded hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors'
                    title='Previous step'
                    data-track-category='Workflows'
                    data-track-name='NavigateToPreviousStep'
                    data-track-metadata={JSON.stringify({
                      currentNodeIndex,
                      totalSteps: graphNodes.length,
                    })}
                  >
                    <ChevronLeft size={16} className='text-gray-600' />
                  </button>

                  <div
                    className='flex-1 flex items-center gap-2.5 min-w-0 cursor-pointer hover:bg-gray-200/50 rounded px-1.5 py-1 -my-1 transition-colors'
                    onClick={() => setIsGraphViewOpen(!isGraphViewOpen)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setIsGraphViewOpen(!isGraphViewOpen);
                      }
                    }}
                    role='button'
                    tabIndex={0}
                    data-track-category='Workflows'
                    data-track-name='ToggleGraphView'
                    data-track-metadata={JSON.stringify({ currentNodeIndex, executionId })}
                  >
                    {/* Status Icon */}
                    <div
                      className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${
                        currentNode?.status === 'running'
                          ? 'bg-blue-100'
                          : currentNode?.status === 'completed'
                            ? 'bg-emerald-100'
                            : currentNode?.status === 'failed'
                              ? 'bg-red-100'
                              : 'bg-gray-100'
                      }`}
                    >
                      {currentNode?.status === 'running' ? (
                        <Loader2 size={12} className='text-blue-600 animate-spin' />
                      ) : currentNode?.status === 'completed' ? (
                        <CheckCircle size={12} className='text-emerald-600' />
                      ) : currentNode?.status === 'failed' ? (
                        <AlertCircle size={12} className='text-red-600' />
                      ) : (
                        <Clock size={12} className='text-gray-500' />
                      )}
                    </div>

                    {/* Step Name */}
                    <span className='font-medium text-gray-800 flex-1 text-left text-sm truncate'>
                      {currentNode ? formatStepName(currentNode.stepName) : 'Loading...'}
                    </span>

                    {/* Position Indicator */}
                    <span className='text-xs text-gray-400 flex-shrink-0'>
                      ({currentNodeIndex + 1}/{graphNodes.length})
                    </span>
                  </div>

                  {/* Jump to Running Button */}
                  {runningNodeIndex !== -1 && runningNodeIndex !== currentNodeIndex && (
                    <button
                      onClick={handleJumpToRunning}
                      className='px-2 py-1 text-xs font-medium text-blue-600 bg-blue-50 rounded hover:bg-blue-100 transition-colors flex items-center gap-1'
                      title='Jump to running step'
                      data-track-category='Workflows'
                      data-track-name='JumpToRunningStep'
                      data-track-metadata={JSON.stringify({ currentNodeIndex, runningNodeIndex })}
                    >
                      <Loader2 size={10} className='animate-spin' />
                      Live
                    </button>
                  )}

                  {/* Next Button */}
                  <button
                    onClick={handleNextNode}
                    disabled={currentNodeIndex >= graphNodes.length - 1}
                    className='p-1 rounded hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors'
                    title='Next step'
                    data-track-category='Workflows'
                    data-track-name='NavigateToNextStep'
                    data-track-metadata={JSON.stringify({
                      currentNodeIndex,
                      totalSteps: graphNodes.length,
                    })}
                  >
                    <ChevronRight size={16} className='text-gray-600' />
                  </button>
                </div>
              ) : (
                /* Fallback header when no graph nodes */
                <div className='flex items-center gap-2.5 px-2.5 py-2 bg-gray-50 rounded-lg border border-gray-200 flex-1'>
                  <div className='w-6 h-6 rounded-md flex items-center justify-center shadow-sm'>
                    <Bot size={12} className='text-black' />
                  </div>
                  <span className='font-medium text-gray-800 flex-1 text-left text-sm'>
                    Workflow Steps
                  </span>
                </div>
              )}

              {/* Errors Toggle Button */}
              {errorSteps.length > 0 && (
                <div className='relative flex-shrink-0'>
                  <button
                    onClick={() => setMainTab('errors')}
                    className={`relative flex items-center justify-center text-sm font-medium rounded-lg border transition-all ${
                      mainTab === 'errors'
                        ? 'bg-red-50 text-red-600 border-red-200'
                        : 'bg-white text-red-500 border-red-200 hover:bg-red-50'
                    }`}
                    style={{ width: '42px', height: '42px' }}
                    title='Errors'
                    data-track-category='Workflows'
                    data-track-name='ToggleErrorsTab'
                  >
                    <AlertTriangle size={18} />
                    <span className="absolute -top-1.5 -right-1.5 bg-red-600 text-white text-[10px] font-bold w-[20px] h-[20px] flex items-center justify-center rounded-full border-2 border-white shadow-sm leading-none">
                      {errorSteps.length > 99 ? '99+' : errorSteps.length}
                    </span>
                  </button>
                </div>
              )}

              {/* Search Toggle Button */}
              <button
                onClick={() => {
                  setIsSearchOpen(!isSearchOpen);
                  if (isSearchOpen) setSearchQuery('');
                }}
                className={`flex flex-shrink-0 items-center justify-center text-sm font-medium rounded-lg border transition-colors ${
                  isSearchOpen
                    ? 'bg-blue-50 text-blue-600 border-blue-200'
                    : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                }`}
                style={{ width: '42px', height: '42px' }}
                title='Search'
                data-track-category='Workflows'
                data-track-name='ToggleSearch'
              >
                <Search size={16} />
              </button>

              {/* More Actions Menu */}
              <div className='relative flex-shrink-0'>
                <button
                  onClick={() => setIsMenuOpen(!isMenuOpen)}
                  onBlur={() => setTimeout(() => setIsMenuOpen(false), 200)}
                  className='flex items-center justify-center text-sm font-medium rounded-lg border bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100 transition-colors'
                  style={{ width: '42px', height: '42px' }}
                  title='More Options'
                  data-track-category='Workflows'
                  data-track-name='ToggleMoreActions'
                >
                  <MoreVertical size={16} />
                </button>

                {isMenuOpen && (
                  <div className='absolute right-0 top-full mt-1.5 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 overflow-hidden'>
                    <button
                      onClick={() => {
                        setMainTab('history');
                        setIsMenuOpen(false);
                      }}
                      className='w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 text-left transition-colors'
                      data-track-category='Workflows'
                      data-track-name='OpenHistoryTab'
                    >
                      <History size={16} className='text-gray-400' />
                      Attempts
                    </button>
                    <button
                      onClick={() => {
                        setMainTab('thread');
                        setIsMenuOpen(false);
                      }}
                      className='w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 text-left transition-colors'
                      data-track-category='Workflows'
                      data-track-name='OpenThreadTab'
                    >
                      <MessageSquare size={16} className='text-gray-400' />
                      Thread
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Search Bar Input */}
            {isSearchOpen && (
              <div className='mt-2.5 mb-1 px-1'>
                <div className='relative flex items-center bg-white border border-gray-200 rounded-lg focus-within:ring-1 focus-within:ring-blue-500 focus-within:border-blue-500 shadow-sm'>
                  <Search size={14} className='absolute left-3 text-gray-400' />
                  <input
                    type='text'
                    placeholder='Search in steps, payloads, logs...'
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className='w-full pl-9 pr-24 py-2 text-sm bg-transparent !outline-none border-none rounded-lg text-gray-700 focus:outline-none focus:ring-0 focus:border-transparent'
                    autoFocus
                  />
                  {searchQuery && (
                    <div className='absolute right-2 flex items-center gap-1.5'>
                      <span className='text-[10px] text-gray-400 font-medium px-1.5 py-0.5 bg-gray-50 border border-gray-100 rounded flex-shrink-0'>
                        {searchedSteps.length} result{searchedSteps.length !== 1 ? 's' : ''}
                      </span>
                      <button
                        onClick={() => setSearchQuery('')}
                        className='p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0'
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Legacy filter indicator (when selectedNodeStepIds is used without graphNodes) */}
            {graphNodes.length === 0 && selectedNodeStepIds && selectedNodeStepIds.length > 0 && (
              <div className='flex items-center gap-1.5 mt-2 px-1'>
                <span className='text-xs text-blue-600 font-medium'>
                  Filtered: {filteredSteps.length} steps
                </span>
                {onClearSelection && (
                  <button
                    onClick={onClearSelection}
                    className='p-0.5 rounded hover:bg-blue-100 transition-colors'
                    title='Clear'
                    data-track-category='Workflows'
                    data-track-name='ClearStepSelection'
                    data-track-metadata={JSON.stringify({ executionId })}
                  >
                    <X size={10} className='text-blue-600' />
                  </button>
                )}
              </div>
            )}
          </div>
          {/* Only show tab bar if there are more than one tab */}
          {tabs.length > 1 && (
            <div className='flex-shrink-0 border-b border-gray-100'>
              <div className='flex px-1'>
                {tabs.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${activeTab === tab.id ? 'text-blue-600 border-blue-500' : 'text-gray-500 border-transparent hover:text-gray-700'}`}
                    data-track-category='Workflows'
                    data-track-name='SelectAutomationTab'
                    data-track-metadata={JSON.stringify({ tabId: tab.id, tabLabel: tab.label })}
                  >
                    {tab.icon}
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className='flex-1 flex flex-col min-h-0 p-3 bg-gray-50/50 min-w-0'>
            <>
              {ticketTitle && (
                <button
                  onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                  className='w-full text-left border rounded-md bg-muted p-2 shadow-sm cursor-pointer hover:bg-muted/80 transition-colors overflow-hidden'
                  data-track-category='Workflows'
                  data-track-name='ToggleTicketDescription'
                  data-track-metadata={JSON.stringify({
                    executionId,
                    isExpanded: isDescriptionExpanded,
                  })}
                >
                  <div
                    className={`text-sm text-gray-800 prose prose-sm max-w-none ${
                      !isDescriptionExpanded ? 'line-clamp-2' : 'ticket-description-scroll'
                    }`}
                    dangerouslySetInnerHTML={{
                      // eslint-disable-next-line @typescript-eslint/naming-convention
                      __html: DOMPurify.sanitize(ticketDescription || '', {
                        ALLOWED_TAGS: [
                          'p',
                          'br',
                          'b',
                          'strong',
                          'i',
                          'em',
                          'a',
                          'div',
                          'span',
                          'ul',
                          'ol',
                          'li',
                          'h1',
                          'h2',
                          'h3',
                          'h4',
                          'h5',
                          'h6',
                          'blockquote',
                          'code',
                          'pre',
                          'table',
                          'thead',
                          'tbody',
                          'tr',
                          'td',
                          'th',
                        ],
                        ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'style'],
                        ALLOW_DATA_ATTR: false,
                      }).replace(/\n/g, '<br>'),
                    }}
                  />
                </button>
              )}
              {/* Steps list scrolls independently below */}
              <div
                ref={scrollContainerRef}
                onScroll={handleScroll}
                className='flex-1 min-h-0 overflow-y-auto space-y-0.5 min-w-0 max-w-full overflow-x-hidden no-scrollbar'
              >
                {searchedSteps.length === 0 && userMessages.length === 0 ? (
                  <div className='flex flex-col items-center justify-center py-16 text-center'>
                    <div className='w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3'>
                      {searchQuery ? (
                        <Search size={24} className='text-gray-300' />
                      ) : currentNode?.status === 'pending' ? (
                        <Circle size={24} className='text-gray-300' />
                      ) : currentNode?.status === 'running' ? (
                        <Loader2 size={24} className='text-blue-500 animate-spin' />
                      ) : (
                        <Route size={24} className='text-gray-400' />
                      )}
                    </div>
                    <p className='text-gray-600 text-sm font-medium'>
                      {searchQuery
                        ? 'No steps match your search'
                        : currentNode?.status === 'pending'
                          ? 'Waiting to start...'
                          : currentNode?.status === 'running'
                            ? 'Running...'
                            : 'No steps yet'}
                    </p>
                    {currentNode && !searchQuery && (
                      <p className='text-gray-400 text-xs mt-1'>
                        {formatStepName(currentNode.stepName)}
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    {searchedSteps.map(step => (
                      <StepItem key={step.id} step={step} forceExpanded={!!searchQuery.trim()} />
                    ))}
                    {/* Do not show user messages as chat bubbles */}
                  </>
                )}
                <div ref={messagesEndRef} />
              </div>
            </>
          </div>
          <div className='flex-shrink-0 bg-white border-t border-gray-100 p-3'>
            {/* Show input box based on step status - only enable when completed/failed */}
            {currentNode?.status === 'pending' ? (
              // Pending state - waiting to start
              <div className='flex items-center justify-center gap-2 py-3 px-4 bg-gray-50 rounded-lg border border-gray-200'>
                <Clock size={16} className='text-gray-400' />
                <span className='text-sm text-gray-600'>
                  Waiting for {formatStepName(currentNode.stepName)} to start...
                </span>
              </div>
            ) : currentNode?.status === 'running' ? (
              // Running state - show disabled input with running indicator
              <div className='flex items-center justify-center gap-2 py-3 px-4 bg-gray-50 rounded-lg border border-gray-200'>
                <Loader2 size={16} className='text-blue-500 animate-spin' />
                <span className='text-sm text-gray-600'>
                  {formatStepName(currentNode.stepName)} is running...
                </span>
              </div>
            ) : isAgentInputStep &&
              (currentNode?.status === 'completed' || currentNode?.status === 'failed') ? (
              // Completed/Failed state - allow sending new message
              <div className='relative rounded-lg border bg-gray-50 border-gray-200 focus-within:border-blue-300 focus-within:ring-1 focus-within:ring-blue-100'>
                <textarea
                  value={continuationMessage}
                  onChange={e => setContinuationMessage(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void handleSendMessage();
                    }
                  }}
                  placeholder={
                    currentNode?.status === 'completed'
                      ? 'Type your query to rerun...'
                      : 'Type your query to continue...'
                  }
                  disabled={isContinuing}
                  className='w-full px-3 py-2.5 text-sm bg-transparent resize-none focus:outline-none disabled:opacity-50'
                  rows={2}
                  data-track-category='Workflows'
                  data-track-name='WorkflowContinuationInput'
                  data-track-metadata={JSON.stringify({
                    executionId,
                    stepName: currentNode?.stepName,
                  })}
                />
                <div className='flex items-center justify-end px-2 py-1.5 border-t border-gray-100'>
                  <button
                    onClick={() => void handleSendMessage()}
                    disabled={isContinuing || !continuationMessage.trim()}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all text-sm font-medium ${
                      continuationMessage.trim() && !isContinuing
                        ? 'bg-blue-500 text-white hover:bg-blue-600'
                        : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    }`}
                    data-track-category='Workflows'
                    data-track-name='SendContinuationMessage'
                    data-track-metadata={JSON.stringify({ executionId })}
                  >
                    {isContinuing ? (
                      <Loader2 size={14} className='animate-spin' />
                    ) : (
                      <>
                        <Send size={14} />
                        Send
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : !currentNode ? (
              <div className='flex items-center justify-center gap-2 py-3 px-4 bg-gray-50 rounded-lg border border-gray-200'>
                <Circle size={16} className='text-gray-300' />
                <span className='text-sm text-gray-500'>No step selected</span>
              </div>
            ) : null}
          </div>

          {isGraphViewOpen &&
            createPortal(
              <div
                className='fixed bg-white z-50 shadow-lg border-t border-gray-200'
                style={{
                  left: graphPosition.left,
                  top: graphPosition.top - 64,
                  width: graphPosition.width,
                  height: graphPosition.height + 64,
                  right: 'auto',
                  bottom: 'auto',
                  overflow: 'hidden',
                  borderRadius: '0 0 8px 8px',
                }}
              >
                {combinedStepsData && (
                  <WorkflowGraphOnly
                    workflowType={combinedStepsData.workflows?.[0]?.workflowType}
                    workflowId={combinedStepsData.workflows?.[0]?.workflowId}
                    combinedStepsData={combinedStepsData}
                    onNodeSelect={handleGraphNodeClick}
                  />
                )}
              </div>,
              document.body,
            )}
        </>
      )}
    </div>
  );
};

export default WorkflowChatPanel;
