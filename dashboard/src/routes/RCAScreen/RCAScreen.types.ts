import type { RCAStatus, COEStatus, SEVERITY, Impact, COE, MessageAttachment } from '@xyne/shared';
import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../../zero/queries';

export type Phase = 'release' | 'rca' | 'impact' | 'coe';

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
  impactTypeId: string;
  impact: string;
  files: File[];
}

export interface PendingCOE {
  ownerId: string;
  actionTypeId: string;
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
  bugTypeId: string;
  categoryTypeId: string;
  issueCategoryId?: string;
  issueStartAt?: number | null;
  status: RCAStatus;
}

export interface ImpactFormValues {
  ticketId: string;
  impactTypeId: string;
  impact: string;
}

export interface COEFormValues {
  ownerId: string;
  actionTypeId: string;
  action: string;
  status: COEStatus;
  dueDate: number | null;
}

// Component Props
export interface RCAFormProps {
  selectedRecord: RCARecord;
  isRcaEditable: boolean;
  isSubmitting: boolean;
  ownerItems: SelectOption[];
  filteredOwnerItems: SelectOption[];
  ownerSearchQuery: string;
  setOwnerSearchQuery: (query: string) => void;
  bugTypeOptions: SelectOption[];
  categoryTypeOptions: SelectOption[];
  severityOptions: Array<{ label: string; value: SEVERITY }>;
  bugTypeValueById: Map<string, string>;
  categoryValueById: Map<string, string>;
  issueCategoryOptionsByCategoryValue: Record<string, SelectOption[]>;
  pendingRCA?: Partial<RCAFormValues> | null;
  setPendingRCA?: (values: Partial<RCAFormValues> | null) => void;
}

export type ImpactType = Impact;
export type COEType = COE;
export type ImpactAttachment = MessageAttachment;

export interface ImpactFormProps {
  selectedRecord: DetailedRcaRecord;
  isImpactEnabled: boolean;
  isSubmitting: boolean;
  impactTypeOptions: SelectOption[];
  impactAttachments: ImpactAttachment[];
  onAddImpactAttachments: (files: File[], impactId: string) => Promise<void>;
  onRemoveImpactAttachment: (attachmentId: string) => Promise<void>;
  pendingImpacts: PendingImpact[];
  selectedImpact: ImpactType | null;
  impactDraftById: Record<string, Pick<PendingImpact, 'impactTypeId' | 'impact'>>;
  setImpactDraftById: React.Dispatch<
    React.SetStateAction<Record<string, Pick<PendingImpact, 'impactTypeId' | 'impact'>>>
  >;
  draftImpactFilesById: Record<string, File[]>;
  setDraftImpactFilesById: React.Dispatch<React.SetStateAction<Record<string, File[]>>>;
  setPendingImpacts: React.Dispatch<React.SetStateAction<PendingImpact[]>>;
  setSelectedImpactId: (id: string | null) => void;
  onPhaseChange: (phase: Phase) => void;
}

export interface COEFormProps {
  selectedRecord: DetailedRcaRecord;
  isCoeEnabled: boolean;
  isSubmitting: boolean;
  ownerItems: SelectOption[];
  coeActionTypeOptions: SelectOption[];
  coeActionTypeLabelById?: Map<string, string>;
  coeActionTypeValueById: Map<string, string>;
  quickFixActionTypeId?: string;
  coeStatusOptions: COEStatusOption[];
  pendingCOEs: PendingCOE[];
  selectedCoe: COEType | null;
  rcaOwnerId: string;
  setPendingCOEs: React.Dispatch<React.SetStateAction<PendingCOE[]>>;
  setSelectedCoeId: (id: string | null) => void;
  onSubmit: () => Promise<void>;
  onPhaseChange: (phase: Phase) => void;
  onNavigate: (path: string) => void;
  pendingRCA?: Partial<RCAFormValues> | null;
}

export interface RCAPhaseStepperProps {
  phases: PhaseConfig[];
  activePhase: Phase;
  isImpactEnabled: boolean;
  isCoeEnabled: boolean;
  onPhaseClick: (phase: Phase) => void;
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
  bugTypeValueById: Map<string, string>;
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
