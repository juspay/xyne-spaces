import React, { useState, useEffect } from 'react';
import { Users, ExternalLink } from 'lucide-react';
import { HoverCard } from '../HoverCard/HoverCard';
import { useUserGroupById } from '../../../hooks/useUserGroup';
import { usePlatform } from '../../../hooks/usePlatform';
import { useNavigate, useParams } from 'react-router-dom';
import { useRouteContext } from '../../../hooks/useRouteContext';

interface GroupHoverWrapperProps {
  groupId: string;
  children: React.ReactNode;
}

export const GroupHoverWrapper: React.FC<GroupHoverWrapperProps> = ({ groupId, children }) => {
  const navigate = useNavigate();
  const { channelId } = useParams<{ channelId: string }>();
  const { baseRoute } = useRouteContext();
  const { isMobile } = usePlatform();
  const [open, setOpen] = useState(false);

  // Close hover card on scroll
  useEffect(() => {
    if (!open) return;
    const handleScroll = (): void => setOpen(false);
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [open]);

  const userGroup = useUserGroupById(groupId);

  const handleViewGroup = (): void => {
    if (channelId) {
      void navigate(`${baseRoute}/${channelId}/group/${groupId}`);
    }
  };

  if (!userGroup) return <>{children}</>;

  // 📱 Mobile → Direct navigation
  if (isMobile) {
    return (
      <span
        role='button'
        tabIndex={0}
        className='cursor-pointer inline'
        onClick={e => {
          e.preventDefault();
          e.stopPropagation();
          handleViewGroup();
        }}
        data-track-category='MENTION'
        data-track-name='OPEN_GROUP_FROM_MENTION'
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleViewGroup();
          }
        }}
      >
        {children}
      </span>
    );
  }

  return (
    <HoverCard
      trigger={children}
      side='top'
      align='start'
      openDelay={400}
      closeDelay={200}
      open={open}
      onOpenChange={setOpen}
      className='p-0 bg-transparent border-0 shadow-none'
    >
      <div className='bg-popover rounded-lg shadow-lg w-fit border border-muted-foreground/20'>
        {/* Header */}
        <div className='flex items-start gap-4 p-4'>
          <div
            className={`flex items-center justify-center size-16 rounded-sm shrink-0 ${
              userGroup.isActive === false ? 'bg-muted' : 'bg-blue-500'
            }`}
          >
            <Users
              className={`size-8 ${userGroup.isActive === false ? 'text-muted-foreground' : 'text-white'}`}
            />
          </div>

          <div className='flex flex-col min-w-0 flex-1'>
            <div className='flex items-center gap-2'>
              <span
                className={`font-semibold text-lg break-words ${userGroup.isActive === false ? 'text-muted-foreground' : 'text-foreground'}`}
              >
                {userGroup.name}
              </span>
              {userGroup.isActive === false && (
                <span className='px-2 py-0.5 text-xs bg-muted text-muted-foreground rounded'>
                  Deactivated
                </span>
              )}
            </div>

            {userGroup.description && (
              <div className='mt-1 text-sm text-foreground leading-relaxed break-words line-clamp-2'>
                {userGroup.description}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className='flex justify-end px-4 py-3 border-t border-muted-foreground/20'>
          <button
            onClick={handleViewGroup}
            data-track-category='MENTION'
            data-track-name='OPEN_GROUP_FROM_MENTION'
            className='inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-muted hover:bg-accent rounded-md transition-colors'
          >
            <ExternalLink className='size-4' />
            View group
          </button>
        </div>
      </div>
    </HoverCard>
  );
};
