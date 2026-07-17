import { toast } from 'sonner';

export function showDownloadCompleteToast(fileName: string): void {
  const electronAPI =
    typeof window !== 'undefined'
      ? (window as unknown as Record<string, { openDownloadsFolder?: () => Promise<void> }>)[
          'electronAPI'
        ]
      : undefined;

  toast.success('Download complete', {
    description: `${fileName} has been downloaded successfully`,
    ...(electronAPI?.openDownloadsFolder
      ? {
          action: {
            label: 'Open Downloads',
            onClick: () => {
              electronAPI.openDownloadsFolder?.().catch(() => {
                toast.error('Failed to open downloads folder');
              });
            },
          },
        }
      : {}),
    duration: 5000,
  });
}
