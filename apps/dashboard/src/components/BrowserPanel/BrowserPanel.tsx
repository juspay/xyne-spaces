import { useSelector } from '@xstate/react';
import { browserPanelActor } from '../../machines/browserPanelMachine';
import { BrowserTabsScreen } from '../../routes/BrowserTabsScreen';

export function BrowserPanel(): React.ReactElement {
  const pendingUrls = useSelector(browserPanelActor, state => state.context.pendingUrls);

  return <BrowserTabsScreen variant='panel' pendingUrls={pendingUrls} />;
}
