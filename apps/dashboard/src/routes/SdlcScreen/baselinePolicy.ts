export type BaselineApprovalAction = 'APPROVE' | 'REAPPROVE' | 'UP_TO_DATE';

function timestamp(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function baselineApprovalAction(input: {
  approvedAt?: string | null;
  lastEditedAt?: number | null;
}): BaselineApprovalAction {
  const approvedAt = timestamp(input.approvedAt);
  if (approvedAt === null) return 'APPROVE';
  const lastEditedAt = timestamp(input.lastEditedAt);
  return lastEditedAt !== null && lastEditedAt > approvedAt ? 'REAPPROVE' : 'UP_TO_DATE';
}
