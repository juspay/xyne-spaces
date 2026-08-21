import type { ReactElement } from 'react';
import { Dialog } from '../ui/Dialog';
import { getShortcutsByCategory, formatShortcut } from '../../shortcuts';
import { X, Keyboard } from 'lucide-react';
import { usePlatform } from '../../hooks/usePlatform';
import { isElectronApp } from '../../utils/electronApp';

// Category order for consistent display
const CATEGORY_ORDER = ['Navigation', 'Messages', 'Composer', 'Canvas', 'Huddle', 'Sidebar'];

// Categories to exclude from the modal
const EXCLUDED_CATEGORIES = ['Viewer'];

interface ShortcutsHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ShortcutsHelpModal = ({ isOpen, onClose }: ShortcutsHelpModalProps): ReactElement => {
  const { isMac } = usePlatform();
  const shortcuts = getShortcutsByCategory();

  // Filter out shortcuts without descriptions and excluded categories
  const filteredShortcuts = Object.entries(shortcuts).reduce(
    (acc, [category, items]) => {
      if (EXCLUDED_CATEGORIES.includes(category)) return acc;
      const filtered = items.filter(
        item => item.description && (!item.electronOnly || isElectronApp()),
      );
      if (filtered.length > 0) {
        acc[category] = filtered;
      }
      return acc;
    },
    {} as Record<string, (typeof shortcuts)[string]>,
  );

  // Sort categories by predefined order
  const sortedCategories = Object.entries(filteredShortcuts).sort(([a], [b]) => {
    const aIndex = CATEGORY_ORDER.indexOf(a);
    const bIndex = CATEGORY_ORDER.indexOf(b);
    if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });

  return (
    <Dialog
      open={isOpen}
      onOpenChange={onClose}
      title='Keyboard Shortcuts'
      className='max-w-2xl w-[90vw]'
    >
      <div className='flex flex-col max-h-[80vh]'>
        {/* Header */}
        <div className='flex items-center justify-between px-6 py-4 border-b border-border dark:border-gray-700'>
          <div className='flex items-center gap-3'>
            <div className='p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg'>
              <Keyboard className='w-5 h-5 text-blue-600 dark:text-blue-400' />
            </div>
            <div>
              <h2 className='text-lg font-semibold text-foreground dark:text-gray-100'>
                Keyboard Shortcuts
              </h2>
              <p className='text-sm text-muted-foreground dark:text-muted-foreground'>
                Quick actions to boost your productivity
              </p>
            </div>
          </div>
          <button
            onClick={() => onClose()}
            className='p-2 text-muted-foreground hover:text-muted-foreground dark:hover:text-muted hover:bg-muted dark:hover:bg-gray-700 rounded-lg transition-colors'
            aria-label='Close'
            data-track-category='Help'
            data-track-name='CloseShortcutsModal'
          >
            <X className='w-5 h-5' />
          </button>
        </div>

        {/* Content */}
        <div className='flex-1 overflow-y-auto px-6 py-4'>
          <div className='grid grid-cols-1 md:grid-cols-2 gap-6'>
            {sortedCategories.map(([category, items]) => (
              <div key={category} className='bg-muted dark:bg-gray-800/50 rounded-xl p-4 space-y-3'>
                <div>
                  <h3 className='font-semibold text-xs text-muted-foreground dark:text-muted-foreground uppercase tracking-wider'>
                    {category}
                  </h3>
                  {category === 'Composer' && (
                    <p className='text-xs text-muted-foreground dark:text-muted-foreground mt-1'>
                      These shortcuts work when chat input is focused
                    </p>
                  )}
                </div>
                <div className='space-y-1'>
                  {items.map(({ id, keys, displayKeys, description }) => {
                    const shown = displayKeys ?? keys;
                    const keyList = Array.isArray(shown) ? shown : [shown];
                    return (
                      <div
                        key={id}
                        className='flex items-center justify-between gap-3 py-2 px-2 rounded-lg hover:bg-background dark:hover:bg-gray-700/50 transition-colors group'
                      >
                        <span className='text-sm text-foreground dark:text-muted group-hover:text-foreground dark:group-hover:text-gray-100 transition-colors'>
                          {description}
                        </span>
                        <div className='flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end'>
                          {keyList.map((key, idx) => (
                            <kbd
                              key={idx}
                              className='inline-flex items-center justify-center px-2 py-1 text-xs font-medium font-mono bg-background dark:bg-gray-700 text-foreground dark:text-gray-200 rounded-md border border-border dark:border-gray-600 shadow-sm min-w-[28px]'
                            >
                              {formatShortcut(key, isMac)}
                            </kbd>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className='px-6 py-3 border-t border-border dark:border-gray-700 bg-muted dark:bg-gray-800/50 rounded-b-lg'>
          <div className='flex items-center justify-center gap-2 text-xs text-muted-foreground dark:text-muted-foreground'>
            <span>Press</span>
            <kbd className='inline-flex items-center justify-center px-2 py-0.5 font-mono font-medium bg-background dark:bg-gray-700 text-muted-foreground dark:text-muted rounded border border-border dark:border-gray-600 shadow-sm'>
              Esc
            </kbd>
            <span>to close</span>
          </div>
        </div>
      </div>
    </Dialog>
  );
};
