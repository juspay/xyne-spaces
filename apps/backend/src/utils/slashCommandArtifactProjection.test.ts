import {
  buildSlashCommandArtifactFlowMessage,
  getSlashCommandMessageArtifact,
} from '../../../../packages/shared/src/utils/slashCommandArtifact';
import {
  MessageArtifactStatus,
  MessageArtifactType,
} from '../../../../packages/shared/src/zero/types';

describe('getSlashCommandMessageArtifact', () => {
  it('builds the lightweight artifact projection from FlowJSON content', () => {
    const content = buildSlashCommandArtifactFlowMessage({
      command: 'sev2',
      body: 'API latency\n  is above   the threshold',
      screenId: 'screen-1',
      sideEffects: [
        {
          type: 'banner',
          badge: 'SEV2',
          title: 'Active incident',
          viewActionLabel: 'View incident',
          tone: 'orange',
          status: 'active',
        },
      ],
    });

    expect(getSlashCommandMessageArtifact(content)).toEqual({
      type: MessageArtifactType.SLASH_COMMAND,
      command: 'sev2',
      status: MessageArtifactStatus.ACTIVE,
      callExternalId: null,
      messagePreview: 'API latency is above the threshold',
    });
  });

  it('keeps lifecycle state without copying banner presentation props', () => {
    const content = buildSlashCommandArtifactFlowMessage({
      command: 'sev2',
      body: 'Database unavailable',
      screenId: 'screen-2',
      sideEffects: [
        {
          type: 'banner',
          badge: 'SEV2',
          title: 'Active incident',
          viewActionLabel: 'View incident',
          tone: 'orange',
          status: 'completed',
          callExternalId: 'call-1',
        },
      ],
    });

    expect(getSlashCommandMessageArtifact(content)).toEqual({
      type: MessageArtifactType.SLASH_COMMAND,
      command: 'sev2',
      status: MessageArtifactStatus.COMPLETED,
      callExternalId: 'call-1',
      messagePreview: 'Database unavailable',
    });
  });
});
