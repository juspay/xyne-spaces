import { useSelector } from '@xstate/react';
import { ReactElement, useEffect, useMemo } from 'react';
import { useAllUnreadCount } from '../../hooks/useUnreadCount';
import { useIsInPanelWebview } from '../../hooks/useIsInPanelWebview';
import { documentTitleActor, formatDocumentTitle } from '../../machines/documentTitleMachine';

export const DocumentTitleSync = (): ReactElement | null => {
  const unreadCounts = useAllUnreadCount();
  const isInPanelWebview = useIsInPanelWebview();
  const title = useSelector(documentTitleActor, snapshot => formatDocumentTitle(snapshot.context));

  const unreadTotal = useMemo(
    () => Object.values(unreadCounts).reduce((sum, count) => sum + (count > 0 ? count : 0), 0),
    [unreadCounts],
  );

  useEffect(() => {
    documentTitleActor.send({
      type: 'SET_SCOPE',
      scope: isInPanelWebview ? 'panel-webview' : 'main',
    });
  }, [isInPanelWebview]);

  useEffect(() => {
    documentTitleActor.send({ type: 'SET_BADGE_COUNT', count: unreadTotal });
  }, [unreadTotal]);

  useEffect(() => {
    if (document.title !== title) {
      document.title = title;
    }
  }, [title]);

  return null;
};
