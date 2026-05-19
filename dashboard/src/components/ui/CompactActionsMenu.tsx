import { ReactElement } from 'react';
import { EllipsisVertical } from 'lucide-react';
import { Button } from './Button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from './dropdown-menu';

export interface ActionMenuItem {
  icon?: ReactElement;
  label?: string;
  onSelect: () => void;
  preventClose?: boolean;
  disabled?: boolean;
  visible?: boolean;
  customContent?: ReactElement;
  testId?: string;
}

interface CompactActionsMenuProps {
  items: ActionMenuItem[];
  triggerClassName?: string;
  contentAlign?: 'start' | 'center' | 'end';
}

const CompactActionsMenu = ({
  items,
  triggerClassName = 'p-2 border border-[#E4E6E7] rounded-lg h-8 w-8',
  contentAlign = 'end',
}: CompactActionsMenuProps): ReactElement => {
  const visibleItems = items.filter(item => item.visible !== false);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='ghost' size='sm' aria-label='More actions' className={triggerClassName}>
          <EllipsisVertical size={20} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={contentAlign} className='min-w-[14rem]'>
        {visibleItems.map((item, index) => {
          if (item.customContent) {
            return (
              <DropdownMenuItem
                key={index}
                onSelect={e => {
                  if (item.preventClose) e.preventDefault();
                  item.onSelect();
                }}
                className='p-0'
              >
                {item.customContent}
              </DropdownMenuItem>
            );
          }

          return (
            <DropdownMenuItem
              key={index}
              onSelect={e => {
                if (item.preventClose) e.preventDefault();
                item.onSelect();
              }}
              disabled={item.disabled ?? false}
              className='justify-between'
              data-testid={item.testId}
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
