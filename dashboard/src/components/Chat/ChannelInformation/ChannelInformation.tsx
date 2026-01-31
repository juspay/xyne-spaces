import React, { ReactElement, useState } from 'react';
import { useChannel } from '../../../hooks/useChannels';
import {
  Button,
  ButtonType,
  ButtonSize,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  TabsVariant,
  TabsSize,
  Modal,
} from '@juspay/blend-design-system';
import { IconToggleButton, iconToggleVariants } from '../ChatHeader/IconToggleButton';
import { ChannelName } from '../ChannelName/ChannelName';
import { AboutChannel } from './AboutChannel';
import ChannelParticipants from './ChannelParticipants';
import { X, Star, Users } from 'lucide-react';

type ChannelTab = 'about' | 'members';
interface ChannelInformationProps {
  channelId: string;
  onClose?: () => void;
  defaultTab?: ChannelTab;
  height?: string;
  modal?: boolean;
}

export const ChannelInformation: React.FC<ChannelInformationProps> = ({
  channelId,
  onClose,
  defaultTab = 'about',
  height = 'h-full',
  modal = false,
}) => {
  const channel = useChannel(channelId);
  const [activeTab, setActiveTab] = useState<ChannelTab>(defaultTab);

  const handleTabChange = (value: string): void => {
    setActiveTab(value as ChannelTab);
  };

  if (!channel) {
    const loadingContent = (
      <div className='w-80 bg-white border border-gray-200 p-4'>
        <div className='text-center text-gray-600'>Loading channel information...</div>
      </div>
    );

    return modal ? (
      <Modal
        isOpen={true}
        onClose={() => {}}
        title='Channel Information'
        showCloseButton={true}
        closeOnBackdropClick={true}
        minWidth='600px'
      >
        {loadingContent}
      </Modal>
    ) : (
      loadingContent
    );
  }

  const ChannelContent = (): ReactElement => (
    <div className={`w-full bg-white  flex flex-col ${height}`}>
      {/* Header */}
      <div className='p-4 border-b border-gray-200'>
        <div className='flex items-center justify-between mb-3'>
          <ChannelName channel={channel} showIcon={true} iconSize='md' textSize='lg' />
          {onClose && (
            <Button
              buttonType={ButtonType.SECONDARY}
              size={ButtonSize.SMALL}
              leadingIcon={<X className='w-4 h-4' />}
              onClick={onClose}
            />
          )}
        </div>

        {/* Action Buttons */}
        <div className='flex gap-2'>
          <IconToggleButton
            icon={Star}
            variants={iconToggleVariants.star}
            size='md'
            onToggle={_active => {}}
          />
          <Button
            buttonType={ButtonType.SECONDARY}
            size={ButtonSize.SMALL}
            leadingIcon={<Users className='w-4 h-4' />}
            text='Huddle'
          />
        </div>
      </div>

      {/* Tabs */}
      <div className='flex-1 flex flex-col overflow-hidden'>
        <Tabs value={activeTab} onValueChange={handleTabChange} className='flex flex-col h-full'>
          <TabsList variant={TabsVariant.UNDERLINE} size={TabsSize.MD}>
            <TabsTrigger value='about'>About</TabsTrigger>
            <TabsTrigger value='members'>{`Members (${channel.participantCount})`}</TabsTrigger>
          </TabsList>

          <TabsContent value='about' className='flex-1 overflow-y-auto'>
            <AboutChannel channel={channel} />
          </TabsContent>

          <TabsContent value='members' className='flex-1 overflow-y-auto'>
            <ChannelParticipants
              channel={channel}
              onAddingParticipants={() => (onClose ? onClose() : {})}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );

  return modal ? (
    <Modal
      isOpen={true}
      showCloseButton={true}
      closeOnBackdropClick={true}
      showDivider={true}
      onClose={() => (onClose ? onClose() : {})}
      minWidth='600px'
    >
      <ChannelContent />
    </Modal>
  ) : (
    <ChannelContent />
  );
};

export default ChannelInformation;
