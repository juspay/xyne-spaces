import { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import { RoomCurationCadence, RoomSourceType, type User } from '@xyne/shared';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import type { SearchChannelItem } from '../../ui/SearchChannel/SearchChannel';
import { WIZARD_STEPS, type WizardStep } from './CreateWizard.types';

interface RoomSourceInput {
  id: string;
  sourceType: RoomSourceType;
  sourceId: string;
  label: string;
}

function toRoomSources(channels: SearchChannelItem[]): RoomSourceInput[] {
  return channels.map(channel => ({
    id: uuidv4(),
    sourceType: RoomSourceType.CHANNEL,
    sourceId: channel.id,
    label: channel.name,
  }));
}

interface UseRoomCreateFormResult {
  step: WizardStep;
  stepIndex: number;
  isLastStep: boolean;
  projectId: string | null;
  setProjectId: (projectId: string) => void;
  name: string;
  setName: (name: string) => void;
  description: string;
  setDescription: (description: string) => void;
  checklistTemplate: string;
  setChecklistTemplate: (checklistTemplate: string) => void;
  cadence: RoomCurationCadence;
  setCadence: (cadence: RoomCurationCadence) => void;
  agentSlug: string | null;
  setAgentSlug: (agentSlug: string | null) => void;
  channels: SearchChannelItem[];
  setChannels: (channels: SearchChannelItem[]) => void;
  members: User[];
  setMembers: (members: User[]) => void;
  checklistIncomplete: boolean;
  setChecklistIncomplete: (checklistIncomplete: boolean) => void;
  canProceed: boolean;
  goToStep: (step: WizardStep) => void;
  goBack: () => void;
  goNext: () => void;
  isSubmitting: boolean;
  submit: () => Promise<string | null>;
}

export function useRoomCreateForm(): UseRoomCreateFormResult {
  const zero = useZero();
  const [stepIndex, setStepIndex] = useState(0);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [checklistTemplate, setChecklistTemplate] = useState('');
  const [cadence, setCadence] = useState<RoomCurationCadence>(RoomCurationCadence.MANUAL);
  const [agentSlug, setAgentSlug] = useState<string | null>(null);
  const [channels, setChannels] = useState<SearchChannelItem[]>([]);
  const [members, setMembers] = useState<User[]>([]);
  const [checklistIncomplete, setChecklistIncomplete] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const step = WIZARD_STEPS[stepIndex] ?? 'basics';
  const isLastStep = stepIndex === WIZARD_STEPS.length - 1;
  const canProceed =
    !!projectId && name.trim().length > 0 && description.trim().length > 0 && !checklistIncomplete;

  const goToStep = (target: WizardStep): void => {
    const targetIndex = WIZARD_STEPS.indexOf(target);
    if (targetIndex > 0 && !canProceed) return;
    setStepIndex(targetIndex);
  };

  const goBack = (): void => {
    setStepIndex(index => Math.max(0, index - 1));
  };

  const goNext = (): void => {
    if (!canProceed) return;
    setStepIndex(index => Math.min(WIZARD_STEPS.length - 1, index + 1));
  };

  const submit = async (): Promise<string | null> => {
    if (!canProceed || !projectId || isSubmitting) return null;
    setIsSubmitting(true);
    const roomId = uuidv4();
    const result = zero.mutate(
      mutators.room.create({
        roomId,
        projectId,
        ownerMemberId: uuidv4(),
        name: name.trim(),
        description: description.trim(),
        curationCadence: cadence,
        clawAgentId: agentSlug,
        sources: toRoomSources(channels),
        members: members.map(member => ({ id: uuidv4(), userId: member.id })),
        ...(checklistTemplate.trim() && { checklistTemplate: checklistTemplate.trim() }),
        timestamp: Date.now(),
      }),
    );
    const res = await result.server;
    setIsSubmitting(false);
    if (res.type === 'error') {
      toast.error('Could not create room', {
        description: res.error.message || 'Something went wrong.',
      });
      return null;
    }
    return roomId;
  };

  return {
    step,
    stepIndex,
    isLastStep,
    projectId,
    setProjectId,
    name,
    setName,
    description,
    setDescription,
    checklistTemplate,
    setChecklistTemplate,
    cadence,
    setCadence,
    agentSlug,
    setAgentSlug,
    channels,
    setChannels,
    members,
    setMembers,
    checklistIncomplete,
    setChecklistIncomplete,
    canProceed,
    goToStep,
    goBack,
    goNext,
    isSubmitting,
    submit,
  };
}
