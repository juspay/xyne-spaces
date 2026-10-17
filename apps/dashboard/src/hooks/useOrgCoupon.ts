import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { API_BASE_URL } from '../config';
import { apiInstance } from '../services/clients/apiClient';

export interface AppliedOrgCoupon {
  code: string;
  amountUsd: number;
  appliedAt: string;
}

interface OrgCouponState {
  applied: AppliedOrgCoupon | null;
}

const orgCouponKey = (orgId: string): [string, string] => ['org-coupon', orgId];

/** Checks a typed coupon on the pre-login create-org screen; resolves to the credit amount, or null when invalid. */
export const validateCoupon = async (code: string): Promise<number | null> => {
  try {
    const response = await axios.post<{ amountUsd: number }>(
      `${API_BASE_URL}/auth/org-coupon/validate`,
      { code },
    );
    return response.data.amountUsd;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 400) return null;
    throw error;
  }
};

export const useOrgCoupon = (
  orgId: string,
): {
  state: OrgCouponState | undefined;
  apply: (code: string) => Promise<void>;
  isApplying: boolean;
} => {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: orgCouponKey(orgId),
    queryFn: async () => {
      const response = await apiInstance.get<OrgCouponState>(`/organizations/${orgId}/coupon`);
      return response.data;
    },
    enabled: !!orgId,
  });
  const mutation = useMutation({
    mutationFn: async (code: string) => {
      await apiInstance.post(`/organizations/${orgId}/coupon`, { code });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orgCouponKey(orgId) }),
  });

  return {
    state: data,
    apply: async (code: string): Promise<void> => {
      await mutation.mutateAsync(code);
    },
    isApplying: mutation.isPending,
  };
};
