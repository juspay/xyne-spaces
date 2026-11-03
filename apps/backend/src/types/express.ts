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


export interface AuthenticatedUser {
  id: string;
  googleId: string;
  email: string;
  name: string;
  displayName?: string | null;
  workspaceId: string;
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
