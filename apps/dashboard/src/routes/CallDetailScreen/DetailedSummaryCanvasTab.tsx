import { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { ReadOnlyCanvasTab } from './ReadOnlyCanvasTab';

export function DetailedSummaryCanvasTab({ canvasId }: { canvasId: string }): ReactElement {
  const { t } = useTranslation('placeholders');
  return (
    <ReadOnlyCanvasTab
      canvasId={canvasId}
      loadingLabel='Loading detailed summary...'
      placeholder={t('routes.callDetailScreen.detailedSummaryPlaceholder')}
    />
  );
}
