import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { useRouterSelector, useStableNavigate } from './useStableRouter';

/**
 * Whether a page's dialog is open. Xyne Buddy opens one with `?dialog=<name>`; the param is then
 * removed, so a refresh does not reopen it.
 */
export function useDialogParam(name: string): [boolean, Dispatch<SetStateAction<boolean>>] {
  const [open, setOpen] = useState(false);
  const navigate = useStableNavigate();
  const pathname = useRouterSelector(snapshot => snapshot.location.pathname);
  const opens = useRouterSelector(
    snapshot => new URLSearchParams(snapshot.location.search).get('dialog') === name,
  );
  useEffect(() => {
    if (!opens) return;
    setOpen(true);
    void navigate(pathname, { replace: true });
  }, [opens, navigate, pathname]);
  return [open, setOpen];
}
