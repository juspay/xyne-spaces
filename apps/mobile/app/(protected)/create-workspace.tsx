import { useCallback, type ReactElement } from 'react';
import { useRouter } from 'expo-router';

import { tabRoute } from '@/src/navigation/routes';
import { CreateWorkspaceScreen } from '@/src/components/workspace-drawer';

export default function CreateWorkspaceRoute(): ReactElement {
  const router = useRouter();

  /**
   * Dismiss only, and only for an explicit close. The drawer's open state lives
   * in the tab tree this page is stacked over, so it is still open underneath
   * and the user lands back on it.
   *
   * There is no success handler on purpose: creating a workspace applies a new
   * session, which remounts the shell and takes this page with it. Calling
   * `back()` there would race that remount, and the fresh stack has nothing to
   * go back to — the fallback `replace` would drop the user on DMs regardless
   * of which tab they started from.
   */
  const handleClose = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(tabRoute('dms'));
  }, [router]);

  return <CreateWorkspaceScreen onClose={handleClose} />;
}
