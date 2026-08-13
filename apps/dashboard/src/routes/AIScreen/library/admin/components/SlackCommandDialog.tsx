import { useEffect, useState, type ReactElement } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TitledDialogV2 } from '../../shared/primitives/TitledDialogV2';
import type { SlackCommandChoice } from '../hooks/useSlackActions';

export function SlackCommandDialog({
  choice,
  registering,
  busy,
  onClose,
  onRegisterCommand,
  onCreateApp,
}: {
  choice: SlackCommandChoice | null;
  registering: boolean;
  busy: boolean;
  onClose: () => void;
  onRegisterCommand: (commandName: string) => void;
  onCreateApp: () => void;
}): ReactElement | null {
  const [commandName, setCommandName] = useState('');

  useEffect(() => {
    if (choice) setCommandName(choice.commandName);
  }, [choice]);

  if (!choice) return null;

  return (
    <TitledDialogV2
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}
      title={`Add ${choice.agent.name} to Slack`}
      description='How should people reach this agent?'
      testId='slack-connect-dialog'
      className='p-3'
    >
      <p className='text-sm leading-5 text-muted-foreground'>How should people reach this agent?</p>

      <section className='flex flex-col gap-3 rounded-xl border border-border p-4'>
        <div className='flex flex-col gap-1'>
          <span className='text-sm font-semibold leading-5 text-foreground'>
            Command on the Xyne app
          </span>
          <span className='text-xs leading-5 text-muted-foreground'>
            Recommended. Works in every channel immediately no install, no approval. Replies post
            in-channel; follow-ups continue in the thread.
          </span>
        </div>

        <div className='flex flex-col gap-1.5'>
          <label htmlFor='slack-command-name' className='text-xs font-medium text-foreground'>
            Command
          </label>
          <Input
            id='slack-command-name'
            value={commandName}
            onChange={event => setCommandName(event.target.value)}
            placeholder={`/${choice.agent.slug}`}
            spellCheck={false}
            autoComplete='off'
          />
        </div>

        <div className='flex justify-end'>
          <Button
            type='button'
            size='sm'
            disabled={registering || busy || !commandName.trim()}
            onClick={() => onRegisterCommand(commandName.trim())}
            data-track-category='Claw Admin'
            data-track-name='Register Slack command'
          >
            {registering ? 'Registering…' : 'Register command'}
          </Button>
        </div>
      </section>

      <section className='flex flex-col gap-3 rounded-xl border border-border p-4'>
        <div className='flex flex-col gap-1'>
          <span className='text-sm font-semibold leading-5 text-foreground'>Its own Slack app</span>
          <span className='text-xs leading-5 text-muted-foreground'>
            A real @{choice.agent.slug} bot: DM it, @mention it, its own name and avatar. Requires a
            workspace install, and possibly Slack-admin approval.
          </span>
        </div>

        <div className='flex justify-end'>
          <Button
            type='button'
            size='sm'
            variant='secondary'
            disabled={registering || busy}
            onClick={onCreateApp}
            data-track-category='Claw Admin'
            data-track-name='Create dedicated Slack app'
          >
            Create dedicated app
          </Button>
        </div>
      </section>
    </TitledDialogV2>
  );
}
