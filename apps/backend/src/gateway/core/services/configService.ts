import type { ExternalSource } from '@prisma/client';
import { decrypt, encrypt } from '../../re-exports';
import type { BaseProvider } from '../base/baseProvider';
import { GatewayError } from '../errors';
import { PairRepository } from '../repositories/pairRepository';
import { SourceRepository } from '../repositories/sourceRepository';
import { UserTokenRepository } from '../repositories/userTokenRepository';
import type { ProviderConfig, ProviderWorkspace } from '../types';

interface StoredConfig {
  credentials: unknown;
  workspace: ProviderWorkspace;
}

/** One provider workspace per Spaces workspace, saved encrypted on a CONNECTION row in ExternalSource. */
export class ConfigService {
  private readonly sources = new SourceRepository();
  private readonly pairs = new PairRepository();
  private readonly userTokens = new UserTokenRepository();

  constructor(private readonly provider: BaseProvider) {}

  async getConnectedWorkspace(workspaceId: string): Promise<ProviderWorkspace> {
    return (await this.getConfigByWorkspace(workspaceId)).workspace;
  }

  async saveConfig(
    workspaceId: string,
    userId: string,
    input: unknown
  ): Promise<ProviderWorkspace> {
    const credentials = this.provider.credentialsSchema.parse(input);
    const workspace = await this.provider.validateCredentials(credentials);
    const name = this.provider.configSourceName(workspace.externalWorkspaceId);

    const [current, existing] = await Promise.all([
      this.sources.findActiveConfig(workspaceId, this.provider.configSourceType),
      this.sources.findByName(name),
    ]);
    if (existing && existing.workspaceId !== workspaceId) {
      throw new GatewayError(
        'ALREADY_CONFIGURED',
        `This ${this.provider.displayName} workspace is set up in another Spaces workspace`
      );
    }
    if (current && current.name !== name) {
      throw new GatewayError(
        'ALREADY_CONFIGURED',
        `Remove the current ${this.provider.displayName} config first`
      );
    }

    const stored: StoredConfig = { credentials, workspace };
    const encrypted = encrypt(JSON.stringify(stored));
    if (existing) {
      await this.sources.update(existing.id, {
        credentials: encrypted,
        displayName: workspace.name,
        isActive: true,
      });
    } else {
      await this.sources.createConfig({
        name,
        sourceType: this.provider.configSourceType,
        displayName: workspace.name,
        externalWorkspaceId: workspace.externalWorkspaceId,
        credentials: encrypted,
        workspaceId,
        createdBy: userId,
      });
    }
    return workspace;
  }

  /** Deactivates the config, drops its secrets and people's tokens, and pauses every link on it. */
  async removeConfig(workspaceId: string): Promise<void> {
    const source = await this.sources.findActiveConfig(workspaceId, this.provider.configSourceType);
    if (!source) throw this.notConfiguredError();
    await this.sources.update(source.id, { isActive: false, credentials: encrypt('{}') });
    // A later config may be another provider workspace, where these tokens mean nothing.
    await this.userTokens.deleteByWorkspace(workspaceId, this.provider.configSourceType);
    await this.pairs.pauseByConnection(source.id, 'NOT_CONFIGURED');
  }

  async getConfigByWorkspace(workspaceId: string): Promise<ProviderConfig> {
    const source = await this.sources.findActiveConfig(workspaceId, this.provider.configSourceType);
    if (!source) throw this.notConfiguredError();
    return this.decryptConfig(source);
  }

  async getConfigBySource(sourceId: string): Promise<ProviderConfig> {
    const source = await this.sources.findById(sourceId);
    if (!source?.isActive) throw this.notConfiguredError();
    return this.decryptConfig(source);
  }

  async findConfigByExternalWorkspace(externalWorkspaceId: string): Promise<ProviderConfig | null> {
    const source = await this.sources.findByName(
      this.provider.configSourceName(externalWorkspaceId)
    );
    return source?.isActive ? this.decryptConfig(source) : null;
  }

  private decryptConfig(source: ExternalSource): ProviderConfig {
    const stored = JSON.parse(decrypt(source.credentials)) as StoredConfig;
    return {
      sourceId: source.id,
      workspaceId: source.workspaceId,
      workspace: stored.workspace,
      credentials: this.provider.credentialsSchema.parse(stored.credentials),
    };
  }

  private notConfiguredError(): GatewayError {
    return new GatewayError(
      'NOT_CONFIGURED',
      `${this.provider.displayName} is not set up for this workspace`
    );
  }
}
