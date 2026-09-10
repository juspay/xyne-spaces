import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { PencilEditLine } from '@xyne/icons';
import { cn } from '@/utils/classNames';
import { Button } from '@/components/ui/Button/index';
import { useAuth } from '@/hooks/useAuth';
import { useClawAvailableTools } from '@/hooks/useClawAvailableTools';
import { useClawSubagents, useCreateClawSubagent } from '@/hooks/useClawSubagents';
import { clawErrorText } from '@/services/claw/clawRequest';
import { fromToolboxSelection } from '@/services/claw/subagentToolsBridge';
import type { SubagentDef } from '@/services/claw/clawSubagentsTypes';
import { AutoWidthInput } from '../../shared/primitives/AutoWidthInput';
import { SkillsCapabilityRow } from '../../shared/pickers/skill/SkillsCapabilityRow';
import { ProgressLabelsField } from './ProgressLabelsField';
import { SubagentToolSectionRow } from './toolbox/SubagentToolSectionRow';
import { buildSubagentToolSections } from './toolbox/subagentToolCatalog';
import { SubagentSectionLabel } from './SectionHeading';
import { wizardStateFromSubagent } from './subagentDraft';
import { useSaveClawSubagent } from './useSaveClawSubagent';
import {
  DEFAULT_PARAM_NAME,
  INITIAL_SUBAGENT_STATE,
  normalizeSubagentName,
  subagentNameError,
  type SubagentWizardState,
} from './subagentWizardState';

interface ClawSubagentCreateV2Props {
  /** Present in edit mode — seeds the form and switches Create to Save. */
  subagent?: SubagentDef;
}

const ClawSubagentCreateV2 = ({ subagent }: ClawSubagentCreateV2Props = {}): ReactElement => {
  const isEdit = subagent !== undefined;
  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const libraryPath = workspaceId ? `/${workspaceId}/ai/library` : '/ai/library';

  const { user } = useAuth();
  const builtBy =
    subagent?.createdByName ?? subagent?.createdByEmail ?? user?.name ?? user?.email ?? 'you';

  const { data: subagents = [] } = useClawSubagents();
  const { data: catalog, isLoading: toolsLoading } = useClawAvailableTools();
  const create = useCreateClawSubagent();
  const saveMutation = useSaveClawSubagent(subagent);

  const [state, setState] = useState<SubagentWizardState>(() =>
    subagent ? wizardStateFromSubagent(subagent, catalog ?? null) : INITIAL_SUBAGENT_STATE,
  );
  const update = useCallback(
    (patch: Partial<SubagentWizardState>) => setState(prev => ({ ...prev, ...patch })),
    [],
  );

  const toolSections = useMemo(() => buildSubagentToolSections(catalog ?? null), [catalog]);

  const takenNames = useMemo(
    () => new Set(subagents.map(s => s.name).filter(name => name !== subagent?.name)),
    [subagents, subagent?.name],
  );
  const trimmedName = state.name.trim();
  const nameError = subagentNameError(state.name, takenNames);

  const canSubmit = trimmedName.length > 0 && !nameError && state.systemPrompt.trim().length > 0;

  const handleCreate = async (): Promise<void> => {
    if (!canSubmit || create.isPending) return;
    try {
      const created = await create.mutateAsync({
        name: trimmedName,
        description: state.description.trim(),
        systemPrompt: state.systemPrompt.trim(),
        paramName: state.paramName.trim() || DEFAULT_PARAM_NAME,
        paramDescription: state.paramDescription.trim(),
        progressLabels: state.progressLabels.map(label => label.trim()).filter(Boolean),
        tools: fromToolboxSelection(state.tools, catalog ?? null),
        ...(state.skillIds.length ? { skillIds: state.skillIds } : {}),
      });
      toast.success(`${created.name} created`);
      void navigate(`${libraryPath}/subagent/${encodeURIComponent(created.name)}?tab=persona`);
    } catch (error) {
      toast.error(clawErrorText(error, 'Failed to create subagent'));
    }
  };

  return (
    <div className='h-full overflow-y-auto no-scrollbar' data-component='ClawSubagentCreateV2'>
      <div className='mx-auto flex w-full max-w-[800px] flex-col gap-6 px-6 py-6'>
        <h1 className='text-2xl font-semibold leading-[1.2] tracking-[-0.24px] text-foreground'>
          {isEdit ? 'Edit subagent' : 'Create subagent'}
        </h1>

        <div className='flex w-full flex-col gap-4'>
          <div className='flex w-full items-start gap-4 py-4'>
            <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
              <div className='flex w-full items-center gap-2'>
                <AutoWidthInput
                  value={state.name}
                  onChange={next => update({ name: normalizeSubagentName(next) })}
                  placeholder='Name your subagent'
                  aria-label='Subagent name'
                  aria-invalid={Boolean(nameError)}
                  autoFocus
                  data-track-category='Claw Agents'
                  data-track-name='Create subagent v2: name'
                  className='text-base font-medium leading-6 tracking-[-0.1px] text-foreground placeholder:font-medium placeholder:text-muted-foreground'
                />
                <PencilEditLine className='size-3 shrink-0 text-muted-foreground' aria-hidden />
              </div>

              <p
                className={cn(
                  'text-xs leading-4',
                  nameError ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {nameError ?? 'Permanent kebab-case identifier.'}
              </p>

              <p className='flex items-center gap-1.5 text-sm leading-[1.5] text-foreground'>
                Built by
                <span className='text-[color:var(--mention-color)]'>@{builtBy}</span>
              </p>
            </div>
          </div>

          <div className='flex w-full flex-col gap-8'>
            <div className='flex w-full flex-col gap-3'>
              <SubagentSectionLabel htmlFor='subagent-v2-description'>
                Description
              </SubagentSectionLabel>
              <textarea
                id='subagent-v2-description'
                value={state.description}
                onChange={e => update({ description: e.target.value })}
                placeholder='What this specialist does and when agents should call it.'
                data-track-category='Claw Agents'
                data-track-name='Create subagent v2: description'
                className='h-[86px] w-full resize-y rounded-2xl border border-border bg-card p-4 text-sm leading-5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
              />
            </div>

            <div className='flex w-full flex-col gap-3'>
              <SubagentSectionLabel>Parameter</SubagentSectionLabel>
              <p className='text-sm font-normal leading-5 text-muted-foreground'>
                The single argument the parent agent passes in when it delegates.
              </p>
              <div className='grid w-full grid-cols-1 gap-3 sm:grid-cols-3'>
                <input
                  value={state.paramName}
                  onChange={e => update({ paramName: e.target.value })}
                  placeholder={DEFAULT_PARAM_NAME}
                  aria-label='Parameter name'
                  data-track-category='Claw Agents'
                  data-track-name='Create subagent v2: parameter name'
                  className='h-11 w-full rounded-2xl border border-border bg-card px-4 text-sm leading-5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
                />
                <input
                  value={state.paramDescription}
                  onChange={e => update({ paramDescription: e.target.value })}
                  placeholder='What the parent agent passes in'
                  aria-label='Parameter description'
                  data-track-category='Claw Agents'
                  data-track-name='Create subagent v2: parameter description'
                  className='h-11 w-full rounded-2xl border border-border bg-card px-4 text-sm leading-5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring sm:col-span-2'
                />
              </div>
            </div>

            <div className='flex w-full flex-col gap-3'>
              <SubagentSectionLabel htmlFor='subagent-v2-prompt'>What it does</SubagentSectionLabel>

              <textarea
                id='subagent-v2-prompt'
                value={state.systemPrompt}
                onChange={e => update({ systemPrompt: e.target.value })}
                placeholder='You are a focused specialist that…'
                data-track-category='Claw Agents'
                data-track-name='Create subagent v2: prompt'
                className='h-[250px] w-full resize-y rounded-2xl border border-border bg-card p-4 text-sm leading-5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
              />
              <span className='self-end text-xs leading-4 text-muted-foreground'>
                {state.systemPrompt.length} characters
              </span>
            </div>

            {toolSections.map(section => (
              <SubagentToolSectionRow
                key={section.kind}
                section={section}
                selection={state.tools}
                onSelectionChange={tools => update({ tools })}
                loading={toolsLoading}
              />
            ))}
            <SkillsCapabilityRow
              selectedIds={state.skillIds}
              onChange={skillIds => update({ skillIds })}
            />

            <ProgressLabelsField
              labels={state.progressLabels}
              onChange={progressLabels => update({ progressLabels })}
            />
          </div>
        </div>

        <div className='flex w-full items-center justify-end gap-3'>
          <Button
            variant='ghost'
            onClick={() =>
              void navigate(
                isEdit
                  ? `${libraryPath}/subagent/${encodeURIComponent(subagent.name)}?tab=persona`
                  : libraryPath,
              )
            }
            className='h-auto rounded-xl px-3 py-2.5 text-[15px]'
            data-track-category='Claw Agents'
            data-track-name='Create subagent v2: cancel'
          >
            Cancel
          </Button>
          <Button
            onClick={() =>
              isEdit ? void saveMutation.save(state, catalog ?? null) : void handleCreate()
            }
            loading={isEdit ? saveMutation.saving : create.isPending}
            disabled={!canSubmit}
            className='h-auto rounded-xl bg-foreground px-3 py-2.5 text-[15px] text-background hover:bg-foreground/90'
            data-track-category='Claw Agents'
            data-track-name={`Create subagent v2: ${isEdit ? 'save' : 'create'}`}
          >
            {isEdit ? 'Save' : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ClawSubagentCreateV2;
