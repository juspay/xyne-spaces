import { Request, Response } from 'express';
import type { DerivedFacts, RequestContract, RequestOf } from '@xyne/shared';

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
  /** auth_sessions.id from the JWT `sid` claim. */
  sid?: string;
  /** JWT `exp` in epoch ms; the dashboard refreshes shortly before it. */
  tokenExpiresAt?: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      /** Facts the encryption service extracted from this request's encrypted fields. */
      derived?: DerivedFacts;
      /**
       * The verified access token the request authenticated with (authMiddleware): forwarded
       * to the encryption service, which reads its `sid` and uses the session's registered
       * transit key (transitCaller).
       */
      authToken?: string;
      /**
       * Set by authenticateApp when the request was relayed by a Xyne Apps gateway
       * (`x-xyne-apps-client: <role>;<version>`). The encryption service then encrypts to the
       * gateway key pinned for that role and version, never to a key the request names.
       */
      appsClient?: { role: 'ingress' | 'egress'; version: number };
    }
  }
}

export interface RawBodyRequest extends Request {
  rawBody: string;
}

/**
 * What a handler on a contracted route receives: the contract's RequestOf (body as the
 * client sends it, derived facts the contract names) on the Express request.
 */
export type ContractRequest<C extends RequestContract> = Request<Request['params'], unknown, RequestOf<C>['body']> &
  Pick<RequestOf<C>, 'derived'>;

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
