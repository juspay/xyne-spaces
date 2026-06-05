import React, { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { EmailMergeMode, AutoDraftMode, ChannelType } from '@xyne/shared';
import { Button } from '../../ui/Button/Button';
import { InboxSettings } from './InboxSettings';
import { EmailDeskSettings } from './EmailDeskSettings';
import { DeskIntegrationCard } from '../DeskIntegrationCard/DeskIntegrationCard';
import { SlackDeskIntegrationCard } from '../DeskIntegrationCard/SlackDeskIntegrationCard';
import { ClassificationSettings } from '../ClassificationSettings/ClassificationSettings';
import { PrioritySettings } from '../PrioritySettings';
import { SignatureEditor } from '../SignatureEditor/SignatureEditor';
import { useUserGroups } from '../../../hooks/useUserGroup';
import { useVisibleChannel } from '../../../hooks/useChannels';
import {
  useEmailChannelPreference,
  useUpdateEmailChannelPreference,
} from '../../../hooks/useEmailChannelPreference';
import { useChannelClawAgents } from '../../../hooks/useChannelClawAgents';

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
 * Renders generic settings (owner, assignee, auto AI draft, classification,
 * priority) for all desk types, then provider-specific sections based on
 * channel type — e.g. email desks get send-as alias, default CC, merge
 * mode, integration card, and signature editor.
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
  const clawAgents = useChannelClawAgents(channelId);

  const channelType = selectedChannelForSettings?.type;
  const isEmail = channelType === ChannelType.EMAIL;
  const isSlack = channelType === ChannelType.SLACK;

  // Current values from the channel preference.
  const currentInboxOwnerUserId = emailChannelPreference?.ownerUserId ?? null;
  const currentInboxAssigneeUserGroupId = emailChannelPreference?.assigneeUserGroupId ?? null;
  const currentInboxSendAsEmail = emailChannelPreference?.sendAsEmail ?? null;
  const currentInboxDefaultCc = emailChannelPreference?.defaultCc ?? null;
  const currentInboxEmailMergeMode: EmailMergeMode =
    emailChannelPreference?.emailMergeMode ?? EmailMergeMode.ENABLED;
  const currentInboxAutoDraftMode: AutoDraftMode =
    emailChannelPreference?.autoDraftMode ?? AutoDraftMode.OFF;
  const currentInboxAutoDraftAgentSlug: string | null =
    emailChannelPreference?.autoDraftAgentSlug ?? null;

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
  const [draftInboxAutoDraftAgentSlug, setDraftInboxAutoDraftAgentSlug] = useState<string | null>(
    currentInboxAutoDraftAgentSlug,
  );
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
  useEffect(() => {
    setDraftInboxAutoDraftAgentSlug(currentInboxAutoDraftAgentSlug);
  }, [currentInboxAutoDraftAgentSlug]);

  const canManage =
    !!userID &&
    !!selectedChannelForSettings &&
    (selectedChannelForSettings.createdBy === userID || currentInboxOwnerUserId === userID);

  const inboxSettingsHasChanges =
    !!channelId &&
    (draftInboxOwnerUserId !== currentInboxOwnerUserId ||
      draftInboxAssigneeUserGroupId !== currentInboxAssigneeUserGroupId ||
      draftInboxAutoDraftMode !== currentInboxAutoDraftMode ||
      draftInboxAutoDraftAgentSlug !== currentInboxAutoDraftAgentSlug ||
      (isEmail &&
        canManage &&
        (draftInboxSendAsEmail !== currentInboxSendAsEmail ||
          draftInboxEmailMergeMode !== currentInboxEmailMergeMode)));

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
        ...(isEmail && canManage && draftInboxSendAsEmail !== currentInboxSendAsEmail
          ? { sendAsEmail: draftInboxSendAsEmail }
          : {}),
        ...(isEmail && draftInboxEmailMergeMode !== currentInboxEmailMergeMode
          ? { emailMergeMode: draftInboxEmailMergeMode }
          : {}),
        ...(draftInboxAutoDraftMode !== currentInboxAutoDraftMode
          ? { autoDraftMode: draftInboxAutoDraftMode }
          : {}),
        ...(draftInboxAutoDraftAgentSlug !== currentInboxAutoDraftAgentSlug
          ? { autoDraftAgentSlug: draftInboxAutoDraftAgentSlug }
          : {}),
      });
    } catch (error) {
      setDraftInboxOwnerUserId(currentInboxOwnerUserId);
      setDraftInboxAssigneeUserGroupId(currentInboxAssigneeUserGroupId);
      setDraftInboxSendAsEmail(currentInboxSendAsEmail);
      setDraftInboxEmailMergeMode(currentInboxEmailMergeMode);
      setDraftInboxAutoDraftMode(currentInboxAutoDraftMode);
      setDraftInboxAutoDraftAgentSlug(currentInboxAutoDraftAgentSlug);
      console.error('Failed to update email channel preference:', error);
    } finally {
      setIsSavingInboxSettings(false);
    }
  }, [
    channelId,
    isEmail,
    draftInboxOwnerUserId,
    currentInboxOwnerUserId,
    draftInboxAssigneeUserGroupId,
    currentInboxAssigneeUserGroupId,
    canManage,
    draftInboxSendAsEmail,
    currentInboxSendAsEmail,
    draftInboxEmailMergeMode,
    currentInboxEmailMergeMode,
    draftInboxAutoDraftMode,
    currentInboxAutoDraftMode,
    draftInboxAutoDraftAgentSlug,
    currentInboxAutoDraftAgentSlug,
    updateEmailChannelPreference,
  ]);

  const handleCancelInboxSettings = useCallback(() => {
    setDraftInboxOwnerUserId(currentInboxOwnerUserId);
    setDraftInboxAssigneeUserGroupId(currentInboxAssigneeUserGroupId);
    setDraftInboxSendAsEmail(currentInboxSendAsEmail);
    setDraftInboxEmailMergeMode(currentInboxEmailMergeMode);
    setDraftInboxAutoDraftMode(currentInboxAutoDraftMode);
    setDraftInboxAutoDraftAgentSlug(currentInboxAutoDraftAgentSlug);
  }, [
    currentInboxOwnerUserId,
    currentInboxAssigneeUserGroupId,
    currentInboxSendAsEmail,
    currentInboxEmailMergeMode,
    currentInboxAutoDraftMode,
    currentInboxAutoDraftAgentSlug,
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
            {/* Generic settings — all desk types */}
            <InboxSettings
              ownerUserId={draftInboxOwnerUserId}
              onOwnerChange={setDraftInboxOwnerUserId}
              assigneeUserGroupId={draftInboxAssigneeUserGroupId}
              onAssigneeChange={setDraftInboxAssigneeUserGroupId}
              autoDraftMode={draftInboxAutoDraftMode}
              onAutoDraftModeChange={setDraftInboxAutoDraftMode}
              autoDraftAgentSlug={draftInboxAutoDraftAgentSlug}
              onAutoDraftAgentChange={setDraftInboxAutoDraftAgentSlug}
              clawAgents={clawAgents}
              disabled={isSavingInboxSettings}
            />

            {/* Email-specific settings */}
            {isEmail && (
              <>
                <div className='border-t border-border' />
                <EmailDeskSettings
                  sendAsEmail={draftInboxSendAsEmail}
                  onSendAsEmailChange={setDraftInboxSendAsEmail}
                  canEditSendAsEmail={canManage}
                  defaultCc={currentInboxDefaultCc}
                  onSaveDefaultCc={value => void handleSaveDefaultCc(value)}
                  isSavingDefaultCc={isSavingDefaultCc}
                  emailMergeMode={draftInboxEmailMergeMode}
                  onEmailMergeModeChange={setDraftInboxEmailMergeMode}
                  disabled={isSavingInboxSettings}
                />
                <div className='border-t border-border' />
                <DeskIntegrationCard channelId={channelId} canManage={canManage} />
              </>
            )}

            {/* Slack-specific settings */}
            {isSlack && (
              <>
                <div className='border-t border-border' />
                <SlackDeskIntegrationCard channelId={channelId} canManage={canManage} />
              </>
            )}

            {/* Generic settings — all desk types */}
            <ClassificationSettings
              channelId={channelId}
              userGroups={allUserGroups.map(g => ({ id: g.id, name: g.name }))}
              canManage={canManage}
            />
            <div className='border-t border-border' />
            <PrioritySettings channelId={channelId} canManage={canManage} />
            <div className='border-t border-border' />
          </>
        )}

        {/* Email signature — only for email desks */}
        {isEmail && <SignatureEditor />}
      </div>
    </div>
  );
};
