import { createContext, useContext } from "react";

export interface AdminStatusContextValue {
  isAdmin: boolean;
  isAdminLoading: boolean;
  /** CLAW_ADMIN or the narrower SEARCH_EVAL_ACCESS role — see backend hasSearchEvalAccess(). */
  hasSearchEvalAccess: boolean;
}

export const AdminStatusContext = createContext<AdminStatusContextValue>({
  isAdmin: false,
  isAdminLoading: true,
  hasSearchEvalAccess: false,
});

export function useAdminStatus(): AdminStatusContextValue {
  return useContext(AdminStatusContext);
}
