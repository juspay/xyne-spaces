import React, { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { EmailMergeMode, AutoDraftMode } from '@xyne/shared';
import { Button } from '../../ui/Button/Button';
import { InboxSettings } from './InboxSettings';
import { DeskIntegrationCard } from '../DeskIntegrationCard/DeskIntegrationCard';
import { ClassificationSettings } from '../ClassificationSettings/ClassificationSettings';
import { PrioritySettings } from '../PrioritySettings';
import { SignatureEditor } from '../SignatureEditor/SignatureEditor';
import { useUserGroups } from '../../../hooks/useUserGroup';
import { useVisibleChannel } from '../../../hooks/useChannels';
import {
  useEmailChannelPreference,
  useUpdateEmailChannelPreference,
} from '../../../hooks/useEmailChannelPreference';

interface InboxSettingsPanelProps {
  channelId: string | null;
  userID: string | null | undefined;
  onClose: () => void;
}

/**
 * The full inbox settings panel — owns its own channel-preference query,
 * form draft state, the save/cancel/default-cc flows, the panel header,
 * and the composite settings body.
 *
 * Extracted from `SupportScreen` so `useEmailChannelPreference` is only
 * subscribed while this panel is mounted (when settings is open). On the
 * bare list view the query no longer runs from here.
 */
export const InboxSettingsPanel: React.FC<InboxSettingsPanelProps> = ({
  channelId,
  userID,
  onClose,
}) => {
  const emailChannelPreference = useEmailChannelPreference(channelId);
  const updateEmailChannelPreference = useUpdateEmailChannelPreference();
  const selectedChannelForSettings = useVisibleChannel(channelId ?? '');
  const allUserGroups = useUserGroups();

  // Current values from the channel preference.
  const currentInboxOwnerUserId = emailChannelPreference?.ownerUserId ?? null;
  const currentInboxAssigneeUserGroupId = emailChannelPreference?.assigneeUserGroupId ?? null;
  const currentInboxSendAsEmail = emailChannelPreference?.sendAsEmail ?? null;
  const currentInboxDefaultCc = emailChannelPreference?.defaultCc ?? null;
  const currentInboxEmailMergeMode: EmailMergeMode =
    emailChannelPreference?.emailMergeMode ?? EmailMergeMode.ENABLED;
  const currentInboxAutoDraftMode: AutoDraftMode =
    emailChannelPreference?.autoDraftMode ?? AutoDraftMode.OFF;

  // Form drafts — committed on Save, reverted on Cancel.
  const [draftInboxOwnerUserId, setDraftInboxOwnerUserId] = useState<string | null>(
    currentInboxOwnerUserId,
  );
  const [draftInboxAssigneeUserGroupId, setDraftInboxAssigneeUserGroupId] = useState<string | null>(
    currentInboxAssigneeUserGroupId,
  );
  const [draftInboxSendAsEmail, setDraftInboxSendAsEmail] = useState<string | null>(
    currentInboxSendAsEmail,
  );
  const [draftInboxEmailMergeMode, setDraftInboxEmailMergeMode] = useState<EmailMergeMode>(
    currentInboxEmailMergeMode,
  );
  const [draftInboxAutoDraftMode, setDraftInboxAutoDraftMode] =
    useState<AutoDraftMode>(currentInboxAutoDraftMode);
  const [isSavingInboxSettings, setIsSavingInboxSettings] = useState(false);
  const [isSavingDefaultCc, setIsSavingDefaultCc] = useState(false);

  // Resync drafts when the underlying values change (channel switch / save).
  useEffect(() => {
    setDraftInboxOwnerUserId(currentInboxOwnerUserId);
  }, [currentInboxOwnerUserId]);
  useEffect(() => {
    setDraftInboxAssigneeUserGroupId(currentInboxAssigneeUserGroupId);
  }, [currentInboxAssigneeUserGroupId]);
  useEffect(() => {
    setDraftInboxSendAsEmail(currentInboxSendAsEmail);
  }, [currentInboxSendAsEmail]);
  useEffect(() => {
    setDraftInboxEmailMergeMode(currentInboxEmailMergeMode);
  }, [currentInboxEmailMergeMode]);
  useEffect(() => {
    setDraftInboxAutoDraftMode(currentInboxAutoDraftMode);
  }, [currentInboxAutoDraftMode]);

  const canEditSendAsEmail =
    !!userID &&
    !!selectedChannelForSettings &&
    (selectedChannelForSettings.createdBy === userID || currentInboxOwnerUserId === userID);

  const inboxSettingsHasChanges =
    !!channelId &&
    (draftInboxOwnerUserId !== currentInboxOwnerUserId ||
      draftInboxAssigneeUserGroupId !== currentInboxAssigneeUserGroupId ||
      (canEditSendAsEmail && draftInboxSendAsEmail !== currentInboxSendAsEmail) ||
      draftInboxEmailMergeMode !== currentInboxEmailMergeMode ||
      draftInboxAutoDraftMode !== currentInboxAutoDraftMode);

  const handleSaveInboxSettings = useCallback(async () => {
    if (!channelId) {
      return;
    }
    setIsSavingInboxSettings(true);
    try {
      await updateEmailChannelPreference.mutateAsync({
        channelId,
        ...(draftInboxOwnerUserId !== currentInboxOwnerUserId && draftInboxOwnerUserId
          ? { ownerUserId: draftInboxOwnerUserId }
          : {}),
        ...(draftInboxAssigneeUserGroupId !== currentInboxAssigneeUserGroupId
          ? { assigneeUserGroupId: draftInboxAssigneeUserGroupId }
          : {}),
        ...(canEditSendAsEmail && draftInboxSendAsEmail !== currentInboxSendAsEmail
          ? { sendAsEmail: draftInboxSendAsEmail }
          : {}),
        ...(draftInboxEmailMergeMode !== currentInboxEmailMergeMode
          ? { emailMergeMode: draftInboxEmailMergeMode }
          : {}),
        ...(draftInboxAutoDraftMode !== currentInboxAutoDraftMode
          ? { autoDraftMode: draftInboxAutoDraftMode }
          : {}),
      });
    } catch (error) {
      setDraftInboxOwnerUserId(currentInboxOwnerUserId);
      setDraftInboxAssigneeUserGroupId(currentInboxAssigneeUserGroupId);
      setDraftInboxSendAsEmail(currentInboxSendAsEmail);
      setDraftInboxEmailMergeMode(currentInboxEmailMergeMode);
      setDraftInboxAutoDraftMode(currentInboxAutoDraftMode);
      console.error('Failed to update email channel preference:', error);
    } finally {
      setIsSavingInboxSettings(false);
    }
  }, [
    channelId,
    draftInboxOwnerUserId,
    currentInboxOwnerUserId,
    draftInboxAssigneeUserGroupId,
    currentInboxAssigneeUserGroupId,
    canEditSendAsEmail,
    draftInboxSendAsEmail,
    currentInboxSendAsEmail,
    draftInboxEmailMergeMode,
    currentInboxEmailMergeMode,
    draftInboxAutoDraftMode,
    currentInboxAutoDraftMode,
    updateEmailChannelPreference,
  ]);

  const handleCancelInboxSettings = useCallback(() => {
    setDraftInboxOwnerUserId(currentInboxOwnerUserId);
    setDraftInboxAssigneeUserGroupId(currentInboxAssigneeUserGroupId);
    setDraftInboxSendAsEmail(currentInboxSendAsEmail);
    setDraftInboxEmailMergeMode(currentInboxEmailMergeMode);
    setDraftInboxAutoDraftMode(currentInboxAutoDraftMode);
  }, [
    currentInboxOwnerUserId,
    currentInboxAssigneeUserGroupId,
    currentInboxSendAsEmail,
    currentInboxEmailMergeMode,
    currentInboxAutoDraftMode,
  ]);

  const handleSaveDefaultCc = useCallback(
    async (value: string | null) => {
      if (!channelId) return;
      setIsSavingDefaultCc(true);
      try {
        await updateEmailChannelPreference.mutateAsync({
          channelId,
          defaultCc: value,
        });
      } catch (error) {
        console.error('Failed to save default CC:', error);
      } finally {
        setIsSavingDefaultCc(false);
      }
    },
    [channelId, updateEmailChannelPreference],
  );

  return (
    <div className='absolute inset-0 z-10 bg-background flex flex-col overflow-y-auto'>
      <div className='flex-shrink-0 h-14 px-4 border-b border-border flex items-center justify-between'>
        <span className='text-sm font-semibold text-foreground'>Inbox Settings</span>
        <div className='flex items-center gap-2'>
          {inboxSettingsHasChanges && (
            <>
              <Button
                size='sm'
                variant='outline'
                onClick={handleCancelInboxSettings}
                disabled={isSavingInboxSettings}
                data-track-category='inbox-settings'
                data-track-name='cancel-inbox-settings'
              >
                Cancel
              </Button>
              <Button
                size='sm'
                onClick={() => void handleSaveInboxSettings()}
                disabled={isSavingInboxSettings || !draftInboxOwnerUserId}
                data-track-category='inbox-settings'
                data-track-name='save-inbox-settings'
              >
                {isSavingInboxSettings ? 'Saving...' : 'Save Changes'}
              </Button>
            </>
          )}
          <button
            onClick={onClose}
            className='p-1.5 rounded hover:bg-accent text-muted-foreground transition-colors'
            data-track-category='inbox-settings'
            data-track-name='close-inbox-settings'
          >
            <X size={16} />
          </button>
        </div>
      </div>
      <div className='p-4 space-y-6'>
        {channelId && (
          <>
            <InboxSettings
              ownerUserId={draftInboxOwnerUserId}
              onOwnerChange={setDraftInboxOwnerUserId}
              assigneeUserGroupId={draftInboxAssigneeUserGroupId}
              onAssigneeChange={setDraftInboxAssigneeUserGroupId}
              sendAsEmail={draftInboxSendAsEmail}
              onSendAsEmailChange={setDraftInboxSendAsEmail}
              canEditSendAsEmail={canEditSendAsEmail}
              defaultCc={currentInboxDefaultCc}
              onSaveDefaultCc={value => void handleSaveDefaultCc(value)}
              isSavingDefaultCc={isSavingDefaultCc}
              emailMergeMode={draftInboxEmailMergeMode}
              onEmailMergeModeChange={setDraftInboxEmailMergeMode}
              autoDraftMode={draftInboxAutoDraftMode}
              onAutoDraftModeChange={setDraftInboxAutoDraftMode}
              disabled={isSavingInboxSettings}
            />
            <div className='border-t border-border' />
            <DeskIntegrationCard channelId={channelId} canManage={canEditSendAsEmail} />
            <ClassificationSettings
              channelId={channelId}
              userGroups={allUserGroups.map(g => ({ id: g.id, name: g.name }))}
              canManage={canEditSendAsEmail}
            />
            <div className='border-t border-border' />
            <PrioritySettings channelId={channelId} canManage={canEditSendAsEmail} />
            <div className='border-t border-border' />
          </>
        )}
        <SignatureEditor />
      </div>
    </div>
  );
};
