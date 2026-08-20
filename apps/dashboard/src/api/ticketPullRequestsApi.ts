import { apiInstance } from '../services/clients/apiClient';

// Client for the ticket-initiated Bitbucket PR endpoints (SDLCT-0001).
// Mirrors the backend DTO in apps/backend/src/types/ticketPullRequest.ts.

export type TicketPrValidationState = 'valid' | 'warning' | 'invalid' | 'unknown';

export interface TicketPrValidation {
  state: TicketPrValidationState;
  reason?: string;
  message?: string;
}

export interface TicketPrReviewer {
  name: string;
  email?: string;
  approved?: boolean;
}

export interface TicketPullRequest {
  id: string;
  prId: number;
  repoName: string;
  repositoryUrl: string | null;
  sourceBranchName: string;
  destinationBranchName: string;
  status: string;
  prUrl: string | null;
  ticketId: string;
  validation: TicketPrValidation;
  reviewers?: TicketPrReviewer[];
  commentCount?: number;
  lastSyncedAt?: string;
}

export interface TicketPrFlags {
  ticket_pr_panel_enabled: boolean;
  ticket_pr_create_enabled: boolean;
  ticket_pr_link_enabled: boolean;
  ticket_pr_webhook_sync_enabled: boolean;
  ticket_pr_strict_validation_enabled: boolean;
}

export interface CreateTicketPrPayload {
  repositoryUrl: string;
  sourceBranchName: string;
  destinationBranchName: string;
  title?: string;
  description?: string;
}

export const ticketPullRequestsApi = {
  getFlags: async (): Promise<TicketPrFlags> => {
    const res = await apiInstance.get<{ flags: TicketPrFlags }>('/tickets/pull-requests/flags');
    return res.data.flags;
  },

  list: async (ticketId: string): Promise<TicketPullRequest[]> => {
    const res = await apiInstance.get<{ pullRequests: TicketPullRequest[] }>(
      `/tickets/${ticketId}/pull-requests`,
    );
    return res.data.pullRequests;
  },

  create: async (
    ticketId: string,
    payload: CreateTicketPrPayload,
  ): Promise<TicketPullRequest> => {
    const res = await apiInstance.post<{ pullRequest: TicketPullRequest }>(
      `/tickets/${ticketId}/pull-requests`,
      payload,
    );
    return res.data.pullRequest;
  },

  link: async (ticketId: string, pullRequestUrl: string): Promise<TicketPullRequest> => {
    const res = await apiInstance.post<{ pullRequest: TicketPullRequest }>(
      `/tickets/${ticketId}/pull-requests/link`,
      { pullRequestUrl },
    );
    return res.data.pullRequest;
  },

  refresh: async (ticketId: string, pullRequestId: string): Promise<TicketPullRequest> => {
    const res = await apiInstance.post<{ pullRequest: TicketPullRequest }>(
      `/tickets/${ticketId}/pull-requests/${pullRequestId}/refresh`,
    );
    return res.data.pullRequest;
  },

  unlink: async (ticketId: string, pullRequestId: string): Promise<void> => {
    await apiInstance.delete(`/tickets/${ticketId}/pull-requests/${pullRequestId}`);
  },
};
