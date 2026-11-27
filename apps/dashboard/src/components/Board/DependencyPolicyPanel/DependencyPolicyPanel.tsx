import type { BoardDependencyPolicy } from '@xyne/shared';

export interface DependencyPolicyPanelProps {
  policy: BoardDependencyPolicy;
  stages: readonly { id: string; name: string }[];
  onChange: (policy: BoardDependencyPolicy) => void;
}

export function DependencyPolicyPanel({ policy, stages, onChange }: DependencyPolicyPanelProps) {
  return (
    <fieldset className='space-y-3 border-t border-border px-6 py-4'>
      <legend className='text-sm font-medium'>Dependency policy</legend>
      <p className='text-xs text-muted-foreground'>
        Only a board administrator can save policy changes. FLOW boards do not enforce dependencies.
      </p>
      <label className='flex items-center justify-between gap-4 text-sm'>
        Default strength
        <select
          className='rounded border border-border bg-background p-2'
          value={policy.defaultStrength}
          data-track-category='TICKET_DEPENDENCIES'
          data-track-name='PolicyDefaultStrength'
          onChange={event =>
            onChange({
              ...policy,
              defaultStrength: event.target.value === 'HARD' ? 'HARD' : 'SOFT',
            })
          }
        >
          <option value='SOFT'>Soft — a reason permits a move</option>
          <option value='HARD'>Hard — administrator consent required</option>
        </select>
      </label>
      <label className='flex items-center justify-between gap-4 text-sm'>
        Automation at soft gates
        <select
          className='rounded border border-border bg-background p-2'
          value={policy.automationOnSoftGate}
          data-track-category='TICKET_DEPENDENCIES'
          data-track-name='PolicyAutomation'
          onChange={event =>
            onChange({
              ...policy,
              automationOnSoftGate: event.target.value === 'STOP' ? 'STOP' : 'PROCEED',
            })
          }
        >
          <option value='PROCEED'>Proceed and record the automatic override</option>
          <option value='STOP'>Stop</option>
        </select>
      </label>
      <div className='space-y-2'>
        <p className='text-sm'>Stages that always require hard gates</p>
        {stages.map(stage => (
          <label key={stage.id} className='flex items-center gap-2 text-sm'>
            <input
              type='checkbox'
              checked={policy.hardGateStageIds.includes(stage.id)}
              data-track-category='TICKET_DEPENDENCIES'
              data-track-name='PolicyHardStage'
              onChange={event =>
                onChange({
                  ...policy,
                  hardGateStageIds: event.target.checked
                    ? [...policy.hardGateStageIds, stage.id]
                    : policy.hardGateStageIds.filter(id => id !== stage.id),
                })
              }
            />
            {stage.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
