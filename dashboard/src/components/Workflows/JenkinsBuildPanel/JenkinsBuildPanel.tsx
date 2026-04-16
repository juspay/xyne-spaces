import React, { useEffect, useState, useCallback } from 'react';
import {
  X,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  ExternalLink,
  Rocket,
} from 'lucide-react';
import { jenkinsService, JenkinsBuild, JenkinsStage } from '../../../services/Jenkins';
import { Button } from '../../ui/Button';

interface JenkinsBuildPanelProps {
  onClose: () => void;
  branch?: string | undefined;
  onTriggerBuild: () => Promise<void>;
  isTriggering: boolean;
}

const getStageStatusIcon = (status: JenkinsStage['status']): React.ReactNode => {
  switch (status) {
    case 'SUCCESS':
      return <CheckCircle2 size={14} className='text-emerald-500' />;
    case 'FAILED':
      return <XCircle size={14} className='text-red-500' />;
    case 'IN_PROGRESS':
      return <Loader2 size={14} className='text-blue-500 animate-spin' />;
    case 'ABORTED':
      return <XCircle size={14} className='text-muted-foreground' />;
    case 'PAUSED_PENDING_INPUT':
      return <Clock size={14} className='text-amber-500' />;
    default:
      return <Clock size={14} className='text-muted' />;
  }
};

const getStageStatusClass = (status: JenkinsStage['status']): string => {
  switch (status) {
    case 'SUCCESS':
      return 'bg-stage-completed border-stage-completed-border text-status-success';
    case 'FAILED':
      return 'bg-stage-cancelled border-stage-cancelled-border text-status-failure';
    case 'IN_PROGRESS':
      return 'bg-muted border-border text-status-scheduled';
    case 'ABORTED':
      return 'bg-muted border-border text-muted-foreground';
    case 'PAUSED_PENDING_INPUT':
      return 'bg-muted border-border text-status-pending';
    default:
      return 'bg-muted border-border text-muted-foreground';
  }
};

const getBuildStatusClass = (result: string | null, building: boolean): string => {
  if (building) return 'bg-muted border-border text-status-scheduled';
  switch (result) {
    case 'SUCCESS':
      return 'bg-stage-completed border-stage-completed-border text-status-success';
    case 'FAILURE':
      return 'bg-stage-cancelled border-stage-cancelled-border text-status-failure';
    case 'ABORTED':
      return 'bg-muted border-border text-muted-foreground';
    case 'UNSTABLE':
      return 'bg-muted border-border text-status-pending';
    default:
      return 'bg-muted border-border text-muted-foreground';
  }
};

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
};

export const JenkinsBuildPanel: React.FC<JenkinsBuildPanelProps> = ({
  onClose,
  branch,
  onTriggerBuild,
  isTriggering,
}) => {
  const [latestBuild, setLatestBuild] = useState<JenkinsBuild | null>(null);
  const [stages, setStages] = useState<JenkinsStage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLatestBuild = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const buildResponse = await jenkinsService.getLatestBuild(branch);

      if (buildResponse.success && buildResponse.build) {
        setLatestBuild(buildResponse.build);
        const stagesResponse = await jenkinsService.getBuildStages(
          buildResponse.build.number,
          branch,
        );
        if (stagesResponse.success) {
          setStages(stagesResponse.stages);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch build info');
    } finally {
      setIsLoading(false);
    }
  }, [branch]);

  useEffect(() => {
    void fetchLatestBuild();
  }, [fetchLatestBuild]);

  return (
    <div className='absolute right-0 top-full mt-2 w-96 bg-background border border-border rounded-lg shadow-xl z-[100]'>
      {/* Header */}
      <div className='flex items-center justify-between px-4 py-3 border-b border-border'>
        <h3 className='text-sm font-semibold text-foreground'>Jenkins Build</h3>
        <div className='flex items-center gap-2'>
          <Button
            onClick={() => void fetchLatestBuild()}
            disabled={isLoading}
            variant='ghost'
            size='iconSm'
            title='Refresh'
            data-track-category='Workflows'
            data-track-name='RefreshJenkinsBuild'
          >
            <RefreshCw
              size={14}
              className={`text-muted-foreground ${isLoading ? 'animate-spin' : ''}`}
            />
          </Button>
          <Button
            onClick={onClose}
            variant='ghost'
            size='iconSm'
            title='Close'
            data-track-category='Workflows'
            data-track-name='CloseJenkinsBuildPanel'
          >
            <X size={14} className='text-muted-foreground' />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className='max-h-96 overflow-y-auto'>
        {error && <div className='p-4 text-sm text-red-600 bg-red-50'>{error}</div>}

        {isLoading && !latestBuild && (
          <div className='p-8 flex items-center justify-center'>
            <Loader2 size={24} className='text-muted-foreground animate-spin' />
          </div>
        )}

        {latestBuild && (
          <div className='p-4'>
            <div className='flex items-center justify-between mb-3'>
              <div className='flex items-center gap-2'>
                <span className='text-sm font-medium text-foreground'>#{latestBuild.number}</span>
                <span
                  className={`px-2 py-0.5 text-xs rounded border ${getBuildStatusClass(latestBuild.result, latestBuild.building)}`}
                >
                  {latestBuild.building ? 'Running' : latestBuild.result || 'Unknown'}
                </span>
              </div>
              {latestBuild.url && (
                <a
                  href={latestBuild.url}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='text-blue-500 hover:text-blue-700'
                  title='Open in Jenkins'
                >
                  <ExternalLink size={14} />
                </a>
              )}
            </div>

            {/* Stages */}
            {stages.length > 0 && (
              <div className='space-y-2'>
                <h4 className='text-xs font-medium text-muted-foreground uppercase tracking-wide'>
                  Stages
                </h4>
                <div className='space-y-1'>
                  {stages.map(stage => (
                    <div
                      key={stage.id}
                      className={`flex items-center justify-between px-2 py-1.5 rounded border ${getStageStatusClass(stage.status)}`}
                    >
                      <div className='flex items-center gap-2'>
                        {getStageStatusIcon(stage.status)}
                        <span className='text-xs font-medium'>{stage.name}</span>
                      </div>
                      <span className='text-xs opacity-75'>
                        {formatDuration(stage.durationMillis)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {!isLoading && !latestBuild && !error && (
          <div className='p-8 text-center text-sm text-muted-foreground'>No builds found</div>
        )}
      </div>

      {/* Footer with Trigger Build Button */}
      <div className='px-4 py-3 border-t border-border'>
        <Button
          onClick={() => void onTriggerBuild()}
          disabled={isTriggering}
          loading={isTriggering}
          variant='outline'
          className='w-full border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 hover:border-orange-300'
          data-track-category='Workflows'
          data-track-name='TriggerJenkinsBuild'
          data-track-metadata={JSON.stringify({ branch })}
        >
          <Rocket size={16} />
          {isTriggering ? 'Triggering...' : 'Trigger New Build'}
        </Button>
      </div>
    </div>
  );
};

export default JenkinsBuildPanel;
