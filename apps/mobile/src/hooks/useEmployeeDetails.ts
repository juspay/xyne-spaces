import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@/src/services/apiClient';

/* eslint-disable @typescript-eslint/naming-convention -- Mettle's existing API contract is snake_case. */
type EmployeeDetails = {
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
};
/* eslint-enable @typescript-eslint/naming-convention */

const useEmployeeDetails = (email: string | undefined): EmployeeDetails | undefined => {
  const query = useQuery({
    queryKey: ['employee-details', email],
    queryFn: () =>
      apiGet<EmployeeDetails>(`/mettle/employee/details?email=${encodeURIComponent(email ?? '')}`),
    enabled: Boolean(email),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  return query.data;
};

export { useEmployeeDetails };
export type { EmployeeDetails };
