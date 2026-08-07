import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { clawErrorText } from '@/services/claw/clawRequest';
import {
  createSlackAgentApp,
  registerSlackCommand,
  removeSlackAgentRegistration,
  syncSlackAgentApp,
} from '@/services/claw/clawSlackService';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';

export interface SlackCommandChoice {
  agent: Agent;
  commandName: string;
}

export interface SlackActions {
  busySlug: string | null;
  choice: SlackCommandChoice | null;
  setChoice: (choice: SlackCommandChoice | null) => void;
  openInstall: (agent: Agent) => void;
  updateApp: (agent: Agent) => void;
  remove: (agent: Agent) => void;
  registerCommand: (commandName: string) => void;
  registering: boolean;
}

export function useSlackActions(userId: string, onChanged: () => void): SlackActions {
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [choice, setChoice] = useState<SlackCommandChoice | null>(null);
  const [registering, setRegistering] = useState(false);
  const focusListener = useRef<(() => void) | null>(null);

  const detachFocus = useCallback((): void => {
    if (focusListener.current) {
      window.removeEventListener('focus', focusListener.current);
      focusListener.current = null;
    }
  }, []);

  useEffect(() => detachFocus, [detachFocus]);

  const openAndRefreshOnReturn = useCallback(
    (installUrl: string): void => {
      detachFocus();
      const refreshOnce = (): void => {
        detachFocus();
        onChanged();
      };
      focusListener.current = refreshOnce;
      window.addEventListener('focus', refreshOnce, { once: true });
      window.open(installUrl, '_blank', 'noopener,noreferrer');
    },
    [detachFocus, onChanged],
  );

  const openInstall = useCallback(
    (agent: Agent): void => {
      setBusySlug(agent.slug);
      void createSlackAgentApp(userId, agent.slug, agent.orgId)
        .then(created => openAndRefreshOnReturn(created.installUrl))
        .catch(error => toast.error(clawErrorText(error, 'Failed to open Slack install')))
        .finally(() => setBusySlug(null));
    },
    [userId, openAndRefreshOnReturn],
  );

  const updateApp = useCallback(
    (agent: Agent): void => {
      setBusySlug(agent.slug);
      void syncSlackAgentApp(userId, agent.slug, agent.orgId)
        .then(synced => openAndRefreshOnReturn(synced.installUrl))
        .catch(error => toast.error(clawErrorText(error, 'Failed to update Slack app')))
        .finally(() => setBusySlug(null));
    },
    [userId, openAndRefreshOnReturn],
  );

  const remove = useCallback(
    (agent: Agent): void => {
      setBusySlug(agent.slug);
      void removeSlackAgentRegistration(userId, agent.slug, agent.orgId)
        .then(() => {
          toast.success(`Slack registration removed for ${agent.name}`, {
            description: 'If the Slack app still exists, delete it in the Slack console too.',
          });
          onChanged();
        })
        .catch(error => toast.error(clawErrorText(error, 'Failed to remove Slack registration')))
        .finally(() => setBusySlug(null));
    },
    [userId, onChanged],
  );

  const registerCommand = useCallback(
    (commandName: string): void => {
      if (!choice) return;
      const { agent } = choice;
      setRegistering(true);
      void registerSlackCommand(userId, agent.slug, {
        ...(agent.orgId ? { orgId: agent.orgId } : {}),
        commandName,
      })
        .then(registered => {
          toast.success(`Registered ${registered.commandName}`);
          setChoice(null);
          onChanged();
        })
        .catch(error => toast.error(clawErrorText(error, 'Failed to register Slack command')))
        .finally(() => setRegistering(false));
    },
    [userId, choice, onChanged],
  );

  return {
    busySlug,
    choice,
    setChoice,
    openInstall,
    updateApp,
    remove,
    registerCommand,
    registering,
  };
}
