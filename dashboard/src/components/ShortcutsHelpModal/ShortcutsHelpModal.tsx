import type { ReactElement } from 'react';
import { Dialog } from '../ui/Dialog';
import { getShortcutsByCategory } from '../../shortcuts';
import { X, Keyboard } from 'lucide-react';
import { usePlatform } from '../../hooks/usePlatform';

const formatKey = (key: string, isMac: boolean): string => {
  return key
    .replace('mod+', isMac ? '⌘' : 'Ctrl+')
    .replace('shift+', isMac ? '⇧' : 'Shift+')
    .replace('alt+', isMac ? '⌥' : 'Alt+')
    .replace('ctrl+', isMac ? '⌃' : 'Ctrl+')
    .split('+')
    .map(k => k.trim())
    .map(k => k.charAt(0).toUpperCase() + k.slice(1))
    .join(' ');
};

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
      const filtered = items.filter(item => item.description);
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
        <div className='flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700'>
          <div className='flex items-center gap-3'>
            <div className='p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg'>
              <Keyboard className='w-5 h-5 text-blue-600 dark:text-blue-400' />
            </div>
            <div>
              <h2 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
                Keyboard Shortcuts
              </h2>
              <p className='text-sm text-gray-500 dark:text-gray-400'>
                Quick actions to boost your productivity
              </p>
            </div>
          </div>
          <button
            onClick={() => onClose()}
            className='p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors'
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
              <div
                key={category}
                className='bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 space-y-3'
              >
                <div>
                  <h3 className='font-semibold text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                    {category}
                  </h3>
                  {category === 'Composer' && (
                    <p className='text-xs text-gray-400 dark:text-gray-500 mt-1'>
                      These shortcuts work when chat input is focused
                    </p>
                  )}
                </div>
                <div className='space-y-1'>
                  {items.map(({ id, keys, description }) => {
                    const keyList = Array.isArray(keys) ? keys : [keys];
                    return (
                      <div
                        key={id}
                        className='flex items-center justify-between gap-3 py-2 px-2 rounded-lg hover:bg-white dark:hover:bg-gray-700/50 transition-colors group'
                      >
                        <span className='text-sm text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-gray-100 transition-colors'>
                          {description}
                        </span>
                        <div className='flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end'>
                          {keyList.map((key, idx) => (
                            <kbd
                              key={idx}
                              className='inline-flex items-center justify-center px-2 py-1 text-xs font-medium font-mono bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-md border border-gray-200 dark:border-gray-600 shadow-sm min-w-[28px]'
                            >
                              {formatKey(key, isMac)}
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
        <div className='px-6 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 rounded-b-lg'>
          <div className='flex items-center justify-center gap-2 text-xs text-gray-500 dark:text-gray-400'>
            <span>Press</span>
            <kbd className='inline-flex items-center justify-center px-2 py-0.5 font-mono font-medium bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded border border-gray-200 dark:border-gray-600 shadow-sm'>
              Esc
            </kbd>
            <span>to close</span>
          </div>
        </div>
      </div>
    </Dialog>
  );
};
