import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { clawErrorText } from '@/services/claw/clawRequest';
import { registerAgentInSpaces, uploadAgentPicture } from '@/services/claw/clawAdminService';
import { getClawAgentBySlug } from '@/services/claw/clawAdminService';
import { listWorkspaceClawAgents } from '@/services/claw/clawAgentPrincipalsService';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';

export type RegistrationStep = 'register' | 'upload' | 'done';

export interface RegistrationFlow {
  agentSlug: string;
  agentName: string;
  step: RegistrationStep;
  busy: boolean;
  error?: string | undefined;
}

const NEXT_STEP: Record<Exclude<RegistrationStep, 'done'>, RegistrationStep> = {
  register: 'upload',
  upload: 'done',
};

export const STEP_LABEL: Record<RegistrationStep, string> = {
  register: 'Add to workspace',
  upload: 'Upload photo',
  done: 'Added',
};

const WORKSPACE_AGENTS_KEY = ['claw', 'workspace-agents'] as const;

export interface AgentRegistration {
  flow: RegistrationFlow | null;
  /** Is this Claw agent added to the current Spaces workspace? */
  isRegistered: (agentId: string) => boolean;
  /** False until the workspace's agent list has loaded. */
  registrationKnown: boolean;
  start: (agent: Agent) => void;
  startForSlug: (userId: string, slug: string) => Promise<void>;
  dismiss: () => void;
  runStep: () => Promise<void>;
  pickPicture: () => void;
  pickPictureFor: (slug: string) => void;
  fileInputProps: {
    ref: React.RefObject<HTMLInputElement | null>;
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  };
}

export function useAgentRegistration(onChanged: () => void): AgentRegistration {
  const [flow, setFlow] = useState<RegistrationFlow | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const rowUploadSlug = useRef<string | null>(null);
  const queryClient = useQueryClient();

  const workspaceAgents = useQuery({
    queryKey: WORKSPACE_AGENTS_KEY,
    queryFn: listWorkspaceClawAgents,
    staleTime: 30_000,
  });
  const registeredIds = useMemo(
    () => new Set((workspaceAgents.data ?? []).filter(p => p.status === 'ACTIVE').map(p => p.clawAgentId)),
    [workspaceAgents.data],
  );
  const isRegistered = useCallback((agentId: string): boolean => registeredIds.has(agentId), [registeredIds]);

  const start = useCallback(
    (agent: Agent): void => {
      setFlow({
        agentSlug: agent.slug,
        agentName: agent.name,
        step: registeredIds.has(agent.id) ? 'upload' : 'register',
        busy: false,
      });
    },
    [registeredIds],
  );

  const startForSlug = useCallback(
    async (userId: string, slug: string): Promise<void> => {
      let step: RegistrationStep = 'register';
      let name = slug;
      try {
        const agent = await getClawAgentBySlug(userId, slug);
        step = registeredIds.has(agent.id) ? 'done' : 'register';
        name = agent.name ?? slug;
      } catch {
        step = 'register';
      }
      setFlow({ agentSlug: slug, agentName: name, step, busy: false });
    },
    [registeredIds],
  );

  const dismiss = useCallback((): void => setFlow(null), []);

  const runStep = useCallback(async (): Promise<void> => {
    if (!flow || flow.step === 'done' || flow.step === 'upload') return;
    const { agentSlug, step } = flow;
    setFlow(current => (current ? { ...current, busy: true, error: undefined } : current));
    try {
      await registerAgentInSpaces(agentSlug);
      await queryClient.invalidateQueries({ queryKey: WORKSPACE_AGENTS_KEY });

      setFlow(current => (current ? { ...current, step: NEXT_STEP[step], busy: false } : current));
      onChanged();
    } catch (error) {
      setFlow(current =>
        current
          ? {
              ...current,
              busy: false,
              error: clawErrorText(error, `Failed to ${step}. Try again.`),
            }
          : current,
      );
    }
  }, [flow, onChanged, queryClient]);

  const pickPicture = useCallback((): void => {
    rowUploadSlug.current = null;
    fileRef.current?.click();
  }, []);

  const pickPictureFor = useCallback((slug: string): void => {
    rowUploadSlug.current = slug;
    fileRef.current?.click();
  }, []);

  const onFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
      const file = event.target.files?.[0];
      const rowSlug = rowUploadSlug.current;
      event.target.value = '';
      rowUploadSlug.current = null;

      const slug = rowSlug ?? flow?.agentSlug;
      if (!file || !slug) return;

      const inFlow = !rowSlug;

      if (!file.type.startsWith('image/')) {
        if (inFlow) {
          setFlow(current =>
            current ? { ...current, error: 'Please pick an image file' } : current,
          );
        } else {
          toast.error('Please pick an image file');
        }
        return;
      }

      if (inFlow) {
        setFlow(current => (current ? { ...current, busy: true, error: undefined } : current));
      }

      try {
        await uploadAgentPicture(slug, file);
        if (inFlow) {
          setFlow(current => (current ? { ...current, step: 'done', busy: false } : current));
        }
        toast.success('Photo uploaded');
        onChanged();
      } catch (error) {
        const message = clawErrorText(error, 'Upload failed');
        if (inFlow) {
          setFlow(current => (current ? { ...current, busy: false, error: message } : current));
        } else {
          toast.error(message);
        }
      }
    },
    [flow, onChanged],
  );

  return {
    flow,
    isRegistered,
    registrationKnown: workspaceAgents.isSuccess,
    start,
    startForSlug,
    dismiss,
    runStep,
    pickPicture,
    pickPictureFor,
    fileInputProps: { ref: fileRef, onChange: event => void onFileChange(event) },
  };
}
