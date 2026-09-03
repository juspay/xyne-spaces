import { Request, Response } from 'express';

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  timestamp: string;
}

export interface HealthCheckResponse {
  status: string;
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
  memory: {
    used: number;
    total: number;
  };
  database?: {
    status: string;
    connected: boolean;
  };
  commonDatabase?: {
    status: string;
    connected: boolean;
  };
}

export interface CustomRequest extends Request {
  startTime?: number;
  requestId?: string;
}

export interface CustomResponse extends Response {
  locals: {
    requestId?: string;
  };
}


// API Key Authentication Extensions
export interface AuthenticatedUser {
  id: string;
  googleId: string;
  email: string;
  name: string;
  displayName?: string | null;
  workspaceId: string;
  isApiKeyUser?: boolean;
  scopes?: string[];
  role: string;
  orgRole: string;
  memberId: string;
  authProvider?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      authenticatedSessionId?: string;
    }
  }
}

// API Key Types and Interfaces
export interface ApiKeyConfig {
  user_id: string;
  username: string;
  role: 'admin' | 'user';
  email: string;
  scopes: string[];
  description?: string;
  created_at?: string;
  expires_at?: string;
}

export interface ApiKeyConfigMap {
  [key: string]: ApiKeyConfig;
}

export interface ApiKeyUser {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'user';
  scopes: string[];
  isApiKeyUser: true;
  apiKeyName?: string;
  workspaceId: string;
  orgRole: string;
  memberId: string;
}

export interface CreateApiKeyRequest {
  name: string;
  description?: string;
  scopes: string[];
  expiresInDays?: number;
}

export interface CreateApiKeyResponse {
  id: string;
  name: string;
  apiKey: string; // base64 encoded
  scopes: string[];
  expiresAt?: string;
  createdAt: string;
}

export interface ApiKeyListItem {
  id: string;
  name: string;
  description?: string;
  scopes: string[];
  createdAt: string;
  expiresAt?: string;
  lastUsed?: string;
  isActive: boolean;
}

export enum ApiKeyScope {
  // Ticket scopes
  TICKETS_READ = 'tickets:read',
  TICKETS_WRITE = 'tickets:write',
  TICKETS_DELETE = 'tickets:delete',
  
  // Workflow scopes
  WORKFLOWS_READ = 'workflows:read',
  WORKFLOWS_WRITE = 'workflows:write',
  WORKFLOWS_EXECUTE = 'workflows:execute',
  
  // Analytics scopes
  ANALYTICS_READ = 'analytics:read',
  
  // Agent scopes
  AGENTS_READ = 'agents:read',
  AGENTS_WRITE = 'agents:write',
  
  // Admin scopes
  ADMIN_USERS = 'admin:users',
  ADMIN_API_KEYS = 'admin:api_keys',
  ADMIN_SYSTEM = 'admin:system',
}

export const API_KEY_SCOPES = Object.values(ApiKeyScope);

export const SCOPE_DESCRIPTIONS: Record<ApiKeyScope, string> = {
  [ApiKeyScope.TICKETS_READ]: 'Read access to tickets and ticket data',
  [ApiKeyScope.TICKETS_WRITE]: 'Create and update tickets',
  [ApiKeyScope.TICKETS_DELETE]: 'Delete tickets',
  [ApiKeyScope.WORKFLOWS_READ]: 'Read access to workflows',
  [ApiKeyScope.WORKFLOWS_WRITE]: 'Create and update workflows',
  [ApiKeyScope.WORKFLOWS_EXECUTE]: 'Execute workflow operations',
  [ApiKeyScope.ANALYTICS_READ]: 'Read access to analytics and reports',
  [ApiKeyScope.AGENTS_READ]: 'Read access to agents and tools',
  [ApiKeyScope.AGENTS_WRITE]: 'Create and update agents and tools',
  [ApiKeyScope.ADMIN_USERS]: 'Manage users and permissions',
  [ApiKeyScope.ADMIN_API_KEYS]: 'Manage API keys',
  [ApiKeyScope.ADMIN_SYSTEM]: 'System administration access',
};

export interface RawBodyRequest extends Request {
  rawBody: string;
}

// ---------------------------------------------------------------------------
// Call Lobby — shared between routes/callLobby.ts and controllers/callLobbyController.ts
// ---------------------------------------------------------------------------

export interface CallLobbyCall {
  callId: string;
  title: string | null;
  callType: string;
  status: string;
  createdByUserId: string;
  roomName: string;
}

export interface CallLobbySession {
  participantId: string;
  response: string;
}

export interface CallLobbyRequest extends Request {
  call: CallLobbyCall;
  callSession: CallLobbySession | null;
  /** Set by requireCallParticipant — the authenticated participant's userId */
  callParticipantId?: string;
}
