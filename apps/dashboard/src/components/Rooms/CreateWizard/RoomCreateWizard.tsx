import { ReactElement, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Lock, X } from 'lucide-react';
import { Button } from '../../ui/Button';
import Input from '../../ui/Input/Input';
import { Textarea } from '../../ui/Textarea';
import { SearchUser } from '../../ui/SearchUser/SearchUser';
import { useSelf } from '../../../hooks/useUsers';
import {
  useSearchChannelCandidates,
  useVisibleProjectsWithoutDms,
} from '../../../hooks/useChannels';
import Avatar from '../../ui/Avatar/Avatar';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { cn } from '../../../utils/classNames';
import { SearchChannel } from '../../ui/SearchChannel/SearchChannel';
import { CurationAgentPicker } from '../CurationAgentPicker';
import { RoomChecklistTemplateEditor } from '../RoomChecklistTemplateEditor';
import { CADENCE_OPTIONS } from '../Rooms.utils';
import { WIZARD_STEPS, type WizardStep } from './CreateWizard.types';
import { useRoomCreateForm } from './useRoomCreateForm';

const STEP_LABELS: Record<WizardStep, { title: string; detail: string }> = {
  basics: { title: 'Basics', detail: 'Name and purpose' },
  checklist: { title: 'Checklist', detail: 'Define done' },
  sources: { title: 'Sources', detail: 'Pick evidence' },
  members: { title: 'Members', detail: 'Who can view' },
  review: { title: 'Review', detail: 'Create room' },
};

export function RoomCreateWizard(): ReactElement {
  const navigate = useNavigate();
  const self = useSelf();
  const projects = useVisibleProjectsWithoutDms();
  const form = useRoomCreateForm();

  const channelCandidates = useSearchChannelCandidates();

  const { projectId, setProjectId } = form;
  useEffect(() => {
    if (projectId === null && projects.length === 1 && projects[0]) {
      setProjectId(projects[0].id);
    }
  }, [projectId, projects, setProjectId]);

  const handleCancel = (): void => {
    void navigate('/rooms');
  };

  const handleSubmit = async (): Promise<void> => {
    const roomId = await form.submit();
    if (roomId) {
      void navigate(`/rooms/${roomId}`);
    }
  };

  return (
    <div className='h-full bg-muted flex flex-col' data-testid='room-create-wizard'>
      <div className='flex-1 overflow-auto p-8'>
        <div className='max-w-5xl mx-auto'>
          <div className='flex items-start justify-between gap-4 mb-6'>
            <div>
              <h1 className='text-2xl font-bold text-foreground [text-wrap:balance]'>
                Create private room
              </h1>
              <p className='mt-1 text-sm text-muted-foreground [text-wrap:pretty]'>
                Choose the sources and members. The room stays private from the moment it is
                created.
              </p>
            </div>
            <Button variant='ghost' onClick={handleCancel} aria-label='Close create room'>
              <X size={18} />
            </Button>
          </div>

          <div className='flex gap-6 items-start'>
            <div
              role='tablist'
              aria-label='Create room steps'
              className='flex w-52 shrink-0 flex-col gap-0.5 rounded-2xl border border-border bg-background p-2'
            >
              {WIZARD_STEPS.map((step, index) => {
                const isActive = step === form.step;
                const isDone = index < form.stepIndex;
                return (
                  <button
                    key={step}
                    role='tab'
                    aria-selected={isActive}
                    onClick={() => form.goToStep(step)}
                    data-track-category='Rooms'
                    data-track-name='WizardGoToStep'
                    data-track-metadata={JSON.stringify({ step })}
                    className={cn(
                      'flex items-center gap-3 rounded-xl px-3 py-2.5 text-left',
                      'transition-[background-color,color,scale] duration-150 ease-out active:scale-[0.99]',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isActive
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-muted',
                    )}
                    data-testid={`wizard-step-${step}`}
                  >
                    <span
                      className={cn(
                        'size-5 rounded-full border text-[10px] font-bold inline-flex items-center justify-center shrink-0',
                        isDone
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'border-border',
                      )}
                    >
                      {isDone ? <Check size={11} /> : index + 1}
                    </span>
                    <span className='min-w-0'>
                      <span className='block text-sm font-medium'>{STEP_LABELS[step].title}</span>
                      <span className='block text-xs text-muted-foreground'>
                        {STEP_LABELS[step].detail}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <section className='min-w-0 flex-1 rounded-2xl border border-border bg-background p-6'>
              {form.step === 'basics' && (
                <div className='flex flex-col gap-5'>
                  <div>
                    <h2 className='text-lg font-semibold text-foreground'>Define the room</h2>
                    <p className='text-sm text-muted-foreground mt-1'>
                      The description doubles as the AI curation query — describe exactly what this
                      room should track.
                    </p>
                  </div>
                  <div className='flex flex-col gap-1.5'>
                    <label
                      htmlFor='wizard-room-project'
                      className='text-sm font-medium text-foreground'
                    >
                      Project
                    </label>
                    {projects.length === 0 ? (
                      <p className='rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground [text-wrap:pretty]'>
                        You are not in any project yet. Join a project channel before creating a
                        room.
                      </p>
                    ) : (
                      <select
                        id='wizard-room-project'
                        value={form.projectId ?? ''}
                        onChange={e => form.setProjectId(e.target.value)}
                        data-track-category='Rooms'
                        data-track-name='WizardSelectProject'
                        data-testid='wizard-room-project'
                        className='h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                      >
                        <option value='' disabled>
                          Select a project…
                        </option>
                        {projects.map(project => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <p className='text-xs text-muted-foreground [text-wrap:pretty]'>
                      The room lives in this project. Members still need approval to see inside.
                    </p>
                  </div>
                  <div className='flex flex-col gap-1.5'>
                    <label
                      htmlFor='wizard-room-name'
                      className='text-sm font-medium text-foreground'
                    >
                      Room name
                    </label>
                    <Input
                      id='wizard-room-name'
                      value={form.name}
                      onChange={e => form.setName(e.target.value)}
                      placeholder='e.g. payments-migration'
                      data-testid='wizard-room-name'
                    />
                  </div>
                  <div className='flex flex-col gap-1.5'>
                    <label
                      htmlFor='wizard-room-description'
                      className='text-sm font-medium text-foreground'
                    >
                      What should this room track?
                    </label>
                    <Textarea
                      id='wizard-room-description'
                      value={form.description}
                      onChange={e => form.setDescription(e.target.value)}
                      placeholder='Track refund latency, ledger cutover, migration support tickets, and rollout calls.'
                      rows={3}
                      data-testid='wizard-room-description'
                    />
                  </div>
                  <div className='flex flex-col gap-1.5'>
                    <span className='text-sm font-medium text-foreground'>Curation cadence</span>
                    <div className='grid grid-cols-3 gap-2'>
                      {CADENCE_OPTIONS.map(option => (
                        <button
                          key={option.value}
                          type='button'
                          onClick={() => form.setCadence(option.value)}
                          aria-pressed={form.cadence === option.value}
                          data-track-category='Rooms'
                          data-track-name='WizardSetCadence'
                          data-track-metadata={JSON.stringify({ cadence: option.value })}
                          className={cn(
                            'flex h-full flex-col justify-start rounded-xl border px-3 py-2.5 text-left',
                            'transition-[background-color,border-color,box-shadow,scale] duration-150 ease-out active:scale-[0.99]',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            form.cadence === option.value
                              ? 'border-primary/50 bg-accent text-accent-foreground'
                              : 'border-border hover:bg-muted',
                          )}
                          data-testid={`wizard-cadence-${option.value}`}
                        >
                          <span
                            className={cn(
                              'text-sm font-medium',
                              form.cadence === option.value
                                ? 'text-foreground'
                                : 'text-muted-foreground',
                            )}
                          >
                            {option.label}
                          </span>
                          <span className='mt-0.5 text-xs leading-snug text-muted-foreground [text-wrap:pretty]'>
                            {option.detail}
                          </span>
                        </button>
                      ))}
                    </div>
                    <p className='text-xs text-muted-foreground [text-wrap:pretty]'>
                      You can re-run curation on demand at any time, whatever the cadence.
                    </p>
                  </div>
                  <div className='flex flex-col gap-1.5'>
                    <span className='text-sm font-medium text-foreground'>Curation agent</span>
                    <CurationAgentPicker value={form.agentSlug} onChange={form.setAgentSlug} />
                  </div>
                  <div className='flex items-start gap-3 rounded-xl bg-muted p-3'>
                    <Lock size={15} className='text-muted-foreground mt-0.5 shrink-0' />
                    <p className='text-xs text-muted-foreground [text-wrap:pretty]'>
                      <span className='font-semibold text-foreground'>Always private.</span> Room
                      access and source access are checked separately — new viewers need approval
                      from the room owner.
                    </p>
                  </div>
                </div>
              )}

              <div className={cn('flex-col gap-5', form.step === 'checklist' ? 'flex' : 'hidden')}>
                <div>
                  <h2 className='text-lg font-semibold text-foreground'>Define your checklist</h2>
                  <p className='text-sm text-muted-foreground mt-1'>
                    Optional. Write the points you want tracked and the condition for each — the
                    agent ticks them off from the room&apos;s activity.
                  </p>
                </div>
                <RoomChecklistTemplateEditor
                  value={form.checklistTemplate}
                  onChange={form.setChecklistTemplate}
                  onIncompleteChange={form.setChecklistIncomplete}
                />
                {form.checklistIncomplete && (
                  <p className='text-xs text-destructive [text-wrap:pretty]'>
                    Finish or remove the incomplete checklist point to continue.
                  </p>
                )}
              </div>

              {form.step === 'sources' && (
                <div className='flex flex-col gap-5'>
                  <div>
                    <h2 className='text-lg font-semibold text-foreground'>Choose sources</h2>
                    <p className='text-sm text-muted-foreground mt-1'>
                      Channels that feed this room&apos;s summaries.
                    </p>
                  </div>
                  <SearchChannel
                    channels={channelCandidates}
                    mode='channel'
                    selectedChannels={form.channels}
                    onChannelsChange={form.setChannels}
                    placeholder='Search channels to add...'
                  />
                  {form.channels.length === 0 && (
                    <p className='text-sm text-muted-foreground rounded-lg border border-dashed border-border p-6 text-center'>
                      No sources yet. You can also add them after the room is created.
                    </p>
                  )}
                </div>
              )}

              {form.step === 'members' && (
                <div className='flex flex-col gap-5'>
                  <div>
                    <h2 className='text-lg font-semibold text-foreground'>Add members</h2>
                    <p className='text-sm text-muted-foreground mt-1'>
                      Members you add here are approved immediately. Everyone else must request
                      access.
                    </p>
                  </div>
                  <SearchUser
                    excludeUserIds={self ? [self.id] : []}
                    selectedUsers={form.members}
                    onUsersChange={form.setMembers}
                    placeholder='Search users to add...'
                  />
                  {form.members.length > 0 && (
                    <div className='flex flex-col'>
                      {form.members.map(member => (
                        <div
                          key={member.id}
                          className='flex items-center gap-3 py-2 border-t border-border first:border-t-0'
                        >
                          <Avatar userId={member.id} size='md' />
                          <span className='text-sm text-foreground'>
                            {getUserDisplayName(member)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {form.step === 'review' && (
                <div className='flex flex-col gap-5'>
                  <div>
                    <h2 className='text-lg font-semibold text-foreground'>Review and create</h2>
                    <p className='text-sm text-muted-foreground mt-1'>
                      This is the room you will land in. Sources and members can be changed later.
                    </p>
                  </div>
                  <div className='rounded-lg border border-border p-4 flex flex-col gap-2'>
                    <div className='flex items-center gap-2'>
                      <Lock size={13} className='text-muted-foreground' />
                      <span className='text-sm font-semibold text-foreground'>{form.name}</span>
                    </div>
                    <p className='text-sm text-muted-foreground'>{form.description}</p>
                    <p className='text-xs text-muted-foreground'>
                      {form.channels.length} source{form.channels.length === 1 ? '' : 's'} ·{' '}
                      {form.members.length + 1} member{form.members.length === 0 ? '' : 's'} ·{' '}
                      {CADENCE_OPTIONS.find(option => option.value === form.cadence)?.label}{' '}
                      curation
                      {form.checklistTemplate.trim() && <> · Checklist added</>}
                    </p>
                  </div>
                </div>
              )}
            </section>
          </div>

          <div className='flex items-center justify-between mt-6'>
            <span className='inline-flex items-center gap-1.5 text-xs text-muted-foreground'>
              <Lock size={12} />
              Rooms are always private
            </span>
            <div className='flex items-center gap-2'>
              {form.checklistIncomplete && form.step !== 'checklist' && (
                <span className='text-xs text-destructive [text-wrap:pretty]'>
                  Finish or remove the incomplete checklist point to continue.
                </span>
              )}
              <Button variant='ghost' onClick={handleCancel}>
                Cancel
              </Button>
              {form.stepIndex > 0 && (
                <Button variant='secondary' onClick={form.goBack}>
                  Back
                </Button>
              )}
              {form.isLastStep ? (
                <Button
                  onClick={() => void handleSubmit()}
                  disabled={!form.canProceed || form.isSubmitting}
                  data-track-category='Rooms'
                  data-track-name='WizardCreateRoom'
                  data-testid='wizard-create-room'
                >
                  <Check size={16} />
                  {form.isSubmitting ? 'Creating…' : 'Create room'}
                </Button>
              ) : (
                <Button onClick={form.goNext} disabled={!form.canProceed} data-testid='wizard-next'>
                  Next
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
