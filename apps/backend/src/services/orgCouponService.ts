import type { Prisma } from '@prisma/client';
import { config } from '@/config/env';
import { DatabaseClient } from '@/database/client';

const COUPON_PATTERN = /^XYNE(\d{1,6})$/;

export interface OrgCoupon {
  code: string;
  amountUsd: number;
}

export interface AppliedOrgCoupon extends OrgCoupon {
  appliedAt: string;
  appliedBy: string;
}

export class OrgCouponError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = 'OrgCouponError';
  }
}

class OrgCouponService {
  private prisma = DatabaseClient.getInstance();

  /** The coupon currently configured in env, or null when unset or malformed. */
  getActiveCoupon(): OrgCoupon | null {
    const code = config.aiProvisioning.couponCode.trim();
    const match = COUPON_PATTERN.exec(code);
    if (!match) return null;
    const amountUsd = Number(match[1]);
    return amountUsd > 0 ? { code, amountUsd } : null;
  }

  /** Resolves user input against the env coupon; throws a 400 when it does not match. */
  validate(input: string): OrgCoupon {
    const active = this.getActiveCoupon();
    if (!active || input.trim() !== active.code) {
      throw new OrgCouponError('Invalid coupon code', 400);
    }
    return active;
  }

  async getApplied(orgId: string): Promise<AppliedOrgCoupon | null> {
    const org = await this.prisma.organization.findUnique({
      where: { orgId },
      select: { metadata: true },
    });
    return readApplied(org?.metadata);
  }

  /**
   * Stores the coupon on the org. One coupon per org: re-applying the same
   * amount is a no-op, anything else is rejected. The amount is frozen at
   * apply time, so later env changes only affect orgs that apply afterwards.
   */
  async apply(
    orgId: string,
    coupon: OrgCoupon,
    appliedBy: string
  ): Promise<{ applied: AppliedOrgCoupon }> {
    const org = await this.prisma.organization.findUnique({
      where: { orgId },
      select: { metadata: true },
    });
    if (!org) throw new OrgCouponError('Organization not found', 404);

    const existing = readApplied(org.metadata);
    if (existing) {
      if (existing.amountUsd === coupon.amountUsd) {
        return { applied: existing };
      }
      throw new OrgCouponError('A coupon has already been applied to this organization', 409);
    }

    const applied: AppliedOrgCoupon = {
      ...coupon,
      appliedAt: new Date().toISOString(),
      appliedBy,
    };
    const base =
      org.metadata && typeof org.metadata === 'object' && !Array.isArray(org.metadata)
        ? (org.metadata as Record<string, unknown>)
        : {};
    await this.prisma.organization.update({
      where: { orgId },
      data: { metadata: { ...base, aiCoupon: { ...applied } } as Prisma.InputJsonObject },
    });
    return { applied };
  }
}

function readApplied(metadata: unknown): AppliedOrgCoupon | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const value = (metadata as Record<string, unknown>).aiCoupon as
    | Partial<AppliedOrgCoupon>
    | undefined;
  if (!value || typeof value.amountUsd !== 'number' || typeof value.code !== 'string') {
    return null;
  }
  return {
    code: value.code,
    amountUsd: value.amountUsd,
    appliedAt: value.appliedAt ?? '',
    appliedBy: value.appliedBy ?? '',
  };
}

export const orgCouponService = new OrgCouponService();
