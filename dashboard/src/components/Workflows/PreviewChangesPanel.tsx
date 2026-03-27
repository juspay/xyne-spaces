import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiInstance } from '../../services/clients/apiClient';
import { downloadArtifact } from './utils/downloadArtifact';
import {
  Loader2,
  AlertCircle,
  Image as ImageIcon,
  FileText,
  FileCode,
  Download,
  X,
  ExternalLink,
  FolderOpen,
  CheckCircle,
  XCircle,
} from 'lucide-react';

interface TestArtifact {
  name: string;
  gcsPath: string;
  type: 'screenshot' | 'report' | 'log';
  contentType?: string;
}

interface TestArtifactsInfo {
  executionId: string;
  screenshots: TestArtifact[];
  reports: TestArtifact[];
  logs: TestArtifact[];
  testSummary?: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
}

interface PreviewChangesPanelProps {
  executionId: string;
}

const PreviewChangesPanel: React.FC<PreviewChangesPanelProps> = ({ executionId }) => {
  const [selectedImage, setSelectedImage] = useState<TestArtifact | null>(null);
  const [viewingReport, setViewingReport] = useState<TestArtifact | null>(null);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  const { data, isLoading, error } = useQuery<TestArtifactsInfo>({
    queryKey: ['test-artifacts', executionId],
    queryFn: async () => {
      const response = await apiInstance.get<TestArtifactsInfo>(
        `/workflows/executions/${executionId}/test-artifacts`,
      );
      return response.data;
    },
    retry: false,
    refetchInterval: 5000, // Poll every 5 seconds for new artifacts
    refetchIntervalInBackground: false, // Only poll when tab is active
  });

  if (isLoading) {
    return (
      <div className='h-full flex items-center justify-center'>
        <div className='text-center'>
          <Loader2 className='w-8 h-8 text-blue-500 animate-spin mx-auto mb-4' />
          <p className='text-muted-foreground text-sm'>Loading test artifacts...</p>
        </div>
      </div>
    );
  }

  if (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to load test artifacts';
    const isNotFound = errorMessage.includes('not found') || errorMessage.includes('404');

    return (
      <div className='h-full flex items-center justify-center'>
        <div className='text-center max-w-md px-4'>
          <AlertCircle
            className={`w-12 h-12 mx-auto mb-4 ${isNotFound ? 'text-muted-foreground' : 'text-red-500'}`}
          />
          <h3 className='text-lg font-semibold text-foreground mb-2'>
            {isNotFound ? 'Artifacts Not Available' : 'Error Loading Artifacts'}
          </h3>
          <p className='text-muted-foreground text-sm'>
            {isNotFound
              ? 'Test artifacts are not yet available. They will appear here after the test execution phase completes.'
              : errorMessage}
          </p>
        </div>
      </div>
    );
  }

  if (
    !data ||
    ((!data.screenshots || data.screenshots.length === 0) &&
      (!data.reports || data.reports.length === 0) &&
      (!data.logs || data.logs.length === 0))
  ) {
    return (
      <div className='h-full flex items-center justify-center'>
        <div className='text-center max-w-md px-4'>
          <FolderOpen className='w-12 h-12 text-muted-foreground mx-auto mb-4' />
          <h3 className='text-lg font-semibold text-foreground mb-2'>No Artifacts Found</h3>
          <p className='text-muted-foreground text-sm'>
            No test artifacts generated yet for this workflow execution.
          </p>
        </div>
      </div>
    );
  }

  const getArtifactIcon = (type: string) => {
    switch (type) {
      case 'screenshot':
        return <ImageIcon className='w-5 h-5 text-blue-500' />;
      case 'report':
        return <FileCode className='w-5 h-5 text-green-500' />;
      case 'log':
        return <FileText className='w-5 h-5 text-orange-500' />;
      default:
        return <FileText className='w-5 h-5 text-gray-500' />;
    }
  };

  const getFileExtension = (filename: string): string => {
    const parts = filename.split('.');
    return parts.length > 1 ? (parts[parts.length - 1]?.toLowerCase() ?? '') : '';
  };

  const isViewableInBrowser = (filename: string): boolean => {
    const ext = getFileExtension(filename);
    return ['html', 'json', 'txt', 'log'].includes(ext);
  };

  return (
    <div className='h-full overflow-auto bg-background p-6'>
      {/* Header with Test Summary */}
      <div className='mb-6'>
        <h2 className='text-xl font-semibold mb-2'>Preview Changes</h2>
        <p className='text-sm text-muted-foreground mb-4'>
          View test screenshots, reports, and logs from the workflow execution.
        </p>

        {data.testSummary && (
          <div className='flex gap-4 mb-4'>
            <div className='flex items-center gap-2 px-3 py-1.5 bg-blue-500/10 rounded-full'>
              <span className='text-sm font-medium text-blue-600'>
                Test Steps: {data.testSummary.total}
              </span>
            </div>
            <div className='flex items-center gap-2 px-3 py-1.5 bg-green-500/10 rounded-full'>
              <CheckCircle className='w-4 h-4 text-green-500' />
              <span className='text-sm font-medium text-green-600'>
                Passed: {data.testSummary.passed}
              </span>
            </div>
            <div className='flex items-center gap-2 px-3 py-1.5 bg-red-500/10 rounded-full'>
              <XCircle className='w-4 h-4 text-red-500' />
              <span className='text-sm font-medium text-red-600'>
                Failed: {data.testSummary.failed}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Reports Section */}
      {data.reports && data.reports.length > 0 && (
        <div className='mb-8'>
          <h3 className='text-lg font-medium mb-3 flex items-center gap-2'>
            <FileCode className='w-5 h-5 text-green-500' />
            Test Reports ({data.reports.length})
          </h3>
          <div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
            {data.reports.map(report => (
              <div
                key={report.gcsPath}
                className='flex items-center justify-between p-3 border border-border rounded-lg hover:border-green-500 transition-colors bg-card group'
              >
                <div className='flex items-center gap-3 overflow-hidden'>
                  {getArtifactIcon(report.type)}
                  <div className='min-w-0'>
                    <p className='text-sm font-medium truncate' title={report.name}>
                      {report.name}
                    </p>
                    <p className='text-xs text-muted-foreground'>
                      {getFileExtension(report.name).toUpperCase()}
                    </p>
                  </div>
                </div>
                <div className='flex items-center gap-1'>
                  {isViewableInBrowser(report.name) && !report.name.endsWith('.html') && (
                    <button
                      onClick={() => setViewingReport(report)}
                      className='p-2 hover:bg-muted rounded-md transition-colors'
                      title='View'
                      data-track-category='workflow'
                      data-track-name='view-report'
                    >
                      <ExternalLink className='w-4 h-4 text-muted-foreground' />
                    </button>
                  )}
                  <button
                    onClick={() => void downloadArtifact(report.gcsPath, report.name)}
                    className='p-2 hover:bg-muted rounded-md transition-colors'
                    title='Download'
                    data-track-category='workflow'
                    data-track-name='download-report'
                  >
                    <Download className='w-4 h-4 text-muted-foreground' />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Screenshots Section */}
      {data.screenshots && data.screenshots.length > 0 && (
        <div className='mb-8'>
          <h3 className='text-lg font-medium mb-3 flex items-center gap-2'>
            <ImageIcon className='w-5 h-5 text-blue-500' />
            Screenshots ({data.screenshots.length})
          </h3>
          <div className='grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4'>
            {data.screenshots.map(screenshot => (
              <div
                key={screenshot.gcsPath}
                className='group relative border border-border rounded-lg overflow-hidden hover:border-blue-500 transition-colors cursor-pointer bg-card'
                onClick={() => setSelectedImage(screenshot)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelectedImage(screenshot);
                  }
                }}
                role='button'
                tabIndex={0}
                data-track-category='workflow'
                data-track-name='view-screenshot'
              >
                <div className='aspect-video bg-muted flex items-center justify-center'>
                  {failedImages.has(screenshot.gcsPath) ? (
                    <div className='flex flex-col items-center justify-center h-full text-muted-foreground'>
                      <ImageIcon className='w-8 h-8 mb-2' />
                      <span className='text-xs'>Failed to load</span>
                    </div>
                  ) : (
                    <img
                      src={`/api/workflows/artifacts/image?path=${encodeURIComponent(screenshot.gcsPath)}`}
                      alt={screenshot.name}
                      className='w-full h-full object-cover'
                      loading='lazy'
                      onError={() => setFailedImages(prev => new Set(prev).add(screenshot.gcsPath))}
                    />
                  )}
                </div>
                <div className='p-2'>
                  <p className='text-xs font-medium truncate' title={screenshot.name}>
                    {screenshot.name}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Logs Section */}
      {data.logs && data.logs.length > 0 && (
        <div className='mb-8'>
          <h3 className='text-lg font-medium mb-3 flex items-center gap-2'>
            <FileText className='w-5 h-5 text-orange-500' />
            Logs ({data.logs.length})
          </h3>
          <div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
            {data.logs.map(log => (
              <div
                key={log.gcsPath}
                className='flex items-center justify-between p-3 border border-border rounded-lg hover:border-orange-500 transition-colors bg-card group'
              >
                <div className='flex items-center gap-3 overflow-hidden'>
                  {getArtifactIcon(log.type)}
                  <div className='min-w-0'>
                    <p className='text-sm font-medium truncate' title={log.name}>
                      {log.name}
                    </p>
                    <p className='text-xs text-muted-foreground'>LOG</p>
                  </div>
                </div>
                <div className='flex items-center gap-1'>
                  <button
                    onClick={() => setViewingReport(log)}
                    className='p-2 hover:bg-muted rounded-md transition-colors'
                    title='View'
                    data-track-category='workflow'
                    data-track-name='view-log'
                  >
                    <ExternalLink className='w-4 h-4 text-muted-foreground' />
                  </button>
                  <a
                    href={`/api/workflows/artifacts/download?path=${encodeURIComponent(log.gcsPath)}`}
                    download={log.name}
                    className='p-2 hover:bg-muted rounded-md transition-colors'
                    title='Download'
                    data-track-category='workflow'
                    data-track-name='download-log'
                  >
                    <Download className='w-4 h-4 text-muted-foreground' />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Image Modal */}
      {selectedImage && (
        <div
          className='fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4'
          onClick={() => setSelectedImage(null)}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              setSelectedImage(null);
            }
          }}
          role='button'
          tabIndex={-1}
          data-track-category='workflow'
          data-track-name='close-image-modal'
        >
          <div
            className='bg-background rounded-lg max-w-6xl max-h-[90vh] overflow-hidden flex flex-col'
            onClick={e => e.stopPropagation()}
            onKeyDown={e => e.stopPropagation()}
            role='presentation'
            data-track-category='workflow'
            data-track-name='open-image-modal'
          >
            <div className='flex items-center justify-between p-4 border-b border-border'>
              <div>
                <h4 className='font-semibold'>{selectedImage.name}</h4>
                <p className='text-xs text-muted-foreground'>Click outside to close</p>
              </div>
              <div className='flex items-center gap-2'>
                <a
                  href={`/api/workflows/artifacts/download?path=${encodeURIComponent(selectedImage.gcsPath)}`}
                  download={selectedImage.name}
                  className='p-2 hover:bg-muted rounded-lg transition-colors'
                  title='Download'
                  data-track-category='workflow'
                  data-track-name='download-screenshot'
                >
                  <Download className='w-5 h-5' />
                </a>
                <button
                  onClick={() => setSelectedImage(null)}
                  className='p-2 hover:bg-muted rounded-lg transition-colors'
                  data-track-category='workflow'
                  data-track-name='close-image-modal-button'
                >
                  <X className='w-5 h-5' />
                </button>
              </div>
            </div>
            <div className='flex-1 overflow-auto p-4 bg-muted'>
              <img
                src={`/api/workflows/artifacts/image?path=${encodeURIComponent(selectedImage.gcsPath)}`}
                alt={selectedImage.name}
                className='max-w-full h-auto mx-auto'
              />
            </div>
          </div>
        </div>
      )}

      {/* Report/Log Viewer Modal */}
      {viewingReport && (
        <div
          className='fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4'
          onClick={() => setViewingReport(null)}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              setViewingReport(null);
            }
          }}
          role='button'
          tabIndex={-1}
          data-track-category='workflow'
          data-track-name='close-report-modal'
        >
          <div
            className='bg-background rounded-lg max-w-5xl max-h-[90vh] w-full overflow-hidden flex flex-col'
            onClick={e => e.stopPropagation()}
            onKeyDown={e => e.stopPropagation()}
            role='presentation'
            data-track-category='workflow'
            data-track-name='open-report-modal'
          >
            <div className='flex items-center justify-between p-4 border-b border-border'>
              <div>
                <h4 className='font-semibold'>{viewingReport.name}</h4>
              </div>
              <div className='flex items-center gap-2'>
                <a
                  href={`/api/workflows/artifacts/download?path=${encodeURIComponent(viewingReport.gcsPath)}`}
                  download={viewingReport.name}
                  className='p-2 hover:bg-muted rounded-lg transition-colors'
                  title='Download'
                  data-track-category='workflow'
                  data-track-name='download-report-modal'
                >
                  <Download className='w-5 h-5' />
                </a>
                <button
                  onClick={() => setViewingReport(null)}
                  className='p-2 hover:bg-muted rounded-lg transition-colors'
                  data-track-category='workflow'
                  data-track-name='close-report-modal-button'
                >
                  <X className='w-5 h-5' />
                </button>
              </div>
            </div>
            <div className='flex-1 overflow-auto p-4 bg-muted'>
              <iframe
                src={`/api/workflows/artifacts/view?path=${encodeURIComponent(viewingReport.gcsPath)}`}
                className='w-full h-full min-h-[60vh] bg-white rounded'
                title={viewingReport.name}
                onError={e => {
                  console.error(
                    `[PreviewChangesPanel] Failed to load report in iframe: ${viewingReport.gcsPath}`,
                    e,
                  );
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PreviewChangesPanel;
