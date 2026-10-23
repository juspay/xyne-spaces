import { useId, useState, type ChangeEvent, type ReactElement } from 'react';
import { WorkspaceRole } from '@xyne/shared';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import Button from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import Input from '../../components/ui/Input/Input';
import Textarea from '../../components/ui/Textarea/Textarea';
import { useClipboard } from '../../hooks/useClipboard';
import { useRefreshSlackMirror, useSlackConnection } from '../../hooks/useSlackMirror';
import { useSelf } from '../../hooks/useUsers';
import {
  removeSlackConnection,
  saveSlackConnection,
  slackMirrorErrorMessage,
  type SlackConnection,
} from '../../services/clients/slackMirrorApi';

const EMPTY_FORM = { appName: '', botToken: '', signingSecret: '', clientId: '', clientSecret: '' };

/** Organisations → Slack Mirror → Connection: the Slack app this workspace syncs with. */
export function SlackConnectionTab(): ReactElement {
  const self = useSelf();
  const canManage = self?.role === WorkspaceRole.OWNER || self?.role === WorkspaceRole.ADMIN;
  const { data: connection, isLoading } = useSlackConnection(canManage);
  const [editing, setEditing] = useState(false);

  return (
    <div className='space-y-4'>
      <div>
        <h2 className='text-lg font-semibold text-foreground'>Slack connection</h2>
        <p className='text-sm text-muted-foreground'>
          The Slack app that syncs channels with this workspace. Create the app in Slack first, then
          enter its details here.
        </p>
      </div>

      {!canManage ? (
        <div className='rounded-lg border border-dashed p-4 text-sm text-muted-foreground'>
          Only workspace admins and owners can manage the Slack connection.
        </div>
      ) : isLoading || !connection ? (
        <p className='text-sm text-muted-foreground'>Loading…</p>
      ) : (
        <>
          {connection.workspace && !editing ? (
            <ConnectedCard connection={connection} onReplace={() => setEditing(true)} />
          ) : (
            <ConnectionForm
              connection={connection}
              {...(connection.workspace && { onCancel: () => setEditing(false) })}
              onSaved={() => setEditing(false)}
            />
          )}
          <UrlsCard connection={connection} />
        </>
      )}
    </div>
  );
}

function ConnectedCard(props: {
  connection: SlackConnection;
  onReplace: () => void;
}): ReactElement {
  const { connection, onReplace } = props;
  const refresh = useRefreshSlackMirror();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const workspace = connection.workspace!;

  const remove = async (): Promise<void> => {
    try {
      await removeSlackConnection();
      toast.success('Slack disconnected');
      setConfirmRemove(false);
      await refresh.connection();
    } catch (error) {
      toast.error(slackMirrorErrorMessage(error, "Couldn't remove the connection."));
    }
  };

  return (
    <div className='rounded-lg border border-border bg-card p-4 space-y-3'>
      <div>
        <p className='text-sm font-medium text-foreground'>
          Connected to {workspace.name} ({workspace.externalWorkspaceId})
        </p>
        <p className='text-sm text-muted-foreground'>App: {connection.appName ?? 'unnamed'}</p>
        {connection.description && (
          <p className='text-sm text-muted-foreground'>{connection.description}</p>
        )}
      </div>
      <div className='flex gap-2'>
        <Button size='sm' variant='outline' trackId='slack_connection_replace' onClick={onReplace}>
          Replace credentials
        </Button>
        <Button
          size='sm'
          variant='outline'
          trackId='slack_connection_remove_open'
          onClick={() => setConfirmRemove(true)}
        >
          Remove connection
        </Button>
      </div>
      <Dialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title='Remove the Slack connection?'
        description='Every synced channel pauses, and everyone who connected their own Slack is signed out. Reconnecting the same Slack workspace lets channels resume without duplicates.'
      >
        <div className='flex justify-end gap-2'>
          <Button variant='outline' onClick={() => setConfirmRemove(false)}>
            Cancel
          </Button>
          <Button variant='destructive' trackId='slack_connection_remove' trackAction={remove}>
            Remove
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function ConnectionForm(props: {
  connection: SlackConnection;
  onCancel?: () => void;
  onSaved: () => void;
}): ReactElement {
  const { connection, onCancel, onSaved } = props;
  const refresh = useRefreshSlackMirror();
  const [form, setForm] = useState({ ...EMPTY_FORM, appName: connection.appName ?? '' });
  const [description, setDescription] = useState(connection.description ?? '');
  const ready = Object.values(form).every(value => !!value.trim());
  const set =
    (key: keyof typeof EMPTY_FORM): ((event: ChangeEvent<HTMLInputElement>) => void) =>
    event =>
      setForm(current => ({ ...current, [key]: event.target.value }));

  const save = async (): Promise<void> => {
    try {
      await saveSlackConnection({
        appName: form.appName.trim(),
        description: description.trim(),
        botToken: form.botToken.trim(),
        signingSecret: form.signingSecret.trim(),
        clientId: form.clientId.trim(),
        clientSecret: form.clientSecret.trim(),
      });
      toast.success('Slack connected');
      setForm({ ...EMPTY_FORM, appName: form.appName.trim() });
      await refresh.connection();
      onSaved();
    } catch (error) {
      toast.error(slackMirrorErrorMessage(error, "Couldn't save the connection."));
    }
  };

  return (
    <div className='rounded-lg border border-border bg-card p-4 space-y-3'>
      <Field label='Slack app name' hint='Shown in the instructions people see, e.g. Xyne Mirror.'>
        {id => <Input id={id} value={form.appName} onChange={set('appName')} maxLength={80} />}
      </Field>
      <Field label='Description' hint='Optional. What this app is for, for other admins.'>
        {id => (
          <Textarea
            id={id}
            value={description}
            onChange={event => setDescription(event.target.value)}
            maxLength={500}
          />
        )}
      </Field>
      <Field label='Bot token' hint='Starts with xoxb-. OAuth & Permissions in your Slack app.'>
        {id => (
          <Input
            id={id}
            type='password'
            value={form.botToken}
            onChange={set('botToken')}
            autoComplete='off'
          />
        )}
      </Field>
      <Field label='Signing secret' hint='Basic Information in your Slack app.'>
        {id => (
          <Input
            id={id}
            type='password'
            value={form.signingSecret}
            onChange={set('signingSecret')}
            autoComplete='off'
          />
        )}
      </Field>
      <Field
        label='Client ID'
        hint='Basic Information in your Slack app. Lets people connect their own Slack and post as themselves.'
      >
        {id => (
          <Input id={id} value={form.clientId} onChange={set('clientId')} autoComplete='off' />
        )}
      </Field>
      <Field label='Client secret' hint='Basic Information in your Slack app.'>
        {id => (
          <Input
            id={id}
            type='password'
            value={form.clientSecret}
            onChange={set('clientSecret')}
            autoComplete='off'
          />
        )}
      </Field>
      <div className='flex justify-end gap-2'>
        {onCancel && (
          <Button variant='outline' onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button disabled={!ready} trackId='slack_connection_save' trackAction={save}>
          Save and check with Slack
        </Button>
      </div>
    </div>
  );
}

function UrlsCard({ connection }: { connection: SlackConnection }): ReactElement {
  return (
    <div className='rounded-lg border border-border bg-card p-4 space-y-3'>
      <p className='text-sm font-medium text-foreground'>Paste these into your Slack app</p>
      <CopyRow label='Event Subscriptions → Request URL' value={connection.urls.events} />
      <CopyRow
        label='OAuth & Permissions → Redirect URL (for posting as yourself)'
        value={connection.urls.userSignInRedirect}
      />
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }): ReactElement {
  const { copy } = useClipboard();
  return (
    <div className='flex flex-col gap-1'>
      <span className='text-xs text-muted-foreground'>{label}</span>
      <div className='flex items-center gap-2'>
        <code className='min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1 text-xs'>
          {value}
        </code>
        <Button
          size='iconSm'
          variant='ghost'
          aria-label={`Copy ${label}`}
          onClick={() => void copy(value).then(ok => ok && toast.success('Copied'))}
        >
          <Copy />
        </Button>
      </div>
    </div>
  );
}

function Field(props: {
  label: string;
  hint?: string;
  children: (id: string) => ReactElement;
}): ReactElement {
  const id = useId();
  return (
    <div className='flex flex-col gap-1'>
      <label htmlFor={id} className='text-sm font-medium text-foreground'>
        {props.label}
      </label>
      {props.children(id)}
      {props.hint && <span className='text-xs text-muted-foreground'>{props.hint}</span>}
    </div>
  );
}
