import { useState, type ReactElement } from 'react';
import { Check, Download, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog } from '../ui/Dialog/Dialog';
import { cn } from '../../utils/classNames';
import {
  SESSION_EXPORT_OPTIONS,
  downloadSessionExport,
  resumeStepsFor,
  type SessionExportFormat,
} from '../../services/claw/sessionExport';
import { agentIdentity } from '../Chat/XyneAISidebar/utils/XyneAIUtils';
import { useAgentDirectory } from './ConversationAgents';

export function ExportChatDialog({
  conversationId,
  title,
  agentSlugs,
  defaultAgentSlug,
  onClose,
}: {
  conversationId: string;
  title: string;
  agentSlugs: readonly string[];
  defaultAgentSlug?: string | undefined;
  onClose: () => void;
}): ReactElement {
  const directory = useAgentDirectory();
  const agents = agentSlugs.length > 0 ? agentSlugs : ['ask-ai'];
  const [agentSlug, setAgentSlug] = useState(
    defaultAgentSlug && agents.includes(defaultAgentSlug) ? defaultAgentSlug : agents[0]!,
  );
  const [busy, setBusy] = useState<SessionExportFormat | null>(null);
  const [done, setDone] = useState<{ format: SessionExportFormat; fileName: string } | null>(null);

  const download = async (format: SessionExportFormat): Promise<void> => {
    if (busy) return;
    setBusy(format);
    try {
      const fileName = await downloadSessionExport(conversationId, agentSlug, format);
      setDone({ format, fileName });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not export this chat');
    } finally {
      setBusy(null);
    }
  };

  const steps = done ? resumeStepsFor(done.format, done.fileName) : null;

  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}
      title='Export chat'
      description={`Download "${title || 'Untitled'}" for Claude Code or as Markdown`}
      className='max-w-[460px] p-0'
      testId='export-chat-dialog'
    >
      <div>
        <div className='flex items-start justify-between gap-3 px-5 pb-1 pt-4'>
          <div className='min-w-0'>
            <h2 className='text-base font-semibold leading-tight text-foreground'>Export chat</h2>
            <p className='mt-1 truncate text-sm text-muted-foreground'>{title || 'Untitled'}</p>
          </div>
          <button
            type='button'
            onClick={onClose}
            className='shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
            aria-label='Close'
            data-track-category='XyneAI'
            data-track-name='CLOSE_EXPORT_SESSION_DIALOG'
          >
            <X className='size-4' aria-hidden />
          </button>
        </div>

        {agents.length > 1 && (
          <div className='px-5 pt-3'>
            <div className='mb-1.5 text-xs font-medium text-muted-foreground'>Agent</div>
            <div className='flex flex-wrap gap-1.5' role='radiogroup' aria-label='Agent to export'>
              {agents.map(slug => (
                <button
                  key={slug}
                  type='button'
                  role='radio'
                  aria-checked={slug === agentSlug}
                  onClick={() => {
                    setAgentSlug(slug);
                    setDone(null);
                  }}
                  className={cn(
                    'rounded-full border px-3 py-1 text-sm transition-colors',
                    slug === agentSlug
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border text-foreground hover:bg-accent',
                  )}
                  data-track-category='XyneAI'
                  data-track-name='SELECT_EXPORT_AGENT'
                >
                  {agentIdentity(directory, slug).name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className='flex flex-col gap-1 px-3 py-3'>
          {SESSION_EXPORT_OPTIONS.map(option => (
            <button
              key={option.format}
              type='button'
              disabled={busy !== null}
              onClick={() => void download(option.format)}
              className='flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent disabled:cursor-wait disabled:opacity-60'
              data-track-category='XyneAI'
              data-track-name='EXPORT_SESSION'
              data-track-metadata={JSON.stringify({ format: option.format, conversationId })}
              data-testid={`export-${option.format}`}
            >
              <span className='flex min-w-0 flex-1 flex-col'>
                <span className='text-sm font-medium text-foreground'>
                  {option.label}{' '}
                  <code className='text-xs font-normal text-muted-foreground'>
                    {option.extension}
                  </code>
                </span>
                <span className='text-[13px] text-muted-foreground'>{option.description}</span>
              </span>
              {busy === option.format ? (
                <Loader2
                  className='size-4 shrink-0 animate-spin text-muted-foreground'
                  aria-hidden
                />
              ) : done?.format === option.format ? (
                <Check className='size-4 shrink-0 text-foreground' aria-label='Downloaded' />
              ) : (
                <Download className='size-4 shrink-0 text-muted-foreground' aria-hidden />
              )}
            </button>
          ))}
        </div>

        {done && (
          <div className='border-t border-border px-5 py-4' data-testid='export-done'>
            <p className='text-sm text-foreground'>
              Downloaded <code className='text-xs'>{done.fileName}</code>
            </p>
            {steps && (
              <>
                <p className='mt-3 text-xs font-medium text-muted-foreground'>
                  Resume it in Claude Code
                </p>
                <pre className='mt-1.5 overflow-x-auto rounded-md bg-muted p-3 font-mono text-[11px] leading-relaxed text-foreground'>
                  {steps}
                </pre>
              </>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
