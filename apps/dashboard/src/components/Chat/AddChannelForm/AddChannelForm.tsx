import React, { useState, useEffect, ReactElement, useMemo } from 'react';
import { ANDROID_PACKAGE_NAME_PATTERN, normalizeChannelName } from '@xyne/shared';
import { useForm } from '@tanstack/react-form';
import { useStore } from '@tanstack/react-store';
import { useQuery } from '@tanstack/react-query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/Select';
import { EntitySelector } from '../../ui/EntitySelector/EntitySelector';
import {
  Hash,
  Lock,
  AlertCircle,
  FolderKanban,
  Mail,
  Mails,
  MessageSquareMore,
  Smartphone,
  Phone,
  Share2,
  Plus,
  Trash2,
} from 'lucide-react';

import { Button } from '../../ui/Button';
import { Tooltip } from '../../ui/Tooltip';
import {
  channelService,
  CreateChannelFormData,
  PromoteGroupDmRequest,
} from '../../../services/Chat/channelService';
import Input from '../../ui/Input';
import Textarea from '../../ui/Textarea';
import RadioGroup, { Radio } from '../../ui/RadioGroup';
import { Badge } from '../../ui/Badge';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { cn } from '../../../utils/classNames';
import { useOAuthProviders } from '../../../hooks/useOAuthProviders';
import { useUserGroups } from '../../../hooks/useUserGroup';
import { usePlatform } from '../../../hooks/usePlatform';
import { getWorkspaceSharedMailboxStatus } from '../../../services/clients/workspaceDeskApi';
import { getOzonetelConfig } from '../../../services/clients/telephonyApi';
import { DeskType } from '@xyne/shared';

type ChannelFormMode = 'create' | 'promote';
type ChannelFormData = CreateChannelFormData | PromoteGroupDmRequest;
type ConnectorType = 'google' | 'microsoft' | null;
type CallSource = 'OZONETEL';
type Visibility = 'public' | 'private';

interface SlackChannel {
  id: string;
  name: string;
  is_private: boolean;
  num_members: number;
  alreadyConnected: boolean;
}

const DESK_SOURCES: ReadonlyArray<{
  value: DeskType;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    value: DeskType.EMAIL,
    label: 'Personal mailbox',
    description: 'Connect a dedicated inbox via OAuth',
    icon: Mail,
  },
  {
    value: DeskType.DL,
    label: 'Distribution list',
    description: 'Route a DL through the shared mailbox',
    icon: Mails,
  },
  {
    value: DeskType.SLACK,
    label: 'Slack channel',
    description: 'Connect a Slack channel to create tickets from messages',
    icon: MessageSquareMore,
  },
  {
    value: DeskType.APP,
    label: 'Xyne App',
    description: 'Connect an external system through a Xyne App over APIs',
    icon: Smartphone,
  },
  {
    value: DeskType.CALL,
    label: 'Call desk',
    description: 'Create a call-first desk that can be used in workspace Ozonetel routing',
    icon: Phone,
  },
  {
    value: DeskType.SOCIAL_MEDIA,
    label: 'Social media',
    description: 'Create support tickets from Google Play reviews',
    icon: Share2,
  },
];

interface EligibleApp {
  installedAppId: string;
  appId: string;
  name: string;
  description: string | null;
  deskCount: number;
}

interface GooglePlayApplicationInput {
  displayName: string;
  packageName: string;
}

interface GooglePlayApplicationRow extends GooglePlayApplicationInput {
  id: string;
}

function createGooglePlayApplication(): GooglePlayApplicationRow {
  return { id: crypto.randomUUID(), displayName: '', packageName: '' };
}

function areGooglePlayApplicationsValid(applications: GooglePlayApplicationInput[]): boolean {
  if (applications.length === 0) return false;
  const packageNames = applications.map(application => application.packageName);
  return (
    applications.every(
      application =>
        application.displayName.trim().length > 0 &&
        ANDROID_PACKAGE_NAME_PATTERN.test(application.packageName),
    ) && new Set(packageNames).size === packageNames.length
  );
}

interface AddChannelFormProps {
  mode?: ChannelFormMode;
  onSubmit: (
    data: ChannelFormData & {
      connector?: ConnectorType;
      channelType?: 'EMAIL' | 'SLACK' | 'APP' | 'CALL' | 'SOCIAL_MEDIA' | undefined;
      deskType?: DeskType;
      callSource?: CallSource;
      dlEmail?: string;
      slackChannelId?: string;
      installedAppId?: string;
      applications?: GooglePlayApplicationInput[];
    },
  ) => void;
  onCancel: () => void;
  loading?: boolean;
  title?: string;
  hideVisibility?: boolean;
  requireConnector?: boolean;
}

export const AddChannelForm: React.FC<AddChannelFormProps> = ({
  mode = 'create',
  onSubmit,
  loading,
  onCancel,
  title,
  hideVisibility = false,
  requireConnector = false,
}) => {
  const [debouncedChannelName, setDebouncedChannelName] = useState('');
  const [channelName, setChannelName] = useState('');
  const [tagString, setTagString] = useState('');
  const [selectedConnector, setSelectedConnector] = useState<ConnectorType>(null);
  const [deskType, setDeskType] = useState<DeskType>(DeskType.EMAIL);
  const [dlEmailInput, setDlEmailInput] = useState<string>('');
  const [selectedSlackChannelId, setSelectedSlackChannelId] = useState<string>('');
  const [selectedInstalledAppId, setSelectedInstalledAppId] = useState<string>('');
  const [googlePlayApplications, setGooglePlayApplications] = useState<GooglePlayApplicationRow[]>([
    createGooglePlayApplication(),
  ]);
  const selectedCallSource: CallSource = 'OZONETEL';
  const { isMobile } = usePlatform();
  const { data: oauthProviders } = useOAuthProviders();

  const { data: slackChannelsData, isLoading: isLoadingSlackChannels } = useQuery({
    queryKey: ['slack-desk-channels'],
    queryFn: async () => {
      const { apiInstance } = await import('../../../services/clients/apiClient');
      const res = await apiInstance.get<{ channels: SlackChannel[] }>(
        '/integrations/slack-desk/channels',
      );
      return res.data.channels;
    },
    enabled: requireConnector && deskType === DeskType.SLACK,
  });

  const { data: eligibleAppsData, isLoading: isLoadingEligibleApps } = useQuery({
    queryKey: ['app-desk-eligible-apps'],
    queryFn: async () => {
      const { apiInstance } = await import('../../../services/clients/apiClient');
      const res = await apiInstance.get<{ apps: EligibleApp[] }>('/integrations/app-desk/apps');
      return res.data.apps;
    },
    enabled: requireConnector && deskType === DeskType.APP,
  });

  const { data: workspaceMailbox } = useQuery({
    queryKey: ['workspace-shared-mailbox-status'],
    queryFn: getWorkspaceSharedMailboxStatus,
    enabled: requireConnector,
  });
  const { data: ozonetelConfig } = useQuery({
    queryKey: ['workspace-ozonetel-config'],
    queryFn: () => getOzonetelConfig(),
    enabled: requireConnector && deskType === DeskType.CALL,
  });

  const workspaceDomain = workspaceMailbox?.displayName?.split('@')[1]?.toLowerCase() ?? '';
  const isValidDlEmail = (value: string): boolean => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  };
  const dlEmailError = ((): string | null => {
    if (!dlEmailInput) return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dlEmailInput)) return 'Enter a valid email address';
    return null;
  })();

  // Fetch all projects for selection
  const [projects] = useCachedQuery(queries.getAllProjects());

  // Fetch all user groups for assignee selection
  const userGroups = useUserGroups();

  // Memoized project options for dropdown
  const projectOptions = useMemo(
    () =>
      projects?.map(project => ({
        value: project.id,
        label: project.name,
        icon: <FolderKanban className='w-4 h-4 text-muted-foreground' />,
      })) || [],
    [projects],
  );

  // Memoized user group options for dropdown
  const userGroupOptions = useMemo(
    () =>
      userGroups?.map(group => ({
        label: group.name,
        value: group.id,
      })) || [],
    [userGroups],
  );

  const { data: duplicateCheck } = useQuery({
    queryKey: ['checkDuplicateChannel', debouncedChannelName],
    queryFn: () => channelService.checkDuplicateChannel(debouncedChannelName),
    enabled: Boolean(debouncedChannelName.trim()),
    staleTime: 0,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const form = useForm({
    defaultValues: {
      name: '',
      description: '',
      visibility: 'private' as Visibility,
      topicTags: [] as string[],
      projectId: '',
      assigneeUserGroupId: '',
      boardId: '',
    } as CreateChannelFormData & { assigneeUserGroupId?: string },
    onSubmit: ({ value }) => {
      if (duplicateCheck?.isDuplicate) {
        return;
      }
      if (requireConnector) {
        if (deskType === DeskType.EMAIL && !selectedConnector) return;
        if (
          deskType === DeskType.DL &&
          (!workspaceMailbox?.configured || !dlEmailInput || !isValidDlEmail(dlEmailInput))
        )
          return;
        if (deskType === DeskType.SLACK && !selectedSlackChannelId) return;
        if (deskType === DeskType.APP && !selectedInstalledAppId) return;
        if (
          deskType === DeskType.SOCIAL_MEDIA &&
          (!areGooglePlayApplicationsValid(googlePlayApplications) || !value.boardId)
        )
          return;
      }
      if (mode === 'promote') {
        const promoteData: PromoteGroupDmRequest = {
          name: value.name,
          visibility: value.visibility,
          projectId: value.projectId,
          topicTags: value.topicTags,
        };
        if (value.description) {
          promoteData.description = value.description;
        }
        onSubmit?.(promoteData);
      } else if (requireConnector) {
        if (deskType === DeskType.SLACK) {
          onSubmit?.({
            ...value,
            connector: null,
            channelType: 'SLACK',
            deskType: DeskType.SLACK,
            slackChannelId: selectedSlackChannelId,
            assigneeUserGroupId: value.assigneeUserGroupId,
          });
        } else if (deskType === DeskType.APP) {
          onSubmit?.({
            ...value,
            connector: null,
            channelType: 'APP',
            deskType: DeskType.APP,
            installedAppId: selectedInstalledAppId,
            assigneeUserGroupId: value.assigneeUserGroupId,
          });
        } else if (deskType === DeskType.SOCIAL_MEDIA) {
          onSubmit?.({
            ...value,
            connector: null,
            channelType: 'SOCIAL_MEDIA',
            deskType: DeskType.SOCIAL_MEDIA,
            applications: googlePlayApplications.map(application => ({
              displayName: application.displayName.trim(),
              packageName: application.packageName,
            })),
            assigneeUserGroupId: value.assigneeUserGroupId,
          });
        } else if (deskType === DeskType.DL) {
          onSubmit?.({
            ...value,
            connector: null,
            channelType: 'EMAIL',
            deskType: DeskType.DL,
            dlEmail: dlEmailInput,
            assigneeUserGroupId: value.assigneeUserGroupId,
          });
        } else if (deskType === DeskType.CALL) {
          onSubmit?.({
            ...value,
            connector: null,
            channelType: 'CALL',
            deskType: DeskType.CALL,
            callSource: selectedCallSource,
            assigneeUserGroupId: value.assigneeUserGroupId,
          });
        } else {
          onSubmit?.({
            ...value,
            connector: selectedConnector,
            channelType: 'EMAIL',
            deskType: DeskType.EMAIL,
            assigneeUserGroupId: value.assigneeUserGroupId,
          });
        }
      } else {
        onSubmit?.({ ...value, connector: selectedConnector });
      }
    },
  });

  const visibility = useStore(form.store, state => state.values.visibility);
  const nameValue = useStore(form.store, state => state.values.name);
  const projectIdValue = useStore(form.store, state => state.values.projectId);
  const boardIdValue = useStore(form.store, state => state.values.boardId);

  // Memoized board options based on selected project
  const selectedProject = useMemo(
    () => projects?.find(p => p.id === projectIdValue),
    [projects, projectIdValue],
  );

  const boardOptions = useMemo(
    () =>
      (selectedProject as unknown as { boards?: { id: string; name: string }[] })?.boards?.map(
        board => ({ label: board.name, value: board.id }),
      ) ?? [],
    [selectedProject],
  );

  const isSubmitDisabled =
    !nameValue ||
    nameValue.length < 2 ||
    nameValue.length > 80 ||
    !projectIdValue ||
    (requireConnector && deskType === DeskType.EMAIL && !selectedConnector) ||
    (requireConnector &&
      deskType === DeskType.DL &&
      (!workspaceMailbox?.configured || !dlEmailInput || !isValidDlEmail(dlEmailInput))) ||
    (requireConnector && deskType === DeskType.SLACK && !selectedSlackChannelId) ||
    (requireConnector && deskType === DeskType.APP && !selectedInstalledAppId) ||
    (requireConnector &&
      deskType === DeskType.SOCIAL_MEDIA &&
      (!areGooglePlayApplicationsValid(googlePlayApplications) || !boardIdValue)) ||
    (requireConnector && deskType === DeskType.CALL && !ozonetelConfig?.configured) ||
    duplicateCheck?.isDuplicate === true;

  const submitDisabledReason = ((): string | null => {
    if (!nameValue || nameValue.length < 2) return 'Channel name must be at least 2 characters';
    if (nameValue.length > 80) return 'Channel name must be 80 characters or less';
    if (duplicateCheck?.isDuplicate) return 'Channel name already exists';
    if (!projectIdValue) return 'Please select a project';
    if (requireConnector) {
      if (deskType === DeskType.EMAIL && !selectedConnector)
        return 'Please select an email provider (Google or Microsoft)';
      if (deskType === DeskType.DL) {
        if (!workspaceMailbox?.configured) return 'Workspace shared mailbox is not configured';
        if (!dlEmailInput) return 'Please enter a distribution list email';
        if (!isValidDlEmail(dlEmailInput)) return dlEmailError ?? 'Invalid distribution list email';
      }
      if (deskType === DeskType.SLACK && !selectedSlackChannelId)
        return 'Please select a Slack channel';
      if (deskType === DeskType.SOCIAL_MEDIA) {
        if (googlePlayApplications.some(application => !application.displayName.trim()))
          return 'Please enter a display name for every application';
        if (
          googlePlayApplications.some(
            application => !ANDROID_PACKAGE_NAME_PATTERN.test(application.packageName),
          )
        )
          return 'Enter a valid Android package name for every application';
        if (
          new Set(googlePlayApplications.map(application => application.packageName)).size !==
          googlePlayApplications.length
        )
          return 'Android package names must be unique';
        if (!boardIdValue) return 'Please select a board';
      }
      if (deskType === DeskType.CALL && !ozonetelConfig?.configured)
        return 'Ozonetel is not configured. Set it up in Desk Integrations first.';
    }
    return null;
  })();

  // Auto-select first project if none selected
  useEffect(() => {
    if (!form.getFieldValue('projectId') && projects && projects.length > 0) {
      form.setFieldValue('projectId', projects[0]!.id);
    }
  }, [projects, form]);

  // Clear board selection when project changes and the selected board no longer belongs
  useEffect(() => {
    if (!boardIdValue) return;
    const boardsForProject = (selectedProject as unknown as { boards?: { id: string }[] })?.boards;
    const boardStillValid = boardsForProject?.some(b => b.id === boardIdValue);
    if (!boardStillValid) {
      form.setFieldValue('boardId', '');
    }
  }, [projectIdValue, selectedProject, boardIdValue, form]);

  // Debounce the channel name for duplicate checking
  useEffect(() => {
    if (channelName.length > 2) {
      const timeoutId = setTimeout(() => {
        setDebouncedChannelName(channelName);
      }, 500);
      return (): void => clearTimeout(timeoutId);
    }
    return (): void => {};
  }, [channelName]);

  // Trigger validation when duplicate check result changes
  useEffect(() => {
    if (duplicateCheck !== undefined) {
      void form.validateField('name', 'change');
    }
  }, [duplicateCheck, form]);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const cleanValue = normalizeChannelName(e.target.value);
    form.setFieldValue('name', cleanValue);
    setChannelName(cleanValue);
  };

  const getCharacterCount = (): number => {
    const name = form.getFieldValue('name');
    return name ? name.length : 0;
  };

  const handleTagAdd = (tag: string): void => {
    const trimmedTag = tag.trim();
    if (!trimmedTag) return;

    const oldTags = form.getFieldValue('topicTags');
    // Prevent duplicate tags
    if (oldTags.includes(trimmedTag)) {
      setTagString('');
      return;
    }

    setTagString('');
    form.setFieldValue('topicTags', [...oldTags, trimmedTag]);
  };

  const handleTagRemove = (tagToRemove: string): void => {
    const tags = form.getFieldValue('topicTags');
    const newTags = tags.filter((tag: string) => tag !== tagToRemove);
    form.setFieldValue('topicTags', newTags);
  };

  const handleTagInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      handleTagAdd(tagString);
    }
  };

  const handleSourceChange = (value: DeskType): void => {
    setDeskType(value);
    setDlEmailInput('');
    setSelectedSlackChannelId('');
    setSelectedInstalledAppId('');
    if (value !== DeskType.EMAIL) setSelectedConnector(null);
  };
  const selectedSource = DESK_SOURCES.find(s => s.value === deskType);

  const renderFormComponent = (): ReactElement => (
    <div data-testid='add-channel-form' className='space-y-6 w-full'>
      {title ? (
        <div className='text-xl font-medium text-foreground mb-1'>{title}</div>
      ) : (
        <div className='text-xl font-medium text-foreground mb-1'>
          {mode === 'promote' ? 'Promote to Channel' : 'Create a channel'}
        </div>
      )}

      {/* Desk source selector */}
      {requireConnector && (
        <div className='space-y-1.5'>
          <label htmlFor='desk-source' className='text-sm font-medium text-foreground'>
            Desk source
          </label>
          <Select value={deskType} onValueChange={value => handleSourceChange(value as DeskType)}>
            <SelectTrigger id='desk-source' className='w-full'>
              <SelectValue placeholder='Select a source' />
            </SelectTrigger>
            <SelectContent>
              {DESK_SOURCES.map(source => {
                const Icon = source.icon;
                return (
                  <SelectItem key={source.value} value={source.value}>
                    <span className='flex items-center gap-2'>
                      <Icon className='w-4 h-4 text-muted-foreground' />
                      {source.label}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {selectedSource && (
            <p className='text-xs text-muted-foreground'>{selectedSource.description}</p>
          )}
        </div>
      )}

      {/* DL Selection (when deskType === DeskType.DL) */}
      {requireConnector && deskType === DeskType.DL && (
        <div className='space-y-2'>
          {!workspaceMailbox?.configured ? (
            <div className='flex items-start gap-2 rounded-lg border border-border bg-muted/50 p-3'>
              <AlertCircle
                size={16}
                className='mt-0.5 flex-shrink-0 text-amber-600 dark:text-amber-400'
              />
              <div className='text-sm text-foreground'>
                <div className='font-medium'>Workspace shared mailbox not configured</div>
                <div className='text-xs text-muted-foreground mt-1'>
                  An admin needs to set up the shared mailbox in{' '}
                  <span className='font-medium'>Desk Integrations</span> before DL desks can be
                  created.
                </div>
              </div>
            </div>
          ) : (
            <>
              <label htmlFor='dl-email' className='text-sm font-medium text-foreground'>
                Distribution List <span className='text-muted-foreground'>*</span>
              </label>
              <Input
                id='dl-email'
                type='email'
                value={dlEmailInput}
                onChange={e => setDlEmailInput(e.target.value.trim().toLowerCase())}
                placeholder={`e.g. support@${workspaceDomain || 'yourcompany.com'}`}
                className='text-foreground'
                aria-invalid={!!dlEmailError}
              />
              {dlEmailError && <p className='text-sm text-destructive'>{dlEmailError}</p>}
              <div className='flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 mt-1'>
                <div className='text-xs text-foreground'>
                  <div className='text-muted-foreground mt-1'>
                    Add{' '}
                    <span className='font-mono text-foreground'>
                      {workspaceMailbox.displayName}
                    </span>{' '}
                    as a member of this distribution list. Without it, mail sent to the DL
                    won&apos;t reach this desk.
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {requireConnector && deskType === DeskType.CALL && (
        <div className='space-y-2'>
          <label htmlFor='call-source-select' className='text-sm font-medium text-foreground'>
            Call source <span className='text-muted-foreground'>*</span>
          </label>
          <Select value={selectedCallSource} disabled>
            <SelectTrigger id='call-source-select' className='w-full'>
              <SelectValue placeholder='Select a source' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='OZONETEL'>Ozonetel</SelectItem>
            </SelectContent>
          </Select>
          {!ozonetelConfig?.configured ? (
            <div className='flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3'>
              <AlertCircle
                size={16}
                className='mt-0.5 flex-shrink-0 text-amber-600 dark:text-amber-400'
              />
              <div className='text-sm text-foreground'>
                <div className='font-medium'>Ozonetel is not configured yet</div>
                <div className='text-xs text-muted-foreground mt-1'>
                  Configure Ozonetel first from{' '}
                  <span className='font-medium'>Desk Integrations</span>, then create this call
                  desk.
                </div>
              </div>
            </div>
          ) : (
            <p className='text-xs text-muted-foreground'>
              Ozonetel is configured. You can route campaigns to this call desk from Desk
              Integrations.
            </p>
          )}
        </div>
      )}

      {/* Slack Channel Selection */}
      {requireConnector && deskType === DeskType.SLACK && (
        <div className='space-y-2'>
          <label htmlFor='slack-channel-select' className='text-sm font-medium text-foreground'>
            Slack Channel <span className='text-muted-foreground'>*</span>
          </label>
          {isLoadingSlackChannels ? (
            <div className='flex items-center gap-2 py-3 text-sm text-muted-foreground'>
              <div className='h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent' />
              Loading Slack channels...
            </div>
          ) : !slackChannelsData?.length ? (
            <div className='flex items-start gap-2 rounded-lg border border-border bg-muted/50 p-3'>
              <AlertCircle
                size={16}
                className='mt-0.5 flex-shrink-0 text-amber-600 dark:text-amber-400'
              />
              <div className='text-sm text-foreground'>
                <div className='font-medium'>No Slack channels found</div>
                <div className='text-xs text-muted-foreground mt-1'>
                  The Xyne bot is not a member of any channels. Invite it to a channel first using{' '}
                  <span className='font-mono'>/invite @XyneBot</span> in Slack.
                </div>
              </div>
            </div>
          ) : (
            <>
              <Select value={selectedSlackChannelId} onValueChange={setSelectedSlackChannelId}>
                <SelectTrigger id='slack-channel-select' className='w-full'>
                  <SelectValue placeholder='Select a Slack channel' />
                </SelectTrigger>
                <SelectContent>
                  {slackChannelsData
                    .filter(ch => !ch.alreadyConnected)
                    .map(ch => (
                      <SelectItem key={ch.id} value={ch.id}>
                        <span className='mr-1 text-muted-foreground'>
                          {ch.is_private ? '\uD83D\uDD12' : '#'}
                        </span>
                        {ch.name}
                        <span className='ml-2 text-xs text-muted-foreground'>
                          ({ch.num_members} members)
                        </span>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {slackChannelsData.some(ch => ch.alreadyConnected) && (
                <p className='text-xs text-muted-foreground'>
                  Already connected channels are hidden from this list.
                </p>
              )}
              <p className='text-xs text-muted-foreground'>
                Don&apos;t see your channel? Invite the Xyne bot to it first in Slack.
              </p>
            </>
          )}
        </div>
      )}

      {/* Xyne App Selection */}
      {requireConnector && deskType === DeskType.APP && (
        <div className='space-y-2'>
          <label htmlFor='app-desk-select' className='text-sm font-medium text-foreground'>
            Xyne App <span className='text-muted-foreground'>*</span>
          </label>
          {isLoadingEligibleApps ? (
            <div className='flex items-center gap-2 py-3 text-sm text-muted-foreground'>
              <div className='h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent' />
              Loading apps...
            </div>
          ) : !eligibleAppsData?.length ? (
            <div className='flex items-start gap-2 rounded-lg border border-border bg-muted/50 p-3'>
              <AlertCircle
                size={16}
                className='mt-0.5 flex-shrink-0 text-amber-600 dark:text-amber-400'
              />
              <div className='text-sm text-foreground'>
                <div className='font-medium'>No eligible apps found</div>
                <div className='text-xs text-muted-foreground mt-1'>
                  An app must be installed with the <span className='font-mono'>desk:write</span>{' '}
                  permission. Set this up in <span className='font-medium'>Xyne Apps</span> first.
                </div>
              </div>
            </div>
          ) : (
            <>
              <Select value={selectedInstalledAppId} onValueChange={setSelectedInstalledAppId}>
                <SelectTrigger id='app-desk-select' className='w-full'>
                  <SelectValue placeholder='Select a Xyne App' />
                </SelectTrigger>
                <SelectContent>
                  {eligibleAppsData.map(app => (
                    <SelectItem key={app.installedAppId} value={app.installedAppId}>
                      {app.name}
                      {app.description && (
                        <span className='ml-2 text-xs text-muted-foreground'>
                          {app.description}
                        </span>
                      )}
                      {!!app.deskCount && (
                        <span className='ml-2 text-xs text-muted-foreground'>
                          backs {app.deskCount} desk{app.deskCount === 1 ? '' : 's'}
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className='text-xs text-muted-foreground'>
                One app can back multiple desks. Your app receives the{' '}
                <span className='font-mono'>channelId</span> on every event to tell them apart.
              </p>
            </>
          )}
        </div>
      )}

      {requireConnector && deskType === DeskType.SOCIAL_MEDIA && (
        <div className='space-y-4'>
          <div className='space-y-2'>
            <label htmlFor='social-provider' className='text-sm font-medium text-foreground'>
              Source <span className='text-muted-foreground'>*</span>
            </label>
            <Select value='GOOGLE_PLAY' disabled>
              <SelectTrigger id='social-provider' className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='GOOGLE_PLAY'>Google Play reviews</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-3'>
            <div className='flex items-center justify-between'>
              <div className='text-sm font-medium text-foreground'>
                Google Play applications <span className='text-muted-foreground'>*</span>
              </div>
              <button
                type='button'
                onClick={() =>
                  setGooglePlayApplications(applications => [
                    ...applications,
                    createGooglePlayApplication(),
                  ])
                }
                disabled={googlePlayApplications.length >= 20}
                className='inline-flex items-center gap-1 text-sm text-primary hover:text-primary/80 disabled:cursor-not-allowed disabled:opacity-50'
                data-track-category='ADD_CHANNEL_FORM'
                data-track-name='ADD_GOOGLE_PLAY_APPLICATION'
              >
                <Plus className='size-4' />
                Add application
              </button>
            </div>
            {googlePlayApplications.map((application, index) => {
              const duplicatePackage =
                Boolean(application.packageName) &&
                googlePlayApplications.some(
                  (candidate, candidateIndex) =>
                    candidateIndex !== index && candidate.packageName === application.packageName,
                );
              const invalidPackage =
                Boolean(application.packageName) &&
                !ANDROID_PACKAGE_NAME_PATTERN.test(application.packageName);
              return (
                <div
                  key={application.id}
                  className='space-y-3 rounded-lg border border-border bg-muted/20 p-3'
                >
                  <div className='flex items-center justify-between'>
                    <span className='text-sm font-medium text-foreground'>
                      Application {index + 1}
                    </span>
                    {googlePlayApplications.length > 1 && (
                      <button
                        type='button'
                        onClick={() =>
                          setGooglePlayApplications(applications =>
                            applications.filter(
                              (_, applicationIndex) => applicationIndex !== index,
                            ),
                          )
                        }
                        className='text-muted-foreground hover:text-destructive'
                        aria-label={`Remove application ${index + 1}`}
                        data-track-category='ADD_CHANNEL_FORM'
                        data-track-name='REMOVE_GOOGLE_PLAY_APPLICATION'
                      >
                        <Trash2 className='size-4' />
                      </button>
                    )}
                  </div>
                  <div className='space-y-2'>
                    <label
                      htmlFor={`google-play-app-name-${index}`}
                      className='text-sm text-foreground'
                    >
                      App display name
                    </label>
                    <Input
                      id={`google-play-app-name-${index}`}
                      value={application.displayName}
                      onChange={event =>
                        setGooglePlayApplications(applications =>
                          applications.map((candidate, applicationIndex) =>
                            applicationIndex === index
                              ? { ...candidate, displayName: event.target.value }
                              : candidate,
                          ),
                        )
                      }
                      placeholder='Xyne'
                      autoComplete='off'
                    />
                  </div>
                  <div className='space-y-2'>
                    <label
                      htmlFor={`android-package-name-${index}`}
                      className='text-sm text-foreground'
                    >
                      Android package name
                    </label>
                    <Input
                      id={`android-package-name-${index}`}
                      value={application.packageName}
                      onChange={event =>
                        setGooglePlayApplications(applications =>
                          applications.map((candidate, applicationIndex) =>
                            applicationIndex === index
                              ? { ...candidate, packageName: event.target.value.trim() }
                              : candidate,
                          ),
                        )
                      }
                      placeholder='com.example.app'
                      autoComplete='off'
                      aria-invalid={invalidPackage || duplicatePackage}
                    />
                    {invalidPackage && (
                      <p className='text-sm text-destructive'>Enter a valid package name.</p>
                    )}
                    {duplicatePackage && (
                      <p className='text-sm text-destructive'>
                        This package name has already been added.
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
            <p className='text-xs text-muted-foreground'>
              One Google authorization will be used for every application in this channel.
            </p>
          </div>
        </div>
      )}

      {/* Connector Selection (for personal mailbox desks) */}
      {requireConnector && deskType === DeskType.EMAIL && (
        <div className='space-y-2'>
          <div className='text-sm font-medium text-foreground'>
            Email Provider <span className='text-muted-foreground'>*</span>
          </div>
          <div className='flex gap-3'>
            <button
              type='button'
              onClick={() => setSelectedConnector('google')}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-all',
                selectedConnector === 'google'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-foreground hover:border-muted-foreground/50',
              )}
              data-track-category='ADD_CHANNEL_FORM'
              data-track-name='SELECT_GOOGLE_PROVIDER'
            >
              <svg className='w-5 h-5' viewBox='0 0 24 24' fill='currentColor'>
                <path d='M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z' />
                <path d='M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z' />
                <path d='M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z' />
                <path d='M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z' />
              </svg>
              <span className='font-medium'>Google</span>
            </button>
            {oauthProviders?.microsoft && (
              <button
                type='button'
                onClick={() => setSelectedConnector('microsoft')}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-all',
                  selectedConnector === 'microsoft'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-foreground hover:border-muted-foreground/50',
                )}
                data-track-category='ADD_CHANNEL_FORM'
                data-track-name='SELECT_MICROSOFT_PROVIDER'
              >
                <svg className='w-5 h-5' viewBox='0 0 21 21' fill='currentColor'>
                  <path d='M10 0H0v10h10V0zM21 0H11v10h10V0zM10 11H0v10h10V11zM21 11H11v10h10V11z' />
                </svg>
                <span className='font-medium'>Microsoft</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Channel Name */}
      <form.Field
        name='name'
        validators={{
          onChange: ({ value }) => {
            if (!value) return 'Channel name is required';
            if (value.length < 2) return 'Channel name must be at least 2 characters';
            if (value.length > 80) return 'Channel name must be 80 characters or less';
            if (duplicateCheck?.isDuplicate) return 'Channel name already exists';
            return undefined;
          },
        }}
      >
        {field => (
          <div className='space-y-1.5'>
            <label htmlFor='channel-name' className='text-sm font-medium text-foreground'>
              Channel Name <span className='text-muted-foreground'>*</span>
            </label>
            <div className='relative'>
              <div className='absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground'>
                {hideVisibility ? (
                  <Hash size={14} />
                ) : visibility === 'private' ? (
                  <Lock size={14} />
                ) : (
                  <Hash size={14} />
                )}
              </div>
              <Input
                id='channel-name'
                value={field.state.value}
                onChange={handleNameChange}
                placeholder='e.g. general, development, support'
                className='pl-8 pr-12 text-foreground'
                aria-invalid={field.state.meta.errors.length > 0}
                data-testid='channel-name-input'
                data-track-category='ADD_CHANNEL_FORM'
                data-track-name='EDIT_CHANNEL_NAME'
                data-track-metadata={JSON.stringify({ mode, channelName: field.state.value })}
                autoFocus={!isMobile}
              />
              <div className='absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground'>
                {getCharacterCount()}/80
              </div>
            </div>
            {field.state.meta.errors.length > 0 && field.state.meta.errors[0] && (
              <p className='text-sm text-destructive'>{field.state.meta.errors[0]}</p>
            )}
          </div>
        )}
      </form.Field>

      {/* Project Selection */}
      <form.Field
        name='projectId'
        validators={{
          onChange: ({ value }) => {
            if (!value?.trim()) return 'Project is required';
            return undefined;
          },
        }}
      >
        {field => (
          <div className='space-y-1.5'>
            <p className='text-sm font-medium text-foreground'>Project *</p>
            <EntitySelector
              testId='project-select-trigger'
              options={projectOptions}
              selectedValue={field.state.value || null}
              onSelect={val => field.handleChange(val ?? '')}
              placeholder={projectOptions.length > 0 ? 'Select a project' : 'No projects available'}
              searchPlaceholder='Search projects...'
              width='100%'
            />
            {field.state.meta.errors.length > 0 && (
              <p className='text-sm text-destructive'>{field.state.meta.errors[0] as string}</p>
            )}
            {projectOptions.length === 0 && (
              <p className='text-sm text-status-pending mt-1'>
                No projects found. Please create a project first.
              </p>
            )}
          </div>
        )}
      </form.Field>

      {/* Board Selection (desk channels only) */}
      {requireConnector && (
        <form.Field name='boardId'>
          {field => (
            <div className='space-y-1.5'>
              <label htmlFor='board-select' className='text-sm font-medium text-foreground'>
                Board
              </label>
              <Select
                value={field.state.value || ''}
                onValueChange={selected => field.handleChange(selected || undefined)}
                disabled={!projectIdValue || boardOptions.length === 0}
              >
                <SelectTrigger id='board-select' className='w-full'>
                  <SelectValue
                    placeholder={
                      !projectIdValue
                        ? 'Select a project first'
                        : boardOptions.length > 0
                          ? 'Select a board'
                          : 'No boards available'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {boardOptions.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {boardOptions.length === 0 && projectIdValue && (
                <p className='text-sm text-muted-foreground mt-1'>
                  No boards found for this project.
                </p>
              )}
            </div>
          )}
        </form.Field>
      )}

      {/* Assignee User Group Selection (for email channels only) */}
      {requireConnector && (
        <form.Field name='assigneeUserGroupId'>
          {field => (
            <div className='space-y-1.5'>
              <label
                htmlFor='assignee-group-select'
                className='text-sm font-medium text-foreground'
              >
                Assignee User Group (optional)
              </label>
              <Select
                value={field.state.value || ''}
                onValueChange={selected => field.handleChange(selected || undefined)}
                disabled={userGroupOptions.length === 0}
              >
                <SelectTrigger id='assignee-group-select' className='w-full'>
                  <SelectValue
                    placeholder={
                      userGroupOptions.length > 0
                        ? 'Select a user group'
                        : 'No user groups available'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {userGroupOptions.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {userGroupOptions.length === 0 && (
                <p className='text-sm text-muted-foreground mt-1'>
                  No user groups found. You can create one later.
                </p>
              )}
              <p className='text-sm text-muted-foreground mt-1'>
                This user group will be assigned to tickets created from emails in this channel.
              </p>
            </div>
          )}
        </form.Field>
      )}

      {/* Description */}
      <form.Field name='description'>
        {field => (
          <div className='space-y-1.5'>
            <label htmlFor='channel-description' className='text-sm font-medium text-foreground'>
              Description (optional)
            </label>
            <Textarea
              id='channel-description'
              value={field.state.value}
              className='text-foreground'
              onChange={e => field.handleChange(e.target.value)}
              placeholder='What is this channel about?'
              rows={4}
              data-track-category='ADD_CHANNEL_FORM'
              data-track-name='Edit_Channel_Description'
            />
          </div>
        )}
      </form.Field>

      {/* Channel Visibility */}
      {!hideVisibility && (
        <form.Field name='visibility'>
          {field => (
            <div>
              <RadioGroup
                name='visibility'
                label='Channel Visibility'
                value={field.state.value}
                onChange={value => field.handleChange(value as 'public' | 'private')}
              >
                <Radio value='public' subtext='Anyone in the organization can view and join'>
                  Public
                </Radio>
                <Radio value='private' subtext='Only invited members can view and join'>
                  Private
                </Radio>
              </RadioGroup>
            </div>
          )}
        </form.Field>
      )}

      {/* Topic Tags */}
      <form.Field name='topicTags'>
        {field => (
          <div className='space-y-1.5'>
            <label htmlFor='topic-tags' className='text-sm font-medium text-foreground'>
              Topic Tags (optional)
            </label>
            {field.state.value.length > 0 && (
              <div className='flex flex-wrap gap-2'>
                {field.state.value.map((tag, index) => (
                  <Badge
                    key={index}
                    variant='secondary'
                    className='cursor-pointer hover:bg-secondary/80 transition-colors'
                    onClick={() => handleTagRemove(tag)}
                    data-track-category='ADD_CHANNEL_FORM'
                    data-track-name='Remove_Topic_Tag'
                    data-track-metadata={JSON.stringify({ tag })}
                  >
                    {tag}
                    <span className='ml-1 text-xs'>×</span>
                  </Badge>
                ))}
              </div>
            )}
            <Input
              id='topic-tags'
              type='text'
              className='text-foreground'
              value={tagString}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTagString(e.target.value)}
              onKeyDown={handleTagInputKeyDown}
              placeholder='Type a tag and press Enter or add comma'
              data-track-category='ADD_CHANNEL_FORM'
              data-track-name='Edit_Topic_Tag'
            />
            <p className='text-xs text-muted-foreground'>
              Add tags to help organize and discover this channel
            </p>
          </div>
        )}
      </form.Field>

      <div className='flex justify-end space-x-3 pt-4'>
        {onCancel && (
          <Button
            variant='outline'
            size='default'
            type='button'
            onClick={e => {
              e.preventDefault();
              onCancel();
            }}
            data-track-category='ADD_CHANNEL_FORM'
            data-track-name='Cancel_Create_Channel'
          >
            Cancel
          </Button>
        )}
        <Tooltip
          content={submitDisabledReason ?? ''}
          {...(isSubmitDisabled && Boolean(submitDisabledReason) ? {} : { open: false })}
          side='top'
        >
          <span className={cn('inline-flex', isSubmitDisabled && 'cursor-not-allowed')}>
            <Button
              variant='default'
              size='default'
              loading={loading || false}
              type='submit'
              disabled={isSubmitDisabled}
              className={cn(
                'bg-action-primary text-action-primary-foreground hover:bg-action-primary/90 disabled:opacity-50',
                isSubmitDisabled && 'pointer-events-none',
              )}
              data-testid='create-channel-button'
              trackId={mode === 'promote' ? 'promote_group_dm_to_channel' : 'create_channel'}
              data-track-category='ADD_CHANNEL_FORM'
              data-track-name='CREATE_CHANNEL_SUBMIT'
              data-track-metadata={JSON.stringify({ mode, channelName })}
            >
              {mode === 'promote' ? 'Promote to Channel' : 'Create Channel'}
            </Button>
          </span>
        </Tooltip>
      </div>
    </div>
  );

  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        e.stopPropagation();
        void form.handleSubmit();
      }}
    >
      {renderFormComponent()}
    </form>
  );
};

export default AddChannelForm;
