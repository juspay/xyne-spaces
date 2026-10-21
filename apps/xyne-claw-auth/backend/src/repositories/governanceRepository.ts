import type { Prisma } from "@prisma/client";
import { governancePrisma as db } from "../db.js";

export const governanceAuditEventRepository = {
  create: (data: Prisma.GovernanceAuditEventCreateInput) => db.governanceAuditEvent.create({ data }),
  createMany: (data: Prisma.GovernanceAuditEventCreateManyInput[]) => db.governanceAuditEvent.createMany({ data, skipDuplicates: true }),
  findToolCall: (orgId: string, runId: string, toolCallId: string) =>
    db.governanceAuditEvent.findFirst({ where: { orgId, runId, toolCallId, eventType: "tool_call" } }),
  orgsWithUnchained: () =>
    db.governanceAuditEvent.findMany({ where: { orgSequence: null }, distinct: ["orgId"], select: { orgId: true }, take: 100 }),
  unchained: (orgId: string, take: number) =>
    db.governanceAuditEvent.findMany({ where: { orgId, orgSequence: null }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }], take }),
  lastChained: (orgId: string) =>
    db.governanceAuditEvent.findFirst({ where: { orgId, orgSequence: { not: null } }, orderBy: { orgSequence: "desc" } }),
  // The null guard loses the race against another pod's sequencer; the unique (orgId, orgSequence) key stops a fork.
  chain: (id: string, orgSequence: number, previousRowSha256: string | null, rowSha256: string) =>
    db.governanceAuditEvent.updateMany({ where: { id, orgSequence: null }, data: { orgSequence, previousRowSha256, rowSha256 } }),
  chained: (orgId: string, fromSequence: number, take: number) =>
    db.governanceAuditEvent.findMany({ where: { orgId, orgSequence: { gte: fromSequence } }, orderBy: { orgSequence: "asc" }, take }),
};

export const staticContentVersionRepository = {
  findByHash: (orgId: string, subjectKey: string, contentSha256: string) =>
    db.staticContentVersion.findUnique({ where: { orgId_subjectKey_contentSha256: { orgId, subjectKey, contentSha256 } } }),
  create: (data: Prisma.StaticContentVersionCreateInput) => db.staticContentVersion.create({ data }),
  update: (id: string, data: Prisma.StaticContentVersionUpdateInput) => db.staticContentVersion.update({ where: { id }, data }),
};

export const contentScanFindingRepository = {
  createMany: (data: Prisma.ContentScanFindingCreateManyInput[]) => db.contentScanFinding.createManyAndReturn({ data, select: { id: true } }),
};
