import { useMemo, useState, type ReactElement } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronDown } from '@xyne/icons';
import type { User } from '@xyne/shared/machines';
import { SearchableMultiSelect } from '../../../components/ui/SearchableMultiSelect/SearchableMultiSelect';
import type { SearchableMultiSelectOption } from '../../../components/ui/SearchableMultiSelect/SearchableMultiSelect.types';
import Avatar from '../../../components/ui/Avatar/Avatar';
import { cn } from '../../../utils/classNames';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { LIST_TAB_CLASS_NAME } from '../utils/RecordingsV2.utils';

interface RecordingSharedWithMeTabProps {
  isActive: boolean;
  /** Called when the tab should become the active ownership scope. */
  onActivate: () => void;
  /** People who shared the currently loaded recordings. */
  sharers: User[];
  selectedSharerIds: string[];
  onSelectedSharerIdsChange: (sharerIds: string[]) => void;
}

/**
 * Ownership tab that doubles as a "shared by" picker: it looks like a plain tab
 * until it is selected and somebody has shared a recording, and only then reveals
 * the chevron and selection count.
 */
export function RecordingSharedWithMeTab({
  isActive,
  onActivate,
  sharers,
  selectedSharerIds,
  onSelectedSharerIdsChange,
}: RecordingSharedWithMeTabProps): ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  const options = useMemo<SearchableMultiSelectOption[]>(
    () =>
      sharers.map(sharer => ({
        value: sharer.id,
        label: getUserDisplayName(sharer),
        icon: (
          <Avatar
            userId={sharer.id}
            size='sm'
            showActiveStatus={false}
            className='size-5 shrink-0 rounded-full'
          />
        ),
      })),
    [sharers],
  );

  const hasSharers = options.length > 0;

  const handleOpenChange = (open: boolean): void => {
    if (!open) {
      setIsOpen(false);
      return;
    }
    if (!isActive) {
      onActivate();
      return;
    }
    if (hasSharers) setIsOpen(true);
  };

  return (
    <SearchableMultiSelect
      options={options}
      selectedValues={selectedSharerIds}
      onSelectedValuesChange={onSelectedSharerIdsChange}
      isOpen={isOpen}
      onOpenChange={handleOpenChange}
      searchAriaLabel='Search people who shared recordings with you'
      listAriaLabel='People who shared recordings with you'
      emptyMessage='No people found'
      trackCategory='RecordingsV2'
      trackName='toggle_shared_by_filter'
      trigger={
        <button
          type='button'
          aria-pressed={isActive}
          className={cn(
            LIST_TAB_CLASS_NAME,
            'gap-1.5',
            isActive
              ? 'bg-background text-foreground font-medium'
              : 'text-muted-foreground/80 hover:text-foreground',
          )}
          aria-label={
            isActive && selectedSharerIds.length > 0
              ? `Shared with me, ${selectedSharerIds.length} people selected`
              : 'Shared with me'
          }
          data-track-category='RecordingsV2'
          data-track-name='show_shared_with_me'
        >
          Shared with me
          {isActive && selectedSharerIds.length > 0 && (
            <span className='flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-xs font-semibold leading-none tabular-nums text-background pt-0.5'>
              {selectedSharerIds.length}
            </span>
          )}
          {/* Widening as it fades keeps the label from jumping when the chevron
              arrives, and one rotating icon reads as a flip where swapping an up
              icon for a down one just blinked. */}
          <AnimatePresence initial={false}>
            {isActive && hasSharers && (
              <motion.span
                initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.6, width: 0 }}
                animate={{ opacity: 1, scale: 1, width: 16 }}
                exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.6, width: 0 }}
                transition={{ duration: shouldReduceMotion ? 0 : 0.16, ease: [0.22, 1, 0.36, 1] }}
                className='flex shrink-0 items-center justify-center overflow-hidden'
                aria-hidden='true'
              >
                <motion.span
                  className='flex'
                  animate={{ rotate: isOpen ? 180 : 0 }}
                  transition={{ duration: shouldReduceMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
                >
                  <ChevronDown className='size-4 text-muted-foreground' />
                </motion.span>
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      }
    />
  );
}
