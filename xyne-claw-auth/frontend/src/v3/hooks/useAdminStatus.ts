import { createContext, useContext } from "react";

export interface AdminStatusContextValue {
  isAdmin: boolean;
  isAdminLoading: boolean;
}

export const AdminStatusContext = createContext<AdminStatusContextValue>({
  isAdmin: false,
  isAdminLoading: true,
});

export function useAdminStatus(): AdminStatusContextValue {
  return useContext(AdminStatusContext);
}
