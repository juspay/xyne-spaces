import { type ChangeEvent, type ReactElement, useEffect, useMemo, useState } from 'react';
import { useAllChannels } from '../../hooks/useChannels';
import { useUsers } from '../../hooks/useUsers';
import { useAuthContextValues } from '../../hooks/useAuth';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { Button } from '../../components/ui/Button/Button';
import Input from '../../components/ui/Input/Input';
import Textarea from '../../components/ui/Textarea/Textarea';
import { EntitySelector } from '../../components/ui/EntitySelector/EntitySelector';
import { Hash, User, Users, FileArchive } from 'lucide-react';
import { toast } from 'sonner';
import { ChannelScopeType } from '@xyne/shared';
import { getDMParticipantIdsToFetch } from '../../components/Chat/ChatDirectory/ChatDirectory.utils';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { channelService } from '../../services/Chat/channelService';
import {
  whatsAppMigrationService,
  type WhatsAppImportSourceSummary,
  type WhatsAppMigrationJobProgress,
  type WhatsAppPurgeImportResponse,
  type WhatsAppMigrationPreviewResponse,
} from '../../services/WhatsAppMigration/whatsAppMigrationService';

type MappingEntry = {
  whatsappName: string;
  email: string;
};

type WhatsAppMigrationTab = 'import' | 'delete';

const CHANNEL_TARGET_PREFIX = 'channel:';
const USER_TARGET_PREFIX = 'user:';

const parseMappings = (rawValue: string): MappingEntry[] =>
  rawValue
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [whatsappName, email] = line.split(',').map(part => part.trim());
      return { whatsappName: whatsappName || '', email: email || '' };
    })
    .filter(entry => Boolean(entry.whatsappName) && Boolean(entry.email));

const getTargetChannelLabel = (
  channel: {
    id: string;
    name: string;
    scopeType: ChannelScopeType;
  },
  currentUserId: string,
  allUsers: { id: string; name?: string | null; email?: string | null }[],
): string => {
  if (channel.scopeType === ChannelScopeType.DEFAULT) return channel.name;

  const participantNames = getDMParticipantIdsToFetch(channel, currentUserId)
    .map(id => allUsers.find(user => user.id === id))
    .filter((user): user is (typeof allUsers)[number] => Boolean(user))
    .map(user => getUserDisplayName(user))
    .filter(Boolean);

  return participantNames.length > 0 ? participantNames.join(', ') : channel.name;
};

const getTargetChannelValue = (channelId: string): string => `${CHANNEL_TARGET_PREFIX}${channelId}`;
const getTargetUserValue = (userId: string): string => `${USER_TARGET_PREFIX}${userId}`;

const parseTargetValue = (
  value: string | null,
): { type: 'channel' | 'user'; id: string } | null => {
  if (!value) return null;
  if (value.startsWith(CHANNEL_TARGET_PREFIX)) {
    return { type: 'channel', id: value.slice(CHANNEL_TARGET_PREFIX.length) };
  }
  if (value.startsWith(USER_TARGET_PREFIX)) {
    return { type: 'user', id: value.slice(USER_TARGET_PREFIX.length) };
  }
  return { type: 'channel', id: value };
};

const WhatsAppMigrationPanel = (): ReactElement => {
  const [workspaceUsers] = useCachedQuery(queries.getUsersV2());
  const [selectedTargetValue, setSelectedTargetValue] = useState('');
  const [selectedChannelId, setSelectedChannelId] = useState('');
  const [mappingsInput, setMappingsInput] = useState('');
  const [mappingCsvFile, setMappingCsvFile] = useState<File | null>(null);
  const [archiveFile, setArchiveFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<WhatsAppMigrationPreviewResponse | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isExecuteLoading, setIsExecuteLoading] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<WhatsAppMigrationJobProgress | null>(null);
  const [importSources, setImportSources] = useState<WhatsAppImportSourceSummary[]>([]);
  const [isSourcesLoading, setIsSourcesLoading] = useState(false);
  const [selectedPurgeSourceId, setSelectedPurgeSourceId] = useState('');
  const [purgePreview, setPurgePreview] = useState<WhatsAppPurgeImportResponse | null>(null);
  const [isPurgeLoading, setIsPurgeLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<WhatsAppMigrationTab>('import');
  const allChannels = useAllChannels();
  const hydratedUsers = useUsers();
  const allUsers = workspaceUsers.length > 0 ? workspaceUsers : hydratedUsers;
  const { userID } = useAuthContextValues();

  const targetOptions = useMemo(
    () => [
      ...allChannels
        .filter(
          channel =>
            !channel.isArchived &&
            (channel.scopeType === ChannelScopeType.DEFAULT ||
              channel.scopeType === ChannelScopeType.DM ||
              channel.scopeType === ChannelScopeType.GROUP_DM),
        )
        .sort((a, b) =>
          getTargetChannelLabel(a, userID ?? '', allUsers).localeCompare(
            getTargetChannelLabel(b, userID ?? '', allUsers),
          ),
        )
        .map(channel => ({
          value: getTargetChannelValue(channel.id),
          label: getTargetChannelLabel(channel, userID ?? '', allUsers),
          icon: <Hash className='w-4 h-4 text-muted-foreground' />,
          subtitle:
            channel.scopeType === ChannelScopeType.DEFAULT ? 'Existing channel' : 'Existing DM',
        })),
      ...allUsers
        .sort((a, b) => getUserDisplayName(a).localeCompare(getUserDisplayName(b)))
        .map(user => ({
          value: getTargetUserValue(user.id),
          label:
            user.id === userID ? `${getUserDisplayName(user)} (you)` : getUserDisplayName(user),
          icon: <User className='w-4 h-4 text-muted-foreground' />,
          subtitle: user.email || 'Create or reuse personal DM',
        })),
    ],
    [allChannels, allUsers, userID],
  );

  const resolveTargetChannelId = async (value: string | null): Promise<string> => {
    const parsed = parseTargetValue(value);
    if (!parsed) return '';
    if (parsed.type === 'channel') return parsed.id;

    const result = await channelService.createDm({ participantIds: [parsed.id] });
    return result.id;
  };

  useEffect(() => {
    if (!activeJobId) return;

    let cancelled = false;
    const poll = async (): Promise<void> => {
      try {
        const nextProgress = await whatsAppMigrationService.getStatus(activeJobId);
        if (cancelled) return;
        setJobProgress(nextProgress);

        if (nextProgress.status === 'completed') {
          toast.success('WhatsApp migration completed');
          setActiveJobId(null);
          return;
        }

        if (nextProgress.status === 'failed') {
          toast.error(nextProgress.errorMessage || 'WhatsApp migration failed');
          setActiveJobId(null);
          return;
        }

        window.setTimeout(() => {
          void poll();
        }, 2000);
      } catch (error) {
        if (cancelled) return;
        toast.error(error instanceof Error ? error.message : 'Failed to fetch migration status');
        setActiveJobId(null);
      }
    };

    void poll();
    return () => {
      cancelled = true;
    };
  }, [activeJobId]);

  useEffect(() => {
    setImportSources([]);
    setSelectedPurgeSourceId('');
    setPurgePreview(null);

    if (!selectedChannelId) return;

    let cancelled = false;
    setIsSourcesLoading(true);

    void whatsAppMigrationService
      .listSources(selectedChannelId)
      .then(result => {
        if (cancelled) return;
        setImportSources(result);
      })
      .catch(error => {
        if (cancelled) return;
        toast.error(error instanceof Error ? error.message : 'Failed to load imported sources');
      })
      .finally(() => {
        if (!cancelled) setIsSourcesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedChannelId, jobProgress?.status]);

  const buildPayload = (): FormData | null => {
    if (!archiveFile) {
      toast.error('Choose WhatsApp zip first');
      return null;
    }
    if (!selectedChannelId) {
      toast.error('Select target channel');
      return null;
    }

    const mappings = parseMappings(mappingsInput);
    if (mappings.length === 0 && !mappingCsvFile) {
      toast.error('Add mappings in textarea or upload CSV file');
      return null;
    }

    const payload = new FormData();
    payload.append('archive', archiveFile);
    payload.append('targetChannelId', selectedChannelId);
    if (mappings.length > 0) {
      payload.append('mappingJson', JSON.stringify(mappings));
    }
    if (mappingCsvFile) {
      payload.append('mappingFile', mappingCsvFile);
    }
    return payload;
  };

  const handlePreview = async (): Promise<void> => {
    const payload = buildPayload();
    if (!payload) return;
    setIsPreviewLoading(true);
    try {
      const result = await whatsAppMigrationService.preview(payload);
      setPreview(result);
      toast.success('Preview ready');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Preview failed');
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleExecute = async (): Promise<void> => {
    const payload = buildPayload();
    if (!payload) return;
    setIsExecuteLoading(true);
    try {
      const result = await whatsAppMigrationService.execute(payload);
      setActiveJobId(result.jobId);
      setJobProgress(null);
      toast.success('WhatsApp migration started');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to start migration');
    } finally {
      setIsExecuteLoading(false);
    }
  };

  const refreshSources = async (): Promise<void> => {
    if (!selectedChannelId) return;
    setIsSourcesLoading(true);
    try {
      const result = await whatsAppMigrationService.listSources(selectedChannelId);
      setImportSources(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to refresh imported sources');
    } finally {
      setIsSourcesLoading(false);
    }
  };

  const handlePurgePreview = async (): Promise<void> => {
    if (!selectedChannelId || !selectedPurgeSourceId) {
      toast.error('Select a channel and imported source first');
      return;
    }

    setIsPurgeLoading(true);
    try {
      const result = await whatsAppMigrationService.purgeImport({
        targetChannelId: selectedChannelId,
        externalSourceId: selectedPurgeSourceId,
        dryRun: true,
      });
      setPurgePreview(result);
      toast.success('Delete preview ready');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to preview delete');
    } finally {
      setIsPurgeLoading(false);
    }
  };

  const handlePurgeExecute = async (): Promise<void> => {
    if (!selectedChannelId || !selectedPurgeSourceId) {
      toast.error('Select a channel and imported source first');
      return;
    }
    if (
      !window.confirm('Delete imported WhatsApp messages for this source? This cannot be undone.')
    ) {
      return;
    }

    setIsPurgeLoading(true);
    try {
      const result = await whatsAppMigrationService.purgeImport({
        targetChannelId: selectedChannelId,
        externalSourceId: selectedPurgeSourceId,
        dryRun: false,
      });
      setPurgePreview(result);
      setSelectedPurgeSourceId('');
      await refreshSources();
      toast.success('Imported WhatsApp messages deleted');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete imported messages');
    } finally {
      setIsPurgeLoading(false);
    }
  };

  return (
    <div className='space-y-6'>
      <section className='overflow-hidden rounded-3xl border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.96))] shadow-sm'>
        <div className='border-b border-border/70 bg-background/90 px-5 py-4'>
          <div className='flex flex-wrap gap-2'>
            <button
              type='button'
              onClick={() => setActiveTab('import')}
              data-track-category='whatsapp-migration'
              data-track-name='open-import-tab'
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                activeTab === 'import'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'border border-border/70 bg-background text-muted-foreground hover:text-foreground'
              }`}
            >
              Import
            </button>
            <button
              type='button'
              onClick={() => setActiveTab('delete')}
              data-track-category='whatsapp-migration'
              data-track-name='open-delete-tab'
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                activeTab === 'delete'
                  ? 'bg-rose-600 text-white shadow-sm'
                  : 'border border-border/70 bg-background text-muted-foreground hover:text-foreground'
              }`}
            >
              Delete Imported Messages
            </button>
          </div>
        </div>

        {activeTab === 'import' ? (
          <>
            <div className='border-b border-border/70 bg-[linear-gradient(135deg,rgba(34,197,94,0.08),rgba(59,130,246,0.06),transparent)] px-5 py-4'>
              <h3 className='text-sm font-semibold text-foreground'>WhatsApp Import Inputs</h3>
              <p className='mt-1 text-xs text-muted-foreground'>
                Upload one zip, map participant names to emails, preview, then import into existing
                channel.
              </p>
            </div>
            <div className='p-5 space-y-5'>
              <div className='rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm'>
                <label
                  htmlFor='whatsapp-zip-input'
                  className='mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'
                >
                  <FileArchive className='h-3.5 w-3.5' />
                  WhatsApp Zip
                </label>
                <Input
                  id='whatsapp-zip-input'
                  type='file'
                  accept='.zip,application/zip'
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    setArchiveFile(event.target.files?.[0] || null);
                    setPreview(null);
                  }}
                />
                <p className='mt-2 text-xs text-muted-foreground'>
                  Each WhatsApp message will be imported as a separate standalone message into a
                  regular channel or personal DM.
                </p>
              </div>

              <div className='grid grid-cols-1 gap-4'>
                <div className='rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm'>
                  <p className='mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
                    Target Channel
                  </p>
                  <EntitySelector
                    options={targetOptions}
                    selectedValue={selectedTargetValue || null}
                    onSelect={value => {
                      setSelectedTargetValue(value ?? '');
                      setSelectedChannelId('');
                      setPreview(null);

                      if (!value) {
                        return;
                      }

                      void resolveTargetChannelId(value)
                        .then(channelId => {
                          setSelectedChannelId(channelId);
                        })
                        .catch(error => {
                          setSelectedTargetValue('');
                          setSelectedChannelId('');
                          toast.error(
                            error instanceof Error ? error.message : 'Failed to prepare DM target',
                          );
                        });
                    }}
                    placeholder='Select channel or user'
                    searchPlaceholder='Search channels or users...'
                    width='100%'
                  />
                </div>
              </div>

              <div className='rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm'>
                <label
                  htmlFor='whatsapp-mappings-input'
                  className='mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'
                >
                  <Users className='h-3.5 w-3.5' />
                  Name → Email Mappings
                </label>
                <Textarea
                  id='whatsapp-mappings-input'
                  value={mappingsInput}
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                    setMappingsInput(event.target.value)
                  }
                  placeholder={`Alice Doe, alice@example.com\nBob Ops, bob@example.com`}
                  className='min-h-[150px]'
                />
                <p className='mt-2 text-xs text-muted-foreground'>
                  One line each. Format: `WhatsApp Name, email@example.com`
                </p>
              </div>

              <div className='rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm'>
                <label
                  htmlFor='whatsapp-mapping-csv-input'
                  className='mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'
                >
                  <Users className='h-3.5 w-3.5' />
                  Mapping CSV
                </label>
                <Input
                  id='whatsapp-mapping-csv-input'
                  type='file'
                  accept='.csv,text/csv,.txt,text/plain'
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    setMappingCsvFile(event.target.files?.[0] || null);
                  }}
                />
                <p className='mt-2 text-xs text-muted-foreground'>
                  Optional. Upload `name,email` CSV. If both textarea and CSV are given, both are
                  merged.
                </p>
              </div>

              <div className='flex flex-wrap justify-end gap-3'>
                <Button
                  variant='outline'
                  onClick={() => void handlePreview()}
                  data-track-category='whatsapp-migration'
                  data-track-name='PREVIEW_MIGRATION'
                  disabled={isPreviewLoading}
                >
                  {isPreviewLoading ? 'Previewing…' : 'Preview Import'}
                </Button>
                <Button
                  onClick={() => void handleExecute()}
                  data-track-category='whatsapp-migration'
                  data-track-name='EXECUTE_MIGRATION'
                  disabled={isExecuteLoading}
                >
                  {isExecuteLoading ? 'Starting…' : 'Start Import'}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className='border-b border-border/70 bg-[linear-gradient(135deg,rgba(244,63,94,0.08),rgba(249,115,22,0.06),transparent)] px-5 py-4'>
              <h3 className='text-sm font-semibold text-foreground'>
                Delete Imported WhatsApp Messages
              </h3>
              <p className='mt-1 text-xs text-muted-foreground'>
                Only removes messages created by one WhatsApp import source in the selected channel.
              </p>
            </div>
            <div className='p-5 space-y-5'>
              <div className='grid grid-cols-1 gap-4'>
                <div className='rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm'>
                  <p className='mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
                    Target Channel
                  </p>
                  <EntitySelector
                    options={targetOptions}
                    selectedValue={selectedTargetValue || null}
                    onSelect={value => {
                      setSelectedTargetValue(value ?? '');
                      setSelectedChannelId('');
                      setSelectedPurgeSourceId('');
                      setPurgePreview(null);

                      if (!value) {
                        return;
                      }

                      void resolveTargetChannelId(value)
                        .then(channelId => {
                          setSelectedChannelId(channelId);
                        })
                        .catch(error => {
                          setSelectedTargetValue('');
                          setSelectedChannelId('');
                          toast.error(
                            error instanceof Error ? error.message : 'Failed to prepare DM target',
                          );
                        });
                    }}
                    placeholder='Select channel or user'
                    searchPlaceholder='Search channels or users...'
                    width='100%'
                  />
                </div>
              </div>

              <div className='rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm'>
                <p className='mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
                  Imported Sources In Channel
                </p>
                {selectedChannelId ? (
                  isSourcesLoading ? (
                    <div className='text-sm text-muted-foreground'>Loading imported sources…</div>
                  ) : importSources.length ? (
                    <div className='space-y-2'>
                      {importSources.map(source => {
                        const isSelected = selectedPurgeSourceId === source.externalSourceId;
                        return (
                          <button
                            key={source.externalSourceId}
                            type='button'
                            onClick={() => {
                              setSelectedPurgeSourceId(source.externalSourceId);
                              setPurgePreview(null);
                            }}
                            data-track-category='whatsapp-migration'
                            data-track-name='select-delete-source'
                            className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                              isSelected
                                ? 'border-rose-300 bg-rose-50/80'
                                : 'border-border/70 bg-background/70 hover:border-rose-200'
                            }`}
                          >
                            <div className='flex flex-wrap items-center justify-between gap-3'>
                              <div>
                                <div className='text-sm font-semibold text-foreground'>
                                  {source.chatName || source.displayName}
                                </div>
                                <div className='mt-1 text-xs text-muted-foreground'>
                                  Source ID: {source.externalSourceId}
                                </div>
                              </div>
                              <div className='text-right text-xs text-muted-foreground'>
                                <div>{source.importedMessageCount} messages</div>
                                <div>{source.attachmentCount} attachments</div>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className='text-sm text-muted-foreground'>
                      No WhatsApp imports found for this channel.
                    </div>
                  )
                ) : (
                  <div className='text-sm text-muted-foreground'>
                    Select a target channel to manage imported WhatsApp messages.
                  </div>
                )}
              </div>

              <div className='rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm space-y-4'>
                <p className='text-sm text-muted-foreground'>
                  This deletes only the messages imported by the selected WhatsApp source.
                </p>
                <div className='flex flex-wrap justify-end gap-3'>
                  <Button
                    variant='outline'
                    onClick={() => void handlePurgePreview()}
                    data-track-category='whatsapp-migration'
                    data-track-name='PREVIEW_PURGE'
                    disabled={isPurgeLoading || !selectedPurgeSourceId}
                  >
                    {isPurgeLoading ? 'Checking…' : 'Preview Delete'}
                  </Button>
                  <Button
                    variant='destructive'
                    onClick={() => void handlePurgeExecute()}
                    data-track-category='whatsapp-migration'
                    data-track-name='EXECUTE_PURGE'
                    disabled={isPurgeLoading || !selectedPurgeSourceId}
                  >
                    {isPurgeLoading ? 'Deleting…' : 'Delete Imported Messages'}
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </section>

      {activeTab === 'import' && preview ? (
        <section className='rounded-3xl border border-border/70 bg-card/70 p-5 shadow-sm space-y-4'>
          <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
            <div className='rounded-2xl border border-border/70 bg-background/70 p-3'>
              <div className='text-[11px] uppercase text-muted-foreground'>Chat</div>
              <div className='mt-1 text-sm font-semibold text-foreground'>
                {preview.chatName || 'Unknown'}
              </div>
            </div>
            <div className='rounded-2xl border border-border/70 bg-background/70 p-3'>
              <div className='text-[11px] uppercase text-muted-foreground'>Messages</div>
              <div className='mt-1 text-sm font-semibold text-foreground'>
                {preview.messageCount}
              </div>
            </div>
            <div className='rounded-2xl border border-border/70 bg-background/70 p-3'>
              <div className='text-[11px] uppercase text-muted-foreground'>Media Refs</div>
              <div className='mt-1 text-sm font-semibold text-foreground'>
                {preview.mediaReferenceCount}
              </div>
            </div>
            <div className='rounded-2xl border border-border/70 bg-background/70 p-3'>
              <div className='text-[11px] uppercase text-muted-foreground'>Matched Media</div>
              <div className='mt-1 text-sm font-semibold text-foreground'>
                {preview.mediaFilesFound}
              </div>
            </div>
          </div>

          <div className='rounded-2xl border border-border/70 bg-background/70 p-4 text-sm text-foreground'>
            <div className='text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
              Participants
            </div>
            <div className='mt-2'>
              {preview.participants.length ? preview.participants.join(', ') : 'None detected'}
            </div>
          </div>

          {preview.unresolvedNames.length ? (
            <div className='rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900'>
              <div className='font-semibold'>Unresolved Names</div>
              <div className='mt-1'>{preview.unresolvedNames.join(', ')}</div>
            </div>
          ) : null}

          {preview.warnings.length ? (
            <div className='rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900'>
              <div className='font-semibold'>Warnings</div>
              <div className='mt-1'>{preview.warnings.join(' ')}</div>
            </div>
          ) : null}

          {preview.missingMediaRefs.length ? (
            <div className='rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900'>
              <div className='font-semibold'>Missing Media References</div>
              <div className='mt-2 break-words'>{preview.missingMediaRefs.join(', ')}</div>
            </div>
          ) : null}
        </section>
      ) : null}

      {activeTab === 'delete' && purgePreview ? (
        <section className='rounded-3xl border border-border/70 bg-card/70 p-5 shadow-sm space-y-4'>
          <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
            <div className='rounded-2xl border border-border/70 bg-background/70 p-3'>
              <div className='text-[11px] uppercase text-muted-foreground'>Imported Messages</div>
              <div className='mt-1 text-sm font-semibold text-foreground'>
                {purgePreview.stats.importedMessageCount}
              </div>
            </div>
            <div className='rounded-2xl border border-border/70 bg-background/70 p-3'>
              <div className='text-[11px] uppercase text-muted-foreground'>Attachments</div>
              <div className='mt-1 text-sm font-semibold text-foreground'>
                {purgePreview.stats.attachmentCount}
              </div>
            </div>
            <div className='rounded-2xl border border-border/70 bg-background/70 p-3'>
              <div className='text-[11px] uppercase text-muted-foreground'>Conversations</div>
              <div className='mt-1 text-sm font-semibold text-foreground'>
                {purgePreview.stats.conversationCount}
              </div>
            </div>
            <div className='rounded-2xl border border-border/70 bg-background/70 p-3'>
              <div className='text-[11px] uppercase text-muted-foreground'>Has Replies</div>
              <div className='mt-1 text-sm font-semibold text-foreground'>
                {purgePreview.stats.repliedConversationCount}
              </div>
            </div>
          </div>

          {purgePreview.dryRun ? (
            <div className='rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900'>
              <div className='font-semibold'>Delete Preview</div>
              <div className='mt-1'>
                {purgePreview.stats.repliedConversationCount > 0
                  ? 'Some imported root messages already have replies. Those roots will be soft-deleted, not hard-deleted.'
                  : 'No replied threads detected for this import source.'}
              </div>
            </div>
          ) : null}

          {purgePreview.result ? (
            <div className='rounded-2xl border border-rose-200 bg-rose-50/80 p-4 text-sm text-rose-900'>
              <div className='font-semibold'>Delete Result</div>
              <div className='mt-1'>
                Removed {purgePreview.result.deletedExternalMessages} mapping rows, hard-deleted{' '}
                {purgePreview.result.hardDeletedMessages} messages, soft-deleted{' '}
                {purgePreview.result.softDeletedMessages} replied roots, deleted{' '}
                {purgePreview.result.deletedAttachments} attachments, and removed{' '}
                {purgePreview.result.deletedConversations} empty conversations.
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {activeTab === 'import' && jobProgress ? (
        <section className='rounded-3xl border border-border/70 bg-card/70 p-5 shadow-sm space-y-4'>
          <div className='flex items-center justify-between gap-4'>
            <div>
              <h3 className='text-sm font-semibold text-foreground'>Import Progress</h3>
              <p className='mt-1 text-xs text-muted-foreground'>
                Phase: {jobProgress.phase} | Status: {jobProgress.status}
              </p>
            </div>
            <div className='rounded-full border border-border px-3 py-1 text-xs text-muted-foreground'>
              Job {jobProgress.jobId.slice(0, 8)}
            </div>
          </div>

          <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
            <div className='rounded-2xl border border-border/70 bg-background/70 p-3'>
              <div className='text-[11px] uppercase text-muted-foreground'>Imported Messages</div>
              <div className='mt-1 text-sm font-semibold text-foreground'>
                {jobProgress.importedMessages}/{jobProgress.totalMessages ?? '—'}
              </div>
            </div>
            <div className='rounded-2xl border border-border/70 bg-background/70 p-3'>
              <div className='text-[11px] uppercase text-muted-foreground'>Imported Media</div>
              <div className='mt-1 text-sm font-semibold text-foreground'>
                {jobProgress.importedMedia}/{jobProgress.totalMedia ?? '—'}
              </div>
            </div>
            <div className='rounded-2xl border border-border/70 bg-background/70 p-3'>
              <div className='text-[11px] uppercase text-muted-foreground'>Chat</div>
              <div className='mt-1 text-sm font-semibold text-foreground'>
                {jobProgress.chatName || 'Unknown'}
              </div>
            </div>
            <div className='rounded-2xl border border-border/70 bg-background/70 p-3'>
              <div className='text-[11px] uppercase text-muted-foreground'>Started</div>
              <div className='mt-1 text-sm font-semibold text-foreground'>
                {new Date(jobProgress.startedAt).toLocaleString()}
              </div>
            </div>
          </div>

          {jobProgress.errorMessage ? (
            <div className='rounded-2xl border border-rose-200 bg-rose-50/80 p-4 text-sm text-rose-900'>
              <div className='font-semibold'>Error</div>
              <div className='mt-1'>{jobProgress.errorMessage}</div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
};

export default WhatsAppMigrationPanel;
