export type SlackAgentRegistrationStatus = 'command' | 'created' | 'installed';

export interface SlackWorkspaceInstall {
  teamId: string;
  teamName: string;
  installedAt: string;
}

export interface SlackAgentStatus {
  agentId: string;
  agentSlug: string;
  appId: string;
  status: SlackAgentRegistrationStatus;
  commandName?: string;
  installs: SlackWorkspaceInstall[];
  installUrl: string | null;
  manifestStale: boolean;
}

export interface SlackAppCreated {
  appId: string;
  installUrl: string;
  reused: boolean;
}

export interface SlackAppSynced {
  appId: string;
  installUrl: string;
  scopesChanged: boolean;
}

export interface SlackCommandRegistered {
  commandName: string;
  appId: string;
}
