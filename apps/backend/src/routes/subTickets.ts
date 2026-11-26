import express from 'express';
import { API } from '@xyne/shared';
import { api } from '@/framework/api';
import { linkSubTicket, unlinkSubTicketHandler } from '@/handlers/workspace';

// Typed routes (API.subTickets), served by the API router behind the contract gate.
api.routes(API.subTickets, (serve) => ({
  link: serve('link', { successStatus: 201, handle: ({ body, user }) => linkSubTicket({ body, user }) }),
  unlink: serve('unlink', { successStatus: 204, handle: ({ body, user }) => unlinkSubTicketHandler({ body, user }) }),
}));

// Nothing untyped left under /api/sub-tickets.
const router = express.Router();
export default router;
