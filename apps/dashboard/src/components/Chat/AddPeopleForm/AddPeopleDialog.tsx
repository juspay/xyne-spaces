import React, { useState } from 'react';
import { V2Dialog } from '../../../routes/AIScreen/library/shared/primitives/V2Dialog';
import { AddPeopleForm } from './AddPeopleForm';
import type { AddPeopleContext, AddPeopleDialogProps } from './AddPeopleForm.types';
import { ADD_PEOPLE_TITLES } from './AddPeopleForm.utils';

const INITIAL_CONTEXT: AddPeopleContext = {
  step: 'people',
  isDirectConversation: false,
};

export const AddPeopleDialog: React.FC<AddPeopleDialogProps> = ({
  channelId,
  open,
  onOpenChange,
  existingUserIds,
}) => {
  const [context, setContext] = useState<AddPeopleContext>(INITIAL_CONTEXT);

  const handleOpenChange = (next: boolean): void => {
    if (!next) {
      setContext(INITIAL_CONTEXT);
    }
    onOpenChange(next);
  };

  const title =
    context.step === 'history'
      ? ADD_PEOPLE_TITLES.history
      : context.isDirectConversation
        ? ADD_PEOPLE_TITLES.peopleDirect
        : ADD_PEOPLE_TITLES.peopleChannel;

  return (
    <V2Dialog
      open={open}
      onOpenChange={handleOpenChange}
      className='gap-0 p-3'
      title={title}
      description={
        context.step === 'history'
          ? 'Choose how much conversation history the new members can see.'
          : 'Search for people to add to this conversation.'
      }
      testId='add-people-dialog'
    >
      <AddPeopleForm
        channelId={channelId}
        {...(existingUserIds ? { existingUserIds } : {})}
        embedded
        onContextChange={setContext}
        onSuccess={() => handleOpenChange(false)}
        onCancel={() => handleOpenChange(false)}
      />
    </V2Dialog>
  );
};

export default AddPeopleDialog;
