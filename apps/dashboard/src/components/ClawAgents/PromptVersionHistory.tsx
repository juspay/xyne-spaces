import { ReactElement, useState } from 'react';
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { useClawPromptVersions } from '@/hooks/useClawPromptVersions';

export const PromptVersionHistory = ({
  agentSlug,
  canActivate,
  onActivated,
}: {
  agentSlug: string;
  canActivate: boolean;
  onActivated: (systemPrompt: string) => void;
}): ReactElement => {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const { data, isLoading, activate } = useClawPromptVersions(agentSlug);

  const restore = async (version: number): Promise<void> => {
    try {
      const updated = await activate.mutateAsync(version);
      onActivated(updated.systemPrompt ?? '');
      toast.success(`Prompt version ${version} activated`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to activate prompt version');
    }
  };

  return (
    <div className='rounded-lg border border-border'>
      <button
        type='button'
        onClick={() => setOpen(value => !value)}
        data-track-category='Claw Agents'
        data-track-name='Toggle prompt version history'
        className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-foreground'
      >
        {open ? <ChevronDown className='size-4' /> : <ChevronRight className='size-4' />}
        Version history
        {data?.activeVersion !== null && data?.activeVersion !== undefined && (
          <Badge variant='outline' className='ml-auto'>
            v{data.activeVersion} active
          </Badge>
        )}
      </button>
      {open && (
        <div className='border-t border-border p-3'>
          {isLoading ? (
            <Skeleton className='h-16 w-full' />
          ) : !data?.versions.length ? (
            <p className='text-sm text-muted-foreground'>No prompt versions yet.</p>
          ) : (
            <div className='flex flex-col gap-2'>
              {data.versions.map(version => {
                const isActive = version.version === data.activeVersion;
                return (
                  <div key={version.id} className='rounded-md border border-border p-3'>
                    <div className='flex items-center gap-2'>
                      <button
                        type='button'
                        onClick={() =>
                          setExpanded(expanded === version.version ? null : version.version)
                        }
                        data-track-category='Claw Agents'
                        data-track-name='Expand prompt version'
                        className='text-sm font-medium text-foreground'
                      >
                        v{version.version}
                      </button>
                      {isActive && <Badge variant='success'>Active</Badge>}
                      <span className='text-xs text-muted-foreground'>
                        {new Date(version.createdAt).toLocaleString()}
                      </span>
                      {canActivate && !isActive && (
                        <Button
                          type='button'
                          variant='outline'
                          size='sm'
                          loading={activate.isPending && activate.variables === version.version}
                          disabled={activate.isPending}
                          onClick={() => void restore(version.version)}
                          data-track-category='Claw Agents'
                          data-track-name='RESTORE_PROMPT_VERSION'
                          className='ml-auto'
                        >
                          <RotateCcw className='size-3.5' /> Activate
                        </Button>
                      )}
                    </div>
                    {expanded === version.version && (
                      <pre className='mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs text-foreground'>
                        {version.systemPrompt}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
