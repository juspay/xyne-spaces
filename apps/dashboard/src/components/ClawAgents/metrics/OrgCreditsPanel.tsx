import { ReactElement } from 'react';
import { OrgRole } from '@xyne/shared';
import { useCachedQuery } from '@/hooks/useCachedQuery';
import { useSelf } from '@/hooks/useUsers';
import { queries } from '@/zero/queries';
import { AiUsageCard } from './AiUsageCard';
import { OrgCouponSection } from './OrgCouponSection';

// Owners and admins see the coupon card and the org's usage; every member sees their own usage.
export const OrgCreditsPanel = (): ReactElement | null => {
  const self = useSelf();
  const workspaceId = self?.workspaceId ?? '';
  const memberId = self?.orgMemberId ?? '';

  const [workspace] = useCachedQuery(queries.getWorkspaceById({ workspaceId }), {
    enabled: !!workspaceId,
  });
  const [member] = useCachedQuery(queries.getOrgMemberById({ memberId }), {
    enabled: !!memberId,
  });

  const orgId = workspace?.orgId;
  const { orgId: memberOrgId, role } = (member ?? {}) as { orgId?: string; role?: string };
  const canApply = role === OrgRole.OWNER || role === OrgRole.ADMIN;

  if (!orgId || memberOrgId !== orgId) return null;
  return (
    <>
      {canApply && <OrgCouponSection orgId={orgId} />}
      <AiUsageCard orgId={orgId} showOrg={canApply} />
    </>
  );
};
