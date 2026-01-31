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
      return <XCircle size={14} className='text-gray-400' />;
    case 'PAUSED_PENDING_INPUT':
      return <Clock size={14} className='text-amber-500' />;
    default:
      return <Clock size={14} className='text-gray-300' />;
  }
};

const getStageStatusClass = (status: JenkinsStage['status']): string => {
  switch (status) {
    case 'SUCCESS':
      return 'bg-emerald-50 border-emerald-200 text-emerald-700';
    case 'FAILED':
      return 'bg-red-50 border-red-200 text-red-700';
    case 'IN_PROGRESS':
      return 'bg-blue-50 border-blue-200 text-blue-700';
    case 'ABORTED':
      return 'bg-gray-50 border-gray-200 text-gray-500';
    case 'PAUSED_PENDING_INPUT':
      return 'bg-amber-50 border-amber-200 text-amber-700';
    default:
      return 'bg-gray-50 border-gray-200 text-gray-500';
  }
};

const getBuildStatusClass = (result: string | null, building: boolean): string => {
  if (building) return 'bg-blue-50 border-blue-200 text-blue-700';
  switch (result) {
    case 'SUCCESS':
      return 'bg-emerald-50 border-emerald-200 text-emerald-700';
    case 'FAILURE':
      return 'bg-red-50 border-red-200 text-red-700';
    case 'ABORTED':
      return 'bg-gray-50 border-gray-200 text-gray-500';
    case 'UNSTABLE':
      return 'bg-amber-50 border-amber-200 text-amber-700';
    default:
      return 'bg-gray-50 border-gray-200 text-gray-500';
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
    <div className='absolute right-0 top-full mt-2 w-96 bg-white border border-gray-200 rounded-lg shadow-xl z-[100]'>
      {/* Header */}
      <div className='flex items-center justify-between px-4 py-3 border-b border-gray-100'>
        <h3 className='text-sm font-semibold text-gray-900'>Jenkins Build</h3>
        <div className='flex items-center gap-2'>
          <Button
            onClick={() => void fetchLatestBuild()}
            disabled={isLoading}
            variant='ghost'
            size='iconSm'
            title='Refresh'
          >
            <RefreshCw size={14} className={`text-gray-500 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
          <Button onClick={onClose} variant='ghost' size='iconSm' title='Close'>
            <X size={14} className='text-gray-500' />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className='max-h-96 overflow-y-auto'>
        {error && <div className='p-4 text-sm text-red-600 bg-red-50'>{error}</div>}

        {isLoading && !latestBuild && (
          <div className='p-8 flex items-center justify-center'>
            <Loader2 size={24} className='text-gray-400 animate-spin' />
          </div>
        )}

        {latestBuild && (
          <div className='p-4'>
            <div className='flex items-center justify-between mb-3'>
              <div className='flex items-center gap-2'>
                <span className='text-sm font-medium text-gray-900'>#{latestBuild.number}</span>
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
                <h4 className='text-xs font-medium text-gray-500 uppercase tracking-wide'>
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
          <div className='p-8 text-center text-sm text-gray-500'>No builds found</div>
        )}
      </div>

      {/* Footer with Trigger Build Button */}
      <div className='px-4 py-3 border-t border-gray-100'>
        <Button
          onClick={() => void onTriggerBuild()}
          disabled={isTriggering}
          loading={isTriggering}
          variant='outline'
          className='w-full border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 hover:border-orange-300'
        >
          <Rocket size={16} />
          {isTriggering ? 'Triggering...' : 'Trigger New Build'}
        </Button>
      </div>
    </div>
  );
};

export default JenkinsBuildPanel;
