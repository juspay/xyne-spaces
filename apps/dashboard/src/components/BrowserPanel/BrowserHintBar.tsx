import { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { useMeasure } from 'react-use';

interface BrowserHintBarProps {
  isMac: boolean;
  onOpenPreferences: () => void;
  onDismiss: () => void;
}

export function BrowserHintBar({
  isMac,
  onOpenPreferences,
  onDismiss,
}: BrowserHintBarProps): ReactElement {
  const { t } = useTranslation('common');
  const [containerRef, bounds] = useMeasure<HTMLDivElement>();
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      className='overflow-hidden'
      initial={{ height: 0, opacity: 0 }}
      animate={bounds.height ? { height: bounds.height, opacity: 1 } : { opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={
        shouldReduceMotion
          ? { duration: 0.15 }
          : {
              height: { type: 'spring', duration: 0.2, bounce: 0 },
              opacity: { duration: 0.12 },
            }
      }
    >
      <div ref={containerRef}>
        <div className='flex items-start gap-2 bg-muted border-b border-border px-3 py-1'>
          <p className='min-w-0 flex-1 text-[11px] leading-4 text-muted-foreground'>
            {t('browserPanel.hintBar.clickToOpenExternally', {
              modifier: isMac ? '⌘' : 'Ctrl',
            })}{' '}
            <button
              type='button'
              onClick={onOpenPreferences}
              className='underline underline-offset-2 transition-colors hover:text-foreground'
              data-track-category='BROWSER'
              data-track-name='OpenLinkPreferences'
            >
              {t('browserPanel.hintBar.changeDefaultInPreferences')}
            </button>
          </p>
          <button
            type='button'
            aria-label={t('browserPanel.hintBar.dismiss')}
            title={t('browserPanel.hintBar.dismiss')}
            onClick={onDismiss}
            className='mt-px shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-border hover:text-foreground'
            data-track-category='BROWSER'
            data-track-name='DismissLinkHint'
          >
            <X size={12} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
