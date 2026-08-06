import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { clawErrorText } from '@/services/claw/clawRequest';
import {
  configureAgentWebhook,
  createAgentApp,
  grantAgentPermissions,
  installAgentApp,
  uploadAgentPicture,
} from '@/services/claw/clawAdminService';
import { getClawAgentBySlug } from '@/services/claw/clawAdminService';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';

export type RegistrationStep = 'create' | 'install' | 'configure' | 'grant' | 'upload' | 'done';

export interface RegistrationFlow {
  agentSlug: string;
  step: RegistrationStep;
  busy: boolean;
  error?: string | undefined;
}

const NEXT_STEP: Record<Exclude<RegistrationStep, 'done'>, RegistrationStep> = {
  create: 'install',
  install: 'configure',
  configure: 'grant',
  grant: 'upload',
  upload: 'done',
};

export const STEP_LABEL: Record<RegistrationStep, string> = {
  create: 'Create app',
  install: 'Install app',
  configure: 'Configure webhook',
  grant: 'Grant permissions',
  upload: 'Upload photo',
  done: 'Registered',
};

export interface AgentRegistration {
  flow: RegistrationFlow | null;
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

  const start = useCallback((agent: Agent): void => {
    setFlow({
      agentSlug: agent.slug,
      step: agent.spacesAppId ? 'install' : 'create',
      busy: false,
    });
  }, []);

  const startForSlug = useCallback(async (userId: string, slug: string): Promise<void> => {
    let step: RegistrationStep = 'create';
    try {
      const agent = await getClawAgentBySlug(userId, slug);
      step = !agent.spacesAppId ? 'create' : agent.spacesAppTokenConfigured ? 'done' : 'install';
    } catch {
      step = 'create';
    }
    setFlow({ agentSlug: slug, step, busy: false });
  }, []);

  const dismiss = useCallback((): void => setFlow(null), []);

  const runStep = useCallback(async (): Promise<void> => {
    if (!flow || flow.step === 'done' || flow.step === 'upload') return;
    const { agentSlug, step } = flow;
    setFlow(current => (current ? { ...current, busy: true, error: undefined } : current));
    try {
      if (step === 'create') await createAgentApp(agentSlug);
      else if (step === 'install') await installAgentApp(agentSlug);
      else if (step === 'configure') await configureAgentWebhook(agentSlug);
      else await grantAgentPermissions(agentSlug);

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
  }, [flow, onChanged]);

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
      event.target.value = '';
      if (!file || !flow) return;
      if (!file.type.startsWith('image/')) {
        setFlow(current =>
          current ? { ...current, error: 'Please pick an image file' } : current,
        );
        return;
      }
      setFlow(current => (current ? { ...current, busy: true, error: undefined } : current));
      try {
        await uploadAgentPicture(flow.agentSlug, file);
        setFlow(current => (current ? { ...current, step: 'done', busy: false } : current));
        toast.success('Photo uploaded');
        onChanged();
      } catch (error) {
        setFlow(current =>
          current
            ? { ...current, busy: false, error: clawErrorText(error, 'Upload failed') }
            : current,
        );
      }
    },
    [flow, onChanged],
  );

  return {
    flow,
    start,
    startForSlug,
    dismiss,
    runStep,
    pickPicture,
    pickPictureFor,
    fileInputProps: { ref: fileRef, onChange: event => void onFileChange(event) },
  };
}
