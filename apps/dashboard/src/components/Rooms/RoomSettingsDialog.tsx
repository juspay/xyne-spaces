import { ReactElement, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Archive, Lock, X } from 'lucide-react';
import { RoomCurationCadence, type Room } from '@xyne/shared';
import { useZero } from '../../hooks/useZero';
import { mutators } from '../../zero/mutators';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import Input from '../ui/Input/Input';
import { Textarea } from '../ui/Textarea';
import { cn } from '../../utils/classNames';
import { CurationAgentPicker } from './CurationAgentPicker';
import { RoomChecklistTemplateEditor } from './RoomChecklistTemplateEditor';
import { CADENCE_OPTIONS } from './Rooms.utils';

interface RoomSettingsDialogProps {
  room: Room;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onArchived: () => void;
}

export function RoomSettingsDialog({
  room,
  open,
  onOpenChange,
  onArchived,
}: RoomSettingsDialogProps): ReactElement {
  const zero = useZero();
  const [name, setName] = useState(room.name);
  const [description, setDescription] = useState(room.description);
  const [cadence, setCadence] = useState<RoomCurationCadence>(room.curationCadence);
  const [agentSlug, setAgentSlug] = useState<string | null>(room.clawAgentId ?? null);
  const [checklistTemplate, setChecklistTemplate] = useState(room.checklistTemplate ?? '');
  const [checklistIncomplete, setChecklistIncomplete] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setName(room.name);
      setDescription(room.description);
      setCadence(room.curationCadence);
      setAgentSlug(room.clawAgentId ?? null);
      setChecklistTemplate(room.checklistTemplate ?? '');
      setConfirmArchive(false);
    }
    wasOpen.current = open;
  }, [
    open,
    room.name,
    room.description,
    room.curationCadence,
    room.clawAgentId,
    room.checklistTemplate,
  ]);

  const isDirty =
    name.trim() !== room.name ||
    description.trim() !== room.description ||
    cadence !== room.curationCadence ||
    agentSlug !== (room.clawAgentId ?? null) ||
    checklistTemplate.trim() !== (room.checklistTemplate ?? '').trim();
  const canSave =
    name.trim().length > 0 &&
    description.trim().length > 0 &&
    isDirty &&
    !isSaving &&
    !checklistIncomplete;

  const handleClose = (): void => {
    onOpenChange(false);
  };

  const handleSave = async (): Promise<void> => {
    if (!canSave) return;
    setIsSaving(true);
    const result = zero.mutate(
      mutators.room.update({
        roomId: room.id,
        name: name.trim(),
        description: description.trim(),
        curationCadence: cadence,
        clawAgentId: agentSlug,
        checklistTemplate: checklistTemplate.trim(),
        timestamp: Date.now(),
      }),
    );
    const res = await result.server;
    setIsSaving(false);
    if (res.type === 'error') {
      toast.error('Could not save settings', { description: res.error.message });
      return;
    }
    toast.success('Room settings saved');
    onOpenChange(false);
  };

  const handleArchive = async (): Promise<void> => {
    const result = zero.mutate(mutators.room.archive({ roomId: room.id, timestamp: Date.now() }));
    const res = await result.server;
    if (res.type === 'error') {
      toast.error('Could not archive room', { description: res.error.message });
      return;
    }
    toast.success('Room archived');
    onOpenChange(false);
    onArchived();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title='Room settings'
      description='Change what this room tracks, who curates it, and how often.'
      testId='room-settings-dialog'
      className='max-w-lg'
    >
      <header className='flex items-start justify-between gap-4 border-b border-border px-5 py-4'>
        <div className='min-w-0'>
          <h2 className='text-base font-semibold text-foreground'>Room settings</h2>
          <p className='mt-0.5 text-xs text-muted-foreground [text-wrap:pretty]'>
            Change what this room tracks, who curates it, and how often.
          </p>
        </div>
        <button
          type='button'
          onClick={handleClose}
          aria-label='Close room settings'
          className='-mr-1.5 -mt-1 inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          data-track-category='Rooms'
          data-track-name='CloseRoomSettings'
        >
          <X size={16} />
        </button>
      </header>

      <div className='flex max-h-[min(60vh,520px)] flex-col gap-6 overflow-y-auto px-5 py-5'>
        <section className='flex flex-col gap-4'>
          <div className='flex flex-col gap-1.5'>
            <label htmlFor='settings-room-name' className='text-sm font-medium text-foreground'>
              Room name
            </label>
            <Input
              id='settings-room-name'
              value={name}
              onChange={e => setName(e.target.value)}
              data-testid='settings-room-name'
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <label
              htmlFor='settings-room-description'
              className='text-sm font-medium text-foreground'
            >
              What should this room track?
            </label>
            <Textarea
              id='settings-room-description'
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              data-testid='settings-room-description'
            />
            <p className='text-xs text-muted-foreground [text-wrap:pretty]'>
              This doubles as the curation query — the agent reads it before every run.
            </p>
          </div>
        </section>

        <section className='flex flex-col gap-2'>
          <h3 className='text-sm font-medium text-foreground'>Curation cadence</h3>
          <div className='grid grid-cols-3 gap-2'>
            {CADENCE_OPTIONS.map(option => (
              <button
                key={option.value}
                type='button'
                onClick={() => setCadence(option.value)}
                aria-pressed={cadence === option.value}
                data-track-category='Rooms'
                data-track-name='SettingsSetCadence'
                data-testid={`settings-cadence-${option.value}`}
                className={cn(
                  'flex h-full flex-col justify-start rounded-xl border px-3 py-2.5 text-left',
                  'transition-[background-color,border-color,box-shadow,scale] duration-150 ease-out active:scale-[0.99]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  cadence === option.value
                    ? 'border-primary/50 bg-accent text-accent-foreground'
                    : 'border-border hover:bg-muted',
                )}
              >
                <span
                  className={cn(
                    'text-sm font-medium',
                    cadence === option.value ? 'text-foreground' : 'text-muted-foreground',
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
            You can always re-run curation on demand, whatever the cadence.
          </p>
        </section>

        <section className='flex flex-col gap-2'>
          <h3 className='text-sm font-medium text-foreground'>Curation agent</h3>
          <CurationAgentPicker value={agentSlug} onChange={setAgentSlug} />
        </section>

        <section className='flex flex-col gap-2'>
          <h3 className='text-sm font-medium text-foreground'>Checklist</h3>
          <p className='text-xs text-muted-foreground [text-wrap:pretty]'>
            Points the agent ticks off during curation, and the condition for each. Leave empty for
            no checklist.
          </p>
          <RoomChecklistTemplateEditor
            value={checklistTemplate}
            onChange={setChecklistTemplate}
            disabled={isSaving}
            onIncompleteChange={setChecklistIncomplete}
          />
        </section>

        <section className='flex flex-col gap-3 rounded-xl border border-destructive/25 bg-destructive/[0.03] p-3'>
          <div className='flex items-start gap-3'>
            <span className='mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive'>
              <Archive size={15} />
            </span>
            <div className='min-w-0 flex-1'>
              <p className='text-sm font-medium text-foreground'>Archive room</p>
              <p className='mt-0.5 text-xs text-muted-foreground [text-wrap:pretty]'>
                Curation stops and the room moves to Archived. Members keep their history.
              </p>
            </div>
          </div>
          <div className='flex items-center justify-end gap-2'>
            {confirmArchive ? (
              <>
                <span className='mr-auto text-xs font-medium text-foreground'>
                  Archive this room?
                </span>
                <Button variant='ghost' size='sm' onClick={() => setConfirmArchive(false)}>
                  Cancel
                </Button>
                <Button
                  variant='destructive'
                  size='sm'
                  onClick={() => void handleArchive()}
                  data-testid='confirm-archive-room'
                >
                  Yes, archive
                </Button>
              </>
            ) : (
              <Button
                variant='outline'
                size='sm'
                onClick={() => setConfirmArchive(true)}
                data-track-category='Rooms'
                data-track-name='ArchiveRoom'
                data-testid='archive-room'
              >
                Archive room
              </Button>
            )}
          </div>
        </section>
      </div>

      <footer className='flex items-center justify-between gap-3 border-t border-border px-5 py-4'>
        <span className='inline-flex items-center gap-1.5 text-xs text-muted-foreground'>
          <Lock size={12} />
          Always private
        </span>
        <div className='flex items-center gap-2'>
          {checklistIncomplete && (
            <span className='text-xs text-destructive [text-wrap:pretty]'>
              Finish or remove the incomplete checklist point to save.
            </span>
          )}
          <Button variant='ghost' onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={!canSave}
            data-track-category='Rooms'
            data-track-name='SaveRoomSettings'
            data-testid='save-room-settings'
          >
            {isSaving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </footer>
    </Dialog>
  );
}
