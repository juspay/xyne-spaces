import type { RCAStatus, COEStatus, SEVERITY, Impact, COE, MessageAttachment } from '@xyne/shared';
import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../../zero/queries';

export type Phase = 'release' | 'rca' | 'impact' | 'coe';

// Query-backed records still use the raw Zero field names from the DB contract.
export type RCARecord = QueryResultType<typeof queries.allRCAsPaginated>[number];
export type DetailedRcaRecord = QueryResultType<typeof queries.rcaById>;
export type ReleaseTicket = QueryResultType<typeof queries.releaseTickets>[number];
export type ReleaseAttributionRecord = QueryResultType<
  typeof queries.releaseAttributionsByTicketId
>[number];
export type SubTicketRecord = QueryResultType<typeof queries.subTicketsByIds>[number];
export interface PhaseConfig {
  id: Phase;
  label: string;
  description: string;
}

export interface COEStatusOption {
  label: string;
  value: COEStatus;
}

export interface SelectOption {
  label: string;
  value: string;
  xyneId?: string;
  title?: string;
}

export interface PendingImpact {
  tempId: string;
  impactType: string;
  impact: string;
  files: File[];
}

export interface PendingCOE {
  ownerId: string;
  actionType: string;
  action: string;
  status: COEStatus;
}

export interface ReadOnlyFieldProps {
  label: string;
  value: string;
}

export interface RenderFieldErrorProps {
  error?: string | null;
  isTouched?: boolean;
}

export interface RCAFormValues {
  ticketId: string;
  ownerId: string;
  title: string;
  summary: string;
  rootCause: string;
  severity: SEVERITY;
  bugType: string;
  category: string;
  issueCategory?: string;
  issueStartAt?: number | null;
  status: RCAStatus;
}

export interface ImpactFormValues {
  ticketId: string;
  impactType: string;
  impact: string;
}

export interface COEFormValues {
  ownerId: string;
  actionType: string;
  action: string;
  status: COEStatus;
  dueDate: number | null;
}

// Component Props
export interface FormControllerRef {
  save: () => Promise<boolean>;
  hasUnsavedChanges: () => boolean;
  discard?: () => void;
}

export interface RCAFormProps {
  selectedRecord: RCARecord;
  isRcaEditable: boolean;
  isSubmitting: boolean;
  ownerItems: SelectOption[];
  filteredOwnerItems: SelectOption[];
  ownerSearchQuery: string;
  setOwnerSearchQuery: (query: string) => void;
  bugTypeOptions: SelectOption[];
  categoryOptions: SelectOption[];
  categoryOptionsByBugTypeValue: Record<string, SelectOption[]>;
  severityOptions: Array<{ label: string; value: SEVERITY }>;
  issueCategoryOptionsByCategoryValue: Record<string, SelectOption[]>;
  issueCategoryRequiredByCategoryValue: Record<string, boolean>;
  controllerRef?: React.MutableRefObject<FormControllerRef | null>;
}

export type ImpactType = Impact;
export type COEType = COE;
export type ImpactAttachment = MessageAttachment;

export interface ImpactFormProps {
  selectedRecord: DetailedRcaRecord;
  isImpactEnabled: boolean;
  isSubmitting: boolean;
  impactTypeOptions: SelectOption[];
  onPhaseChange: (phase: Phase) => void;
  controllerRef?: React.MutableRefObject<FormControllerRef | null>;
}

export interface COEFormProps {
  selectedRecord: DetailedRcaRecord;
  isCoeEnabled: boolean;
  isSubmitting: boolean;
  ownerItems: SelectOption[];
  coeActionTypeOptions: SelectOption[];
  coeActionLabelByValue?: Map<string, string>;
  quickFixOptions: SelectOption[];
  quickFixActionValue?: string;
  hiddenCoeActionValues?: string[];
  coeStatusOptions: COEStatusOption[];
  rcaOwnerId: string;
  onSubmit: () => Promise<void>;
  onPhaseChange: (phase: Phase) => void;
  controllerRef?: React.MutableRefObject<FormControllerRef | null>;
}

export interface RCAPhaseStepperProps {
  phases: PhaseConfig[];
  activePhase: Phase;
  isImpactEnabled: boolean;
  isCoeEnabled: boolean;
  onPhaseClick: (phase: Phase) => void | Promise<void>;
}

export interface ReleaseMappingFormProps {
  ticketId: string;
  releaseAttributions: ReleaseAttributionRecord[];
  attributedSubTickets: SubTicketRecord[];
  isSubmitting: boolean;
  onPhaseChange: (phase: Phase) => void;
}

export interface RCASidebarProps {
  records: RCARecord[];
  ownerItems: SelectOption[];
  isLoading: boolean;
  isSubmitting: boolean;
  onRecordClick: (record: RCARecord) => void;
  itemsPerPage: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  onNextPage: () => void;
  onPreviousPage: () => void;
}

export interface RCACursor {
  createdAt: number;
  id: string;
}
