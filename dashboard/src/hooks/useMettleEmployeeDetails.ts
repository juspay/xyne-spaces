import { useQuery } from '@tanstack/react-query';
import { apiInstance } from '../services/clients/apiClient';

export interface MettleEmployeeDetailsResponse {
  assigned_emp_id: string | null;
  current_landmark: string | null;
  current_location: string | null;
  email: string;
  employee_status: string;
  in_office: string | null;
  last_seen_at: string | null;
  location: string | null;
  name: string;
  work_mode: string | null;
}

export const useMettleEmployeeDetails = (
  email: string | undefined,
): {
  data: MettleEmployeeDetailsResponse | undefined;
  isLoading: boolean;
} => {
  const { data, isLoading } = useQuery<MettleEmployeeDetailsResponse | undefined>({
    queryKey: ['mettle-employee-details', email],
    queryFn: async () => {
      if (!email) return undefined;

      const response = await apiInstance.get<MettleEmployeeDetailsResponse>(
        '/mettle/employee/details',
        {
          params: { email },
        },
      );

      return response.data;
    },
    enabled: Boolean(email),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  return { data, isLoading };
};
