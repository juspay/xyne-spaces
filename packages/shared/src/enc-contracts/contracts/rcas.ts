import { z } from 'zod';
import { COEStatus, RCAStatus, SEVERITY } from '../../zero/types.js';
import { defineRequestContract } from '../define.js';
import { derive } from '../extractors.js';
import { unreadableString } from '../unreadable-string.js';

/**
 * Zero mutators `rca.*`, `impact.*`, `coe.*`. The client encrypts the RCA's `title`, `summary`,
 * `rootCause`, the impact text and the COE action; all are stored as received. `rca.create`
 * lists one fact for `summary` and `rootCause` so that "no facts" means empty, which is how
 * `x || null` is kept.
 */
export const rcaCreateClient = defineRequestContract({
  sourceToDerived: {
    title: {},
    summary: { textLength: derive.textLength },
    rootCause: { textLength: derive.textLength },
  },
  schema: z.object({
    id: z.string(),
    ticketId: z.string(),
    ownerId: z.string().optional(),
    title: unreadableString(),
    summary: unreadableString().optional(),
    rootCause: unreadableString().optional(),
    severity: z.nativeEnum(SEVERITY),
    bugTypeId: z.string(),
    categoryTypeId: z.string(),
    issueCategoryId: z.string().optional(),
    issueStartAt: z.number().optional().nullable(),
    status: z.nativeEnum(RCAStatus),
    timestamp: z.number(),
  }),
});

export const rcaUpdateClient = defineRequestContract({
  sourceToDerived: { title: {}, summary: {}, rootCause: {} },
  schema: z.object({
    id: z.string(),
    ticketId: z.string().optional(),
    title: unreadableString().optional(),
    summary: unreadableString().optional(),
    rootCause: unreadableString().optional(),
    severity: z.nativeEnum(SEVERITY).optional(),
    bugTypeId: z.string().optional(),
    categoryTypeId: z.string().optional(),
    issueCategoryId: z.string().optional(),
    issueStartAt: z.number().optional().nullable(),
    status: z.nativeEnum(RCAStatus).optional(),
    timestamp: z.number(),
  }),
});

export const impactCreateClient = defineRequestContract({
  sourceToDerived: { impact: {} },
  schema: z.object({
    id: z.string(),
    ticketId: z.string(),
    impactTypeId: z.string(),
    impact: unreadableString(),
    rcaId: z.string(),
    timestamp: z.number(),
  }),
});

export const impactUpdateClient = defineRequestContract({
  sourceToDerived: { impact: {} },
  schema: z.object({
    id: z.string(),
    impactTypeId: z.string().optional(),
    impact: unreadableString().optional(),
  }),
});

export const coeCreateClient = defineRequestContract({
  sourceToDerived: { action: {} },
  schema: z.object({
    id: z.string(),
    rcaId: z.string(),
    ownerId: z.string(),
    actionTypeId: z.string(),
    action: unreadableString(),
    status: z.nativeEnum(COEStatus),
    dueDate: z.number().optional(),
    timestamp: z.number(),
  }),
});

export const coeUpdateClient = defineRequestContract({
  sourceToDerived: { action: {} },
  schema: z.object({
    id: z.string(),
    ownerId: z.string().optional(),
    actionTypeId: z.string().optional(),
    action: unreadableString().optional(),
    status: z.nativeEnum(COEStatus).optional(),
    dueDate: z.number().optional(),
    completedAt: z.number().optional(),
  }),
});
