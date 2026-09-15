import { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { ReadOnlyCanvasTab } from './ReadOnlyCanvasTab';

export function PrdCanvasTab({ canvasId }: { canvasId: string }): ReactElement {
  const { t } = useTranslation('placeholders');
  return (
    <ReadOnlyCanvasTab
      canvasId={canvasId}
      loadingLabel='Loading PRD...'
      placeholder={t('routes.callDetailScreen.prdPlaceholder')}
    />
  );
}
