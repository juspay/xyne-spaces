import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { publishReleaseReport } from '../../services/releaseReportService';

interface UsePublishReleaseReportResult {
  isPublishing: boolean;
  canvasUrl: string | null;
  hasPublished: boolean;
  publish: () => Promise<void>;
}

export function usePublishReleaseReport(
  ticketId: string | undefined,
  existingCanvasUrl: string | null,
): UsePublishReleaseReportResult {
  const [isPublishing, setIsPublishing] = useState(false);
  const [canvasUrl, setCanvasUrl] = useState<string | null>(existingCanvasUrl);

  useEffect(() => {
    if (existingCanvasUrl) setCanvasUrl(existingCanvasUrl);
  }, [existingCanvasUrl]);

  const publish = async (): Promise<void> => {
    if (!ticketId || isPublishing) return;
    setIsPublishing(true);
    try {
      const result = await publishReleaseReport(ticketId);
      setCanvasUrl(result.canvasUrl);
      const openReportAction: { label: string; onClick: () => void } = {
        label: 'Open report',
        onClick: (): void => {
          window.open(result.canvasUrl, '_blank', 'noopener,noreferrer');
        },
      };

      if (result.partialFailure) {
        toast.warning('Report published with a warning', {
          description:
            result.warning ||
            'The Canvas was updated, but the release thread message could not be posted.',
          action: openReportAction,
          duration: 5000,
        });
      } else {
        toast.success(
          result.action === 'created' ? 'Release report published' : 'Release report updated',
          {
            description: 'The Canvas and release thread message are up to date.',
            action: openReportAction,
            duration: 3000,
          },
        );
      }
    } catch (error) {
      toast.error('Failed to publish release report', {
        description: error instanceof Error ? error.message : 'Please try again.',
        duration: 4000,
      });
    } finally {
      setIsPublishing(false);
    }
  };

  return {
    isPublishing,
    canvasUrl,
    hasPublished: Boolean(canvasUrl),
    publish,
  };
}
