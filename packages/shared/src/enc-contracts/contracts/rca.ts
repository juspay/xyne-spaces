import { z } from 'zod';
import { COEStatus, RCAStatus, SEVERITY } from '../../zero/types.js';
import { defineRequestContract, type RequestOf } from '../define.js';

/**
 * RCA mutators. Every text field is stored as sent; the mutators derive nothing from it. The
 * text is read later by the RCA Vespa indexer and the "RCA created/updated" system messages,
 * which are direct consumers tracked separately.
 */
export const rcaCreateClient = defineRequestContract({
  encrypted: ['title', 'summary', 'rootCause'],
  derived: [],
  schema: z.object({
    id: z.string(),
    ticketId: z.string(),
    ownerId: z.string().optional(),
    title: z.string(),
    summary: z.string().optional(),
    rootCause: z.string().optional(),
    severity: z.nativeEnum(SEVERITY),
    bugTypeId: z.string(),
    categoryTypeId: z.string(),
    issueCategoryId: z.string().optional(),
    issueStartAt: z.number().optional().nullable(),
    status: z.nativeEnum(RCAStatus),
    timestamp: z.number(),
  }),
});

export type RcaCreateRequest = RequestOf<typeof rcaCreateClient>;

export const rcaUpdateClient = defineRequestContract({
  encrypted: ['title', 'summary', 'rootCause'],
  derived: [],
  schema: z.object({
    id: z.string(),
    ticketId: z.string().optional(),
    title: z.string().optional(),
    summary: z.string().optional(),
    rootCause: z.string().optional(),
    severity: z.nativeEnum(SEVERITY).optional(),
    bugTypeId: z.string().optional(),
    categoryTypeId: z.string().optional(),
    issueCategoryId: z.string().optional(),
    issueStartAt: z.number().optional().nullable(),
    status: z.nativeEnum(RCAStatus).optional(),
    timestamp: z.number(),
  }),
});

export type RcaUpdateRequest = RequestOf<typeof rcaUpdateClient>;

export const impactCreateClient = defineRequestContract({
  encrypted: ['impact'],
  derived: [],
  schema: z.object({
    id: z.string(),
    ticketId: z.string(),
    impactTypeId: z.string(),
    impact: z.string(),
    rcaId: z.string(),
    timestamp: z.number(),
  }),
});

export type ImpactCreateRequest = RequestOf<typeof impactCreateClient>;

export const impactUpdateClient = defineRequestContract({
  encrypted: ['impact'],
  derived: [],
  schema: z.object({
    id: z.string(),
    impactTypeId: z.string().optional(),
    impact: z.string().optional(),
  }),
});

export type ImpactUpdateRequest = RequestOf<typeof impactUpdateClient>;

export const coeCreateClient = defineRequestContract({
  encrypted: ['action'],
  derived: [],
  schema: z.object({
    id: z.string(),
    rcaId: z.string(),
    ownerId: z.string(),
    actionTypeId: z.string(),
    action: z.string(),
    status: z.nativeEnum(COEStatus),
    dueDate: z.number().optional(),
    timestamp: z.number(),
  }),
});

export type CoeCreateRequest = RequestOf<typeof coeCreateClient>;

export const coeUpdateClient = defineRequestContract({
  encrypted: ['action'],
  derived: [],
  schema: z.object({
    id: z.string(),
    ownerId: z.string().optional(),
    actionTypeId: z.string().optional(),
    action: z.string().optional(),
    status: z.nativeEnum(COEStatus).optional(),
    dueDate: z.number().optional(),
    completedAt: z.number().optional(),
  }),
});

export type CoeUpdateRequest = RequestOf<typeof coeUpdateClient>;
