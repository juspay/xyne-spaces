import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckSquare,
  ClipboardList,
  SearchCheck,
  Target,
  UserRound,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/Button';
import { AttachmentPreview } from '../../../components/ui/files/AttachmentPreview';
import { MediaViewer } from '../../../components/ui/files';
import { formatDate } from '../RCAScreen.utils.tsx';
import { formatRcaValue } from '../rcaCacConfig';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { fetchFile } from '../../../services/clients/fileFetchService';
import type {
  DetailedRcaRecord,
  SelectOption,
  ReleaseTicket,
  ReleaseAttributionRecord,
  SubTicketRecord,
  ImpactAttachment,
} from '../RCAScreen.types';
import type { UploadedFile } from '../../../components/ui/files/Files.types';

interface RCADetailsViewProps {
  selectedRecord: DetailedRcaRecord;
  ownerItems: SelectOption[];
  impactTypeOptions: SelectOption[];
  coeActionTypeOptions: SelectOption[];
  coeActionLabelByValue?: Map<string, string>;
  quickFixActionValue?: string;
  releaseTickets?: ReleaseTicket[];
  releaseAttributions?: ReleaseAttributionRecord[];
  attributedSubTickets?: SubTicketRecord[];
  onEdit?: () => void;
}

export const RCADetailsView = ({
  selectedRecord,
  ownerItems,
  impactTypeOptions,
  coeActionTypeOptions,
  coeActionLabelByValue,
  quickFixActionValue,
  releaseTickets = [],
  releaseAttributions = [],
  attributedSubTickets = [],
  onEdit,
}: RCADetailsViewProps) => {
  const selectedOwnerLabel =
    ownerItems.find(owner => owner.value === selectedRecord?.ownerId)?.label ??
    selectedRecord?.ownerId;

  const DetailRow = ({ label, value }: { label: string; value: string | null | undefined }) => (
    <div className='grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-6 py-3 border-b border-border last:border-b-0'>
      <p className='md:col-span-4 text-sm font-medium text-foreground'>{label}</p>
      <p className='md:col-span-8 text-sm text-muted-foreground whitespace-pre-wrap break-words'>
        {value?.trim() || '-'}
      </p>
    </div>
  );

  const getImpactTypeLabel = (impactTypeId: string) =>
    impactTypeOptions.find(option => option.value === impactTypeId)?.label ??
    formatRcaValue(impactTypeId);

  const getActionTypeLabel = (actionTypeId: string) =>
    coeActionLabelByValue?.get(actionTypeId) ??
    coeActionTypeOptions.find(option => option.value === actionTypeId)?.label ??
    formatRcaValue(actionTypeId);

  const quickFixCoes = useMemo(
    () =>
      (selectedRecord?.coes ?? []).filter(
        coe => quickFixActionValue && coe.actionTypeId === quickFixActionValue,
      ),
    [selectedRecord?.coes, quickFixActionValue],
  );
  const nonQuickFixCoes = useMemo(
    () =>
      (selectedRecord?.coes ?? []).filter(
        coe => !quickFixActionValue || coe.actionTypeId !== quickFixActionValue,
      ),
    [selectedRecord?.coes, quickFixActionValue],
  );
  const parseQuickFixItems = (value?: string | null): string[] =>
    (value ?? '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);

  const getOwnerLabel = (ownerId: string) =>
    ownerItems.find(option => option.value === ownerId)?.label ?? ownerId;

  const releaseTicketMap = useMemo(
    () => new Map(releaseTickets.map(ticket => [ticket.id, ticket])),
    [releaseTickets],
  );
  const subTicketMap = useMemo(
    () => new Map(attributedSubTickets.map(subTicket => [subTicket.id, subTicket])),
    [attributedSubTickets],
  );
  const rootCauseTicketIds = useMemo(
    () =>
      Array.from(
        new Set(
          releaseAttributions
            .map(attribution => attribution.rootCauseTicketId)
            .filter((id): id is string => !!id),
        ),
      ),
    [releaseAttributions],
  );
  const [rootCauseTicketsData] = useCachedQuery(
    queries.ticketsByIds({ ticketIds: rootCauseTicketIds }),
    { enabled: rootCauseTicketIds.length > 0 },
  );
  const rootCauseTicketMap = useMemo(
    () => new Map((rootCauseTicketsData ?? []).map(ticket => [ticket.id, ticket])),
    [rootCauseTicketsData],
  );
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const impactIds = useMemo(
    () => (selectedRecord?.impacts ?? []).map(impact => impact.id),
    [selectedRecord?.impacts],
  );
  const [impactAttachmentsData] = useCachedQuery(queries.attachmentsByImpactIds({ impactIds }), {
    enabled: impactIds.length > 0,
  });
  const impactAttachments = (impactAttachmentsData ?? []) as ImpactAttachment[];
  const attachmentsByImpactId = useMemo(() => {
    const map = new Map<string, UploadedFile[]>();
    impactAttachments.forEach(attachment => {
      const uploadedFile: UploadedFile = {
        id: attachment.id,
        originalName: attachment.originalFilename,
        fileName: attachment.originalFilename,
        fileSize: attachment.size,
        mimeType: attachment.mimetype,
        fileUrl: attachment.url,
        ...(attachment.thumbnailUrl ? { thumbnailUrl: attachment.thumbnailUrl } : {}),
        metadata: (attachment.metadata as Record<string, unknown>) ?? {},
      };
      const list = map.get(attachment.entityId) ?? [];
      list.push(uploadedFile);
      map.set(attachment.entityId, list);
    });
    return map;
  }, [impactAttachments]);

  const handlePreviewAttachment = async (file: UploadedFile): Promise<void> => {
    try {
      const fetchedFile = await fetchFile(file.id, file.originalName, file.mimeType);
      setPreviewFile(fetchedFile);
      setIsPreviewOpen(true);
    } catch {
      toast.error('Failed to load attachment preview');
    }
  };

  if (!selectedRecord) {
    return <></>;
  }
  return (
    <div className='space-y-6'>
      <section className='bg-background border border-border rounded-xl p-6'>
        <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
          <div>
            <p className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
              Root Cause Analysis
            </p>
            <h3 className='text-xl font-semibold text-foreground mt-1 leading-snug'>
              {selectedRecord.title || 'Untitled RCA'}
            </h3>
          </div>
          <div className='self-start'>
            {onEdit && (
              <Button
                type='button'
                size='sm'
                variant='outline'
                onClick={onEdit}
                data-track-category='RCA'
                data-track-name='EDIT_RCA'
              >
                Edit
              </Button>
            )}
          </div>
        </div>
        <div className='mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
          <span className='inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1'>
            <UserRound className='h-3.5 w-3.5' />
            Owner: {selectedOwnerLabel}
          </span>
          <span className='inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1'>
            Severity: {selectedRecord.severity}
          </span>
          <span className='inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1'>
            Created: {formatDate(selectedRecord.createdAt)}
          </span>
        </div>
      </section>

      <section className='bg-background border border-border rounded-xl p-6'>
        <div className='flex items-center gap-2 mb-4'>
          <AlertTriangle className='h-4 w-4 text-muted-foreground' />
          <h4 className='text-base font-semibold text-foreground'>Impact & Metrics</h4>
        </div>
        <DetailRow label='Summary' value={selectedRecord.summary} />
        <DetailRow label='Root Cause' value={selectedRecord.rootCause} />
        <DetailRow label='Bug Type' value={formatRcaValue(selectedRecord.bugTypeId)} />
        <DetailRow label='Category Type' value={formatRcaValue(selectedRecord.categoryTypeId)} />
        <DetailRow
          label='Issue Category'
          value={
            selectedRecord.issueCategoryId ? formatRcaValue(selectedRecord.issueCategoryId) : '-'
          }
        />
      </section>

      <section className='bg-background border border-border rounded-xl p-6'>
        <div className='flex items-center gap-2 mb-4'>
          <SearchCheck className='h-4 w-4 text-muted-foreground' />
          <h4 className='text-base font-semibold text-foreground'>Detection & Response</h4>
        </div>
        <DetailRow label='Issue Start Time' value={formatDate(selectedRecord.issueStartAt)} />
      </section>

      <section className='bg-background border border-border rounded-xl p-6'>
        <div className='flex items-center gap-2 mb-4'>
          <ClipboardList className='h-4 w-4 text-muted-foreground' />
          <h4 className='text-base font-semibold text-foreground'>Attribution</h4>
        </div>
        {releaseAttributions.length === 0 ? (
          <p className='text-sm text-muted-foreground'>No release mappings.</p>
        ) : (
          <div className='space-y-3'>
            {releaseAttributions.map(attribution => {
              const releaseTicket = releaseTicketMap.get(attribution.releaseId);
              const appRelease = attribution.releaseApplicationId
                ? subTicketMap.get(attribution.releaseApplicationId)
                : null;
              const rootCauseTicket = attribution.rootCauseTicketId
                ? rootCauseTicketMap.get(attribution.rootCauseTicketId)
                : null;
              const releaseLabel = releaseTicket
                ? releaseTicket.xyneId
                  ? `${releaseTicket.xyneId} · ${releaseTicket.title || 'Release ticket'}`
                  : releaseTicket.title || 'Release ticket'
                : 'Release ticket';
              const appLabel = appRelease?.title || 'Application release';
              const rootCauseLabel = rootCauseTicket
                ? rootCauseTicket.xyneId
                  ? `${rootCauseTicket.xyneId} · ${rootCauseTicket.title || 'Ticket'}`
                  : rootCauseTicket.title || 'Ticket'
                : 'Ticket';

              return (
                <div key={attribution.id} className='rounded-lg border border-border p-4'>
                  <p className='text-sm font-semibold text-foreground'>{releaseLabel}</p>
                  <div className='mt-2 space-y-1 text-sm text-muted-foreground'>
                    {appLabel && (
                      <div>
                        <span className='font-medium'>App Release:</span> {appLabel}
                      </div>
                    )}
                    {rootCauseTicket && (
                      <div>
                        <span className='font-medium'>Root Cause Ticket:</span> {rootCauseLabel}
                      </div>
                    )}
                    <div>
                      <span className='font-medium'>Confidence:</span> {attribution.confidence}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className='bg-background border border-border rounded-xl p-6'>
        <div className='flex items-center gap-2 mb-4'>
          <Target className='h-4 w-4 text-muted-foreground' />
          <h4 className='text-base font-semibold text-foreground'>Impact Details</h4>
        </div>
        {(selectedRecord.impacts?.length ?? 0) === 0 ? (
          <p className='text-sm text-muted-foreground'>No impact details available.</p>
        ) : (
          <div className='space-y-4'>
            {(selectedRecord.impacts ?? []).map((impact, index) => (
              <div key={impact.id} className='rounded-lg border border-border p-4'>
                <p className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                  Impact {index + 1}
                </p>
                <div className='mt-2 space-y-2'>
                  <DetailRow label='Impact Type' value={getImpactTypeLabel(impact.impactTypeId)} />
                  <DetailRow label='Impact Summary' value={impact.impact} />
                </div>
                {(attachmentsByImpactId.get(impact.id)?.length ?? 0) > 0 && (
                  <div className='mt-4 border-t border-border pt-4'>
                    <p className='text-sm font-medium text-foreground'>Attachments</p>
                    <div className='mt-2 flex flex-wrap gap-2'>
                      {(attachmentsByImpactId.get(impact.id) ?? []).map(file => (
                        <AttachmentPreview
                          key={file.id}
                          file={file}
                          onRemove={() => {}}
                          onPreview={() => void handlePreviewAttachment(file)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className='bg-background border border-border rounded-xl p-6'>
        <div className='flex items-center gap-2 mb-4'>
          <CheckSquare className='h-4 w-4 text-muted-foreground' />
          <h4 className='text-base font-semibold text-foreground'>COE Details</h4>
        </div>
        {(selectedRecord.coes?.length ?? 0) === 0 ? (
          <p className='text-sm text-muted-foreground'>No COE details available.</p>
        ) : (
          <div className='space-y-4'>
            {quickFixCoes.map((coe, index) => {
              const quickFixItems = parseQuickFixItems(coe.action);
              return (
                <div key={coe.id} className='rounded-lg border border-border p-4'>
                  <p className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                    Quick Fixes Done {quickFixCoes.length > 1 ? index + 1 : ''}
                  </p>
                  {quickFixItems.length > 0 ? (
                    <div className='mt-3 flex flex-wrap gap-2'>
                      {quickFixItems.map((item, itemIndex) => (
                        <span
                          key={`${coe.id}-${item}-${itemIndex}`}
                          className='inline-flex items-center rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground'
                        >
                          {formatRcaValue(item)}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className='mt-2 text-sm text-muted-foreground'>-</p>
                  )}
                </div>
              );
            })}

            {nonQuickFixCoes.map((coe, index) => (
              <div key={coe.id} className='rounded-lg border border-border p-4'>
                <p className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                  COE {index + 1}
                </p>
                <div className='mt-2 space-y-2'>
                  <DetailRow label='Owner' value={getOwnerLabel(coe.ownerId)} />
                  <DetailRow label='Action Type' value={getActionTypeLabel(coe.actionTypeId)} />
                  <DetailRow label='Action' value={coe.action} />
                  <DetailRow label='Status' value={coe.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {previewFile && (
        <MediaViewer
          file={previewFile}
          isOpen={isPreviewOpen}
          onClose={() => {
            setIsPreviewOpen(false);
            setPreviewFile(null);
          }}
        />
      )}
    </div>
  );
};
