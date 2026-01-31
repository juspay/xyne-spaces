import { ReactElement } from 'react';
import Avatar from '../Avatar/Avatar';
import { Popover } from '../Popover/Popover';
import SettingsContent from '../../Settings/Settings';

interface MobileProfileMenuProps {
  userId: string;
}

export const MobileProfileMenu = ({ userId }: MobileProfileMenuProps): ReactElement => {
  return (
    <Popover
      trigger={
        <button type='button' className='relative' aria-label='Open user menu'>
          <Avatar userId={userId} size='md' />
          {/* Online Status Indicator */}
          {/* <span className='absolute -bottom-1 -right-1 size-3 bg-[#10C558] border border-white rounded-full border-[#E9ECF5D9]' /> */}
        </button>
      }
      side='bottom'
      sideOffset={8}
      align='end'
    >
      <SettingsContent />
    </Popover>
  );
};
