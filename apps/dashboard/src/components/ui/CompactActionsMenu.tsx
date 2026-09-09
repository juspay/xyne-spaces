import { ReactElement, useRef } from 'react';
import { EllipsisVertical } from 'lucide-react';
import { Button } from './Button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from './dropdown-menu';
import { cn } from '../../utils/classNames';

export interface ActionMenuItem {
  icon?: ReactElement;
  label?: string;
  onSelect: () => void;
  preventClose?: boolean;
  disabled?: boolean;
  visible?: boolean;
  customContent?: ReactElement;
  testId?: string;
  /** Extra `data-*` attributes on the rendered item, e.g. the `data-track-*` analytics trio. */
  dataAttributes?: Record<`data-${string}`, string>;
}

interface CompactActionsMenuProps {
  items: ActionMenuItem[];
  triggerClassName?: string;
  contentAlign?: 'start' | 'center' | 'end';
  /** Force the dark theme's tokens on the (portaled) menu content, e.g. for in-call surfaces. */
  forceDarkTheme?: boolean;
  /**
   * Replaces the default ellipsis button. Rendered through `asChild`, so it has to be a single
   * element that accepts a ref and forwards the props Radix merges onto it.
   */
  trigger?: ReactElement;
  contentClassName?: string;
  /**
   * Radix modal mode. Pass `false` when an item opens a `Dialog`: a modal menu keeps
   * `disableOutsidePointerEvents` on and its `z-[60]` content mounted for the exit animation,
   * which leaves the freshly opened dialog inert and painted underneath for that window.
   */
  modal?: boolean;
  /**
   * Skip restoring focus to the trigger when the menu closes *because an item ran*. Also needed
   * when an item opens a dialog — otherwise the menu's unmount auto-focus fights the dialog's
   * focus trap and the dialog ends up with its container focused instead of its first field.
   * Escape / outside-click still hand focus back to the trigger.
   */
  preventCloseAutoFocus?: boolean;
}

const CompactActionsMenu = ({
  items,
  triggerClassName = 'p-2 border border-[#E4E6E7] rounded-lg h-8 w-8',
  contentAlign = 'end',
  forceDarkTheme = false,
  trigger,
  contentClassName,
  modal = true,
  preventCloseAutoFocus = false,
}: CompactActionsMenuProps): ReactElement => {
  const visibleItems = items.filter(item => item.visible !== false);
  // Set only for a close that an item triggered, so Escape and outside-click keep their normal
  // focus restoration even when `preventCloseAutoFocus` is on.
  const closingFromItemSelect = useRef(false);

  const handleItemSelect =
    (item: ActionMenuItem) =>
    (event: Event): void => {
      if (item.preventClose) {
        event.preventDefault();
      } else {
        closingFromItemSelect.current = true;
      }
      item.onSelect();
    };

  return (
    <DropdownMenu modal={modal}>
      <DropdownMenuTrigger asChild>
        {trigger ?? (
          <Button variant='ghost' size='sm' aria-label='More actions' className={triggerClassName}>
            <EllipsisVertical size={20} />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={contentAlign}
        className={cn('min-w-[14rem]', contentClassName)}
        onCloseAutoFocus={event => {
          if (preventCloseAutoFocus && closingFromItemSelect.current) {
            event.preventDefault();
          }
          closingFromItemSelect.current = false;
        }}
        {...(forceDarkTheme ? { 'data-theme': 'midnight' } : {})}
      >
        {visibleItems.map((item, index) => {
          if (item.customContent) {
            return (
              <DropdownMenuItem
                key={index}
                onSelect={handleItemSelect(item)}
                disabled={item.disabled ?? false}
                data-testid={item.testId}
                className='p-0'
                {...(item.dataAttributes ?? {})}
              >
                {item.customContent}
              </DropdownMenuItem>
            );
          }

          return (
            <DropdownMenuItem
              key={index}
              onSelect={handleItemSelect(item)}
              disabled={item.disabled ?? false}
              className='justify-between'
              data-testid={item.testId}
              {...(item.dataAttributes ?? {})}
            >
              <span className='flex items-center'>
                {item.icon && (
                  <span className='w-4 h-4 mr-2 flex items-center justify-center'>{item.icon}</span>
                )}
                {item.label}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default CompactActionsMenu;
