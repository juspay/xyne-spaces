/**
 * @xyne/workflow-ui — production-grade workflow dashboard components.
 *
 * Usage:
 * ```tsx
 * import { WorkflowUIProvider, WorkflowDashboard } from '@xyne/workflow-ui';
 * import { createWorkflowClient } from '@xyne/workflow-sdk/client';
 *
 * const client = createWorkflowClient({
 *   baseUrl: '/api/workflows',
 *   getHeaders: () => ({ Authorization: `Bearer ${token}` }),
 * });
 *
 * <WorkflowUIProvider client={client}>
 *   <WorkflowDashboard />
 * </WorkflowUIProvider>
 * ```
 */

// ─── Components ───
export {
  // Provider
  WorkflowUIProvider,
  useWorkflowUI,
  useSlot,
  // Shared
  cn,
  LoadMore,
  StatusBadge,
  EmptyState,
  LoadingSpinner,
  ErrorBoundary,
  // Builder
  WorkflowBuilder,
  computeLayout,
  // Schema Form
  SchemaFormRenderer,
  // Runs
  RunsView,
  RunsTable,
  RunsFilters,
  // Execution
  ExecutionViewer,
  ExecutionTree,
  ExecutionHeader,
  StepDetailPanel,
  SummaryPanel,
  SidePanelShell,
  PauseInteractionPanel,
  SchemaAwareRenderer,
  // Dashboard
  WorkflowDashboard,
  SummaryButton,
  SummaryDialog,
  MarkdownView,
  CitationArrow,
  CitationMarks,
  // Layout
  AppShell,
  Sidebar,
  Breadcrumb,
  PageHeader,
  // Automations
  AutomationCard,
  AutomationListView,
  CreateWorkflowDialog,
  // Analytics
  AnalyticsDashboard,
  // Workflow Browser
  WorkflowBrowser,
  WorkflowHome,
  WorkflowApp,
  CredentialVault,
} from './components/index.js';

export type {
  WorkflowUIConfig,
  LoadMoreProps,
  StatusBadgeProps,
  StatusVariant,
  EmptyStateProps,
  LoadingSpinnerProps,
  ErrorBoundaryProps,
  WorkflowBuilderProps,
  LayoutNode,
  LayoutEdge,
  LayoutResult,
  SchemaFormRendererProps,
  RunsViewProps,
  RunsTableProps,
  RunsFiltersProps,
  ExecutionViewerProps,
  ExecutionTreeProps,
  ExecutionHeaderProps,
  StepDetailPanelProps,
  SummaryPanelProps,
  SidePanelShellProps,
  PauseInteractionPanelProps,
  SchemaAwareRendererProps,
  WorkflowDashboardProps,
  SummaryButtonProps,
  SummaryDialogProps,
  MarkdownViewProps,
  CitationArrowProps,
  CitationMarksProps,
  // Layout
  AppShellProps,
  SidebarProps,
  SidebarItem,
  BreadcrumbProps,
  BreadcrumbItem,
  PageHeaderProps,
  // Automations
  AutomationCardProps,
  AutomationListViewProps,
  CreateWorkflowDialogProps,
  // Analytics
  AnalyticsDashboardProps,
  // Workflow Browser
  WorkflowBrowserProps,
  FolderCrumb,
  WorkflowHomeProps,
  WorkflowHomeTab,
  WorkflowAppProps,
  CredentialVaultProps,
} from './components/index.js';

// ─── Authorization (UI reflection helpers) ───
export { canPerform, isPermissionDenied, friendlyMutationError } from './utils/permissions.js';

// ─── Analytics hooks ───
// ─── Live change notifications ───
//
// The provider owns one multiplexed connection; these are how a component
// registers interest in it. `useLiveWorkflow` keeps a cached workflow honest on
// its own; `useWorkflowChanges` is for the cases where refreshing is the wrong
// answer, such as an editor holding unsaved work.
export {
  useLiveWorkflow,
  useWorkflowChanges,
  useLiveChanges,
  useLiveRuns,
} from './live/use-live-workflow.js';
export { useLiveContext, topicKey } from './live/live-context.js';
export type { LiveChange, LiveContextValue, LiveTopic } from './live/live-context.js';

// Query keys and reads, so a host can prime or invalidate the same cache the
// components use.
export { wfKeys, useWorkflowDetail, toWorkflowDetail } from './hooks/queries.js';
export type { WorkflowDetail } from './hooks/queries.js';

export { useAnalytics } from './hooks/use-analytics.js';

export { useCredentialList } from './hooks/use-credential-list.js';
export type { UseCredentialListReturn } from './hooks/use-credential-list.js';
export { useLastRuns } from './hooks/use-last-runs.js';
export type { LastRunEntry } from './hooks/use-last-runs.js';
export { useDebouncedValue } from './hooks/use-debounced-value.js';

// ─── Approvals ───
export { useApprovalCount } from './hooks/use-approval-count.js';
export { useApprovalsList } from './hooks/use-approvals-list.js';
export type { ApprovalFilters, UseApprovalsListReturn } from './hooks/use-approvals-list.js';
export { usePendingWorkflows } from './hooks/use-pending-workflows.js';
export type { UsePendingWorkflowsReturn } from './hooks/use-pending-workflows.js';
export { ApprovalsView } from './components/index.js';
export type { ApprovalsViewProps } from './components/index.js';
export { SubmittedView, WorkflowReviewView } from './components/index.js';
export type { SubmittedViewProps, WorkflowReviewViewProps } from './components/index.js';
export type { AnalyticsData, AnalyticsRange, UseAnalyticsReturn } from './hooks/use-analytics.js';

// ─── Types ───
export type {
  SlotName,
  SlotOverrides,
  ClassNamesOverrides,
  AttributeFieldsProps,
  CredentialAttributesDisplayProps,
  ShareSlotProps,
  AssigneePickerProps,
} from './types/index.js';

// ─── SDK re-exports (so consumers only need @xyne/workflow-ui) ───
export { createWorkflowClient } from '@xyne/workflow-sdk/client';
export type { WorkflowConfig } from '@xyne/workflow-sdk/builder';
export { AiBuilderClient } from '@xyne/workflow-sdk/ai-builder';
export type { AiBuilderClientOptions, AiBuilderMessage, AiBuilderResponse } from '@xyne/workflow-sdk/ai-builder';
