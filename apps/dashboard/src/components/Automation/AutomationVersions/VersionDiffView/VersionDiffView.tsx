import { useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../ui/Select/Select';
import { Tooltip } from '../../../ui/Tooltip';
import { useUsersById } from '../../../../hooks/useUsers';
import { AutomationBuilder } from '../../AutomationBuilder/AutomationBuilder';
import type { Automation } from '../../Automation.types';

interface VersionDiffViewProps {
  versions: Automation[];
  initialFromId: string;
  initialToId: string;
  onClose: () => void;
}

const noop = (): void => undefined;

type UsersById = Map<string, { name?: string; email?: string }>;

function versionLabel(
  version: Automation,
  position: number,
  total: number,
  usersById: UsersById,
): string {
  const editor = usersById.get(version.createdById);
  const editorLabel = editor?.name ?? editor?.email ?? 'unknown';
  return `v${total - position} · ${version.status} · ${editorLabel} · ${new Date(version.createdAt).toLocaleString()}`;
}

function VersionPicker({
  value,
  onChange,
  versions,
  usersById,
}: {
  value: string;
  onChange: (id: string) => void;
  versions: Automation[];
  usersById: UsersById;
}): React.ReactElement {
  return (
    <div className='w-[360px]'>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className='h-8 text-xs'>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {versions.map((v, i) => (
            <SelectItem key={v.id} value={v.id}>
              {versionLabel(v, i, versions.length, usersById)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function VersionDiffView({
  versions,
  initialFromId,
  initialToId,
  onClose,
}: VersionDiffViewProps): React.ReactElement {
  const [fromId, setFromId] = useState(initialFromId);
  const [toId, setToId] = useState(initialToId);
  const usersById = useUsersById();

  const from = useMemo(() => versions.find(v => v.id === fromId), [versions, fromId]);
  const to = useMemo(() => versions.find(v => v.id === toId), [versions, toId]);

  return (
    <div className='flex h-full w-full flex-col bg-background'>
      <div className='flex flex-wrap items-center gap-2 border-b border-border px-6 py-3'>
        <Tooltip content='Back to version history' side='bottom'>
          <button
            type='button'
            onClick={onClose}
            aria-label='Back to version history'
            data-track-category='automation-versions'
            data-track-name='version-diff-back'
            className='flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/40'
          >
            <ArrowLeft className='size-4' />
          </button>
        </Tooltip>
        <span className='text-xs font-medium text-muted-foreground'>Compare</span>
        <VersionPicker
          value={fromId}
          onChange={setFromId}
          versions={versions}
          usersById={usersById}
        />
        <span className='text-xs font-medium text-muted-foreground'>with</span>
        <VersionPicker value={toId} onChange={setToId} versions={versions} usersById={usersById} />
      </div>

      <div className='flex min-h-0 flex-1 divide-x divide-border'>
        <div className='min-h-0 min-w-0 flex-1'>
          {from ? (
            <AutomationBuilder key={from.id} automation={from} onBack={noop} readOnlyPreview />
          ) : null}
        </div>
        <div className='min-h-0 min-w-0 flex-1'>
          {to ? (
            <AutomationBuilder key={to.id} automation={to} onBack={noop} readOnlyPreview />
          ) : null}
        </div>
      </div>
    </div>
  );
}
