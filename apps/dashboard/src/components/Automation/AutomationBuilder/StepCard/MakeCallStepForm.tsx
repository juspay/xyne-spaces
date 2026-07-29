import { useMemo } from 'react';
import { CallType } from '@xyne/shared';
import { ConfigChannelField } from '../SchemaForm/ConfigChannelField';
import { MultiEntityVariableField } from '../SchemaForm/EntityVariableField';
import { EntityKind } from '../SchemaForm/SchemaForm.utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../ui/Select/Select';
import type { VariablePickerSource } from '../VariablePicker/VariablePicker.types';
import type { ValidationIssue } from '../../Automation.types';

interface MakeCallConfigShape {
  channelId?: string;
  invitedUserIds?: string[];
  userGroupIds?: string[];
  callType?: CallType;
}

interface MakeCallStepFormProps {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  issues: ValidationIssue[] | null;
  pathPrefix: string;
  variableSources: VariablePickerSource[];
}

export function MakeCallStepForm({
  value,
  onChange,
  issues,
  pathPrefix,
  variableSources,
}: MakeCallStepFormProps): React.ReactElement {
  const cfg = value as MakeCallConfigShape;

  const issuesAt = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of issues ?? []) {
      if (i.path.startsWith(`${pathPrefix}.`))
        map.set(i.path.slice(pathPrefix.length + 1), i.message);
    }
    return map;
  }, [issues, pathPrefix]);

  const setField = <K extends keyof MakeCallConfigShape>(
    key: K,
    next: MakeCallConfigShape[K],
  ): void => {
    onChange({ ...cfg, [key]: next });
  };

  return (
    <div className='flex flex-col gap-5'>
      <FieldRow
        label='Channel (optional)'
        description='Pick a channel for the call. Leave empty to create a DM call.'
        error={issuesAt.get('channelId')}
      >
        <ConfigChannelField
          value={cfg.channelId}
          onChange={next => setField('channelId', next)}
          variableSources={variableSources}
          mode='both'
        />
      </FieldRow>

      <FieldRow
        label='Invited users (optional)'
        description='Individual users to invite to the call.'
        error={issuesAt.get('invitedUserIds')}
      >
        <MultiEntityVariableField
          entityKind={EntityKind.USER}
          value={Array.isArray(cfg.invitedUserIds) ? cfg.invitedUserIds : []}
          onChange={next => setField('invitedUserIds', next)}
          variableSources={variableSources}
          placeholder='Pick users to invite'
        />
      </FieldRow>

      <FieldRow
        label='User groups (optional)'
        description='All members of selected groups will be invited.'
        error={issuesAt.get('userGroupIds')}
      >
        <MultiEntityVariableField
          entityKind={EntityKind.USER_GROUP}
          value={Array.isArray(cfg.userGroupIds) ? cfg.userGroupIds : []}
          onChange={next => setField('userGroupIds', next)}
          variableSources={variableSources}
          placeholder='Pick user groups to invite'
        />
      </FieldRow>

      <FieldRow label='Call type'>
        <Select
          value={cfg.callType ?? CallType.AUDIO}
          onValueChange={v => setField('callType', v as CallType)}
        >
          <SelectTrigger className='w-full'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={CallType.AUDIO}>Audio</SelectItem>
            <SelectItem value={CallType.VIDEO}>Video</SelectItem>
          </SelectContent>
        </Select>
      </FieldRow>
    </div>
  );
}

function FieldRow({
  label,
  description,
  required,
  error,
  children,
}: {
  label: string;
  description?: string;
  required?: boolean;
  error?: string | undefined;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className='flex flex-col gap-1.5'>
      <div className='flex items-baseline gap-2'>
        <label className='text-sm font-medium text-foreground'>
          {label}
          {required && <span className='text-red-600'> *</span>}
        </label>
        {description && <span className='text-[11px] text-muted-foreground'>{description}</span>}
      </div>
      {children}
      {error && <span className='text-[11px] text-red-600'>{error}</span>}
    </div>
  );
}
