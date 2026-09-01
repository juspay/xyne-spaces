export type DelegationStatus = 'pending' | 'approved' | 'rejected';

export type DelegationIdentityMode = 'user' | 'callee_app';

export interface DelegationAgentRef {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  enabled?: boolean;
  ownerUserId?: string | null;
  ownerName?: string | null;
}

export interface AgentDelegationGrant {
  id: string;
  callerAgentId: string;
  calleeAgentId: string;
  identityMode: DelegationIdentityMode;
  enabled: boolean;
  status: DelegationStatus;
  approvedByUserId: string | null;
  approvedAt: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  requestReason: string | null;
  callee?: DelegationAgentRef | null;
  caller?: DelegationAgentRef | null;
}

export interface CreateDelegationGrantInput {
  calleeSlug: string;
  identityMode?: DelegationIdentityMode;
  requestReason?: string;
}
