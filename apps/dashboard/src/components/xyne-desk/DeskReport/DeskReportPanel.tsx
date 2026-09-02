import React, { useCallback, useEffect, useState } from 'react';
import { X, Download, RefreshCw, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog } from '../../ui/Dialog/Dialog';
import { cn } from '../../../utils/classNames';
import { apiInstance, BASE_URL } from '../../../services/clients/apiClient';
import { showDownloadCompleteToast } from '../../../utils/downloadToast';
import { Button } from '../../ui/Button/Button';

export interface DeskReportPanelProps {
  open: boolean;
  onClose: () => void;
  channelId: string;
  channelName?: string;
}

interface LatestDeskReport {
  status: 'pending' | 'completed' | 'failed';
  url: string | null;
  generatedAt: string;
  rangeDays: number;
  agentSlug: string | null;
  error: string | null;
  // True while a regeneration is in flight — purely a banner, never hides
  // the previous completed report.
  generating: boolean;
}

interface LatestDeskReportResponse {
  success: boolean;
  data: LatestDeskReport | null;
  // Computed server-side (canManageDeskReport) — not re-derived here.
  canGenerate: boolean;
}

/**
 * Sidebar panel for the scheduled desk report
 */
export const DeskReportPanel: React.FC<DeskReportPanelProps> = ({
  open,
  onClose,
  channelId,
  channelName,
}) => {
  const [report, setReport] = useState<LatestDeskReport | null>(null);
  const [canGenerate, setCanGenerate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Full-panel spinner only on first load — later refreshes update in place.
  const fetchLatest = useCallback(
    async (opts?: { silent?: boolean }): Promise<void> => {
      if (!opts?.silent) setLoading(true);
      setLoadError(null);
      try {
        const res = await apiInstance.get<LatestDeskReportResponse>(
          `/desk-report/${encodeURIComponent(channelId)}/latest`,
        );
        setReport(res.data.data);
        setCanGenerate(res.data.canGenerate);
      } catch {
        if (!opts?.silent) setLoadError('Failed to load the desk report.');
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [channelId],
  );

  useEffect(() => {
    if (!open) return;
    void fetchLatest();
  }, [open, fetchLatest]);

  // Poll quietly while generating so the banner clears on its own.
  useEffect(() => {
    if (!open || !report?.generating) return;
    const interval = setInterval((): void => {
      void fetchLatest({ silent: true });
    }, 5000);
    return (): void => clearInterval(interval);
  }, [open, report?.generating, fetchLatest]);

  const handleGenerateNow = useCallback(async () => {
    setSubmitting(true);
    try {
      const res = await apiInstance.post<{ success: boolean; error?: string }>(
        `/desk-report/${encodeURIComponent(channelId)}/generate`,
      );
      if (res.data.success) {
        toast.success('Generating desk report…', {
          description:
            'This can take a few minutes — the current report stays visible until it’s ready.',
        });
      } else {
        // e.g. already generating — a no-op to know about, not an error to retry.
        toast.info(res.data.error ?? 'Could not start desk report generation');
      }
      // Silent: keep the previous report visible, no loading state.
      await fetchLatest({ silent: true });
    } catch {
      toast.error('Failed to start desk report generation');
    } finally {
      setSubmitting(false);
    }
  }, [channelId, fetchLatest]);

  const handleDownload = useCallback(async () => {
    if (!report?.url) return;
    setDownloading(true);
    try {
      const res = await apiInstance.get(`${report.url}?download=1`, { responseType: 'blob' });
      const filename = `${channelName ?? 'desk'}-report.html`;
      const blobUrl = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
      showDownloadCompleteToast(filename);
    } catch {
      toast.error('Failed to download desk report');
    } finally {
      setDownloading(false);
    }
  }, [report?.url, channelName]);

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next) onClose();
      }}
      title='Desk Report'
      className={cn(
        'left-auto right-0 top-0 bottom-0 h-screen w-[85vw] max-h-none max-w-none translate-x-0 translate-y-0 rounded-l-[16px] rounded-r-none bg-transparent shadow-none',
        'data-[state=open]:!zoom-in-100 data-[state=open]:!slide-in-from-top-[0%] data-[state=open]:!slide-in-from-right-full',
        'data-[state=closed]:!zoom-out-100 data-[state=closed]:!slide-out-to-top-[0%] data-[state=closed]:!slide-out-to-right-full',
      )}
    >
      <div className='relative h-full w-full'>
        <button
          type='button'
          onClick={onClose}
          className='absolute right-6 top-4 z-20 flex h-8 w-8 items-center justify-center rounded-[10px] border border-desk-border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground dark:border-border'
          aria-label='Close desk report'
          data-track-category='DeskReport'
          data-track-name='CloseButton'
        >
          <X size={16} />
        </button>
        <div className='isolate flex h-full w-full flex-col overflow-hidden rounded-l-[16px] border border-desk-border bg-popover shadow-2xl dark:border-border'>
          <div className='flex shrink-0 items-center justify-between gap-3 border-b border-desk-border px-6 py-4 dark:border-border'>
            <div className='min-w-0'>
              <div className='flex items-center gap-2'>
                <FileText size={16} className='text-desk-muted' />
                <h2 className='truncate text-[15px] font-semibold text-foreground'>
                  Desk Report{channelName ? ` — ${channelName}` : ''}
                </h2>
              </div>
              {report && report.status === 'completed' && (
                <p className='mt-0.5 flex items-center gap-1.5 text-xs text-desk-muted'>
                  <span>
                    Generated {new Date(report.generatedAt).toLocaleString()} · last{' '}
                    {report.rangeDays === 1 ? '1 day' : `${report.rangeDays} days`}
                  </span>
                  {report.generating && (
                    <span className='flex items-center gap-1 text-desk-accent'>
                      <RefreshCw size={11} className='animate-spin' />
                      Generating new report…
                    </span>
                  )}
                </p>
              )}
            </div>
            <div className='flex shrink-0 items-center gap-2 pr-12'>
              {report?.status === 'completed' && report.url && (
                <button
                  type='button'
                  onClick={() => void handleDownload()}
                  disabled={downloading}
                  className='flex items-center gap-1.5 rounded-[8px] border border-border px-3 py-1.5 text-sm text-foreground hover:bg-accent disabled:opacity-60'
                  data-track-category='DeskReport'
                  data-track-name='DownloadReport'
                >
                  <Download size={14} />
                  {downloading ? 'Downloading…' : 'Download'}
                </button>
              )}
              {canGenerate && (
                <Button
                  variant='ghost'
                  type='button'
                  onClick={() => void handleGenerateNow()}
                  disabled={submitting || report?.generating}
                  className='flex items-center gap-1.5 rounded-[8px] bg-desk-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60'
                  data-track-category='DeskReport'
                  data-track-name='GenerateNow'
                  trackId='desk_report_generate'
                >
                  <RefreshCw
                    size={14}
                    className={submitting || report?.generating ? 'animate-spin' : ''}
                  />
                  {submitting || report?.generating ? 'Generating…' : 'Generate now'}
                </Button>
              )}
            </div>
          </div>

          <div className='min-h-0 flex-1'>
            {loading ? (
              <div className='flex h-full items-center justify-center text-sm text-desk-muted'>
                Loading report…
              </div>
            ) : loadError ? (
              <div className='flex h-full flex-col items-center justify-center gap-2 text-center'>
                <p className='text-sm text-desk-muted'>{loadError}</p>
              </div>
            ) : !report ? (
              <div className='flex h-full flex-col items-center justify-center gap-3 text-center px-6'>
                <FileText size={28} className='text-desk-muted/70' />
                <p className='text-sm font-medium text-foreground'>
                  No report generated yet for this desk
                </p>
                <p className='max-w-sm text-xs text-desk-muted'>
                  {canGenerate
                    ? 'Enable Desk Report in Desk Settings → Agent to schedule this automatically, or generate one now.'
                    : 'Ask a desk owner or admin to enable Desk Report in Desk Settings, or generate one.'}
                </p>
              </div>
            ) : report.status === 'pending' ? (
              // No completed report yet — the only case that's a full spinner.
              <div className='flex h-full flex-col items-center justify-center gap-2 text-center'>
                <RefreshCw size={22} className='animate-spin text-desk-muted' />
                <p className='text-sm text-desk-muted'>Generating the desk report…</p>
              </div>
            ) : report.status === 'failed' ? (
              <div className='flex h-full flex-col items-center justify-center gap-2 text-center px-6'>
                <p className='text-sm font-medium text-foreground'>Report generation failed</p>
                {report.error && <p className='max-w-sm text-xs text-desk-muted'>{report.error}</p>}
              </div>
            ) : (
              // Keep the completed report visible even mid-regeneration or
              // after a failed retry — the banner/error strip carries that.
              <div className='flex h-full flex-col'>
                {report.error && (
                  <p className='shrink-0 border-b border-desk-border bg-destructive/5 px-6 py-2 text-xs text-destructive dark:border-border'>
                    Last regeneration attempt failed: {report.error}
                  </p>
                )}
                <iframe
                  title='Desk report'
                  src={report.url ? `${BASE_URL}${report.url}` : undefined}
                  sandbox='allow-scripts'
                  className='h-full w-full flex-1 border-0'
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
};
