import {
  buildSlashCommandArtifactFlowMessage,
  findLatestSlashCommandArtifactCall,
  getSlashCommandArtifactDiagnosticKey,
  parseSlashCommandArtifactMessage,
  resolveSlashCommandArtifactCallLifecycle,
  updateSlashCommandArtifactBannerLifecycle,
} from '../../../../packages/shared/src/utils/slashCommandArtifact';

describe('slash-command artifact FlowJSON contract', () => {
  const banner = {
    type: 'banner' as const,
    badge: 'SEV2',
    title: 'Active incident',
    viewActionLabel: 'View incident',
    tone: 'orange' as const,
    status: 'active' as const,
  };
  const notifyChannel = { type: 'notify_channel' as const };

  it('stores command content and side effects in the standard FlowJSON envelope', () => {
    const content = buildSlashCommandArtifactFlowMessage({
      command: 'sev2',
      body: 'API is down for <userid:user-1> & the value is literally &quot;',
      sideEffects: [banner, notifyChannel],
      screenId: 'slash-command-sev2-test',
    });

    expect(content).toContain('data-flow-json=');
    expect(content).not.toContain('data-message-kind');
    expect(content).not.toContain('data-slash-command');

    const parsed = parseSlashCommandArtifactMessage(content);
    expect(parsed?.props).toEqual({ command: 'sev2', sideEffects: [banner, notifyChannel] });
    expect(parsed?.body).toBe('API is down for <userid:user-1> & the value is literally &quot;');
  });

  it('creates stable diagnostic correlation keys without exposing raw ids', () => {
    const rawId = 'message-12345678';
    const key = getSlashCommandArtifactDiagnosticKey(rawId);

    expect(key).toBe(getSlashCommandArtifactDiagnosticKey(rawId));
    expect(key).toMatch(/^[a-f0-9]{16}$/);
    expect(key).not.toContain(rawId);
    expect(getSlashCommandArtifactDiagnosticKey(undefined)).toBe('missing');
  });

  it('persists banner completion inside FlowJSON without custom HTML state', () => {
    const activeContent = buildSlashCommandArtifactFlowMessage({
      command: 'sev2',
      body: 'Database unavailable',
      sideEffects: [banner, notifyChannel],
      screenId: 'slash-command-lifecycle-test',
    });
    const completedContent = updateSlashCommandArtifactBannerLifecycle(
      activeContent,
      'completed',
      'call-1'
    );

    expect(completedContent).not.toBeNull();
    expect(completedContent).not.toContain('data-message-kind');
    expect(parseSlashCommandArtifactMessage(completedContent)?.props.sideEffects).toEqual([
      { ...banner, status: 'completed', callExternalId: 'call-1' },
      notifyChannel,
    ]);
  });

  it('ignores a late completion from a call replaced by a restarted call', () => {
    const initialContent = buildSlashCommandArtifactFlowMessage({
      command: 'sev2',
      body: 'Database unavailable',
      sideEffects: [banner],
      screenId: 'slash-command-restarted-call-test',
    });
    const restartedContent = updateSlashCommandArtifactBannerLifecycle(
      initialContent,
      'active',
      'new-call'
    );

    expect(restartedContent).not.toBeNull();
    expect(
      updateSlashCommandArtifactBannerLifecycle(restartedContent!, 'completed', 'old-call')
    ).toBeNull();
    expect(parseSlashCommandArtifactMessage(restartedContent)?.props.sideEffects).toEqual([
      { ...banner, status: 'active', callExternalId: 'new-call' },
    ]);
  });

  it('uses the exact artifact message link and selects the newest restarted call', () => {
    const calls = [
      {
        id: 'old-ended',
        status: 'ENDED',
        startedAt: 20,
        metadata: { conversationId: 'conversation-1', artifactMessageId: 'message-1' },
      },
      {
        id: 'new-active',
        status: 'ACTIVE',
        startedAt: 30,
        metadata: { conversationId: 'conversation-1', artifactMessageId: 'message-1' },
      },
      {
        id: 'other-artifact',
        status: 'ENDED',
        startedAt: 40,
        metadata: { conversationId: 'conversation-1', artifactMessageId: 'message-2' },
      },
    ];

    expect(
      findLatestSlashCommandArtifactCall(calls, {
        messageId: 'message-1',
      })?.id
    ).toBe('new-active');
  });

  it('ignores calls without an explicit artifact link', () => {
    const calls = [
      {
        id: 'unlinked-call',
        status: 'ENDED',
        startedAt: 20,
        metadata: { conversationId: 'conversation-1' },
      },
      {
        id: 'explicit-other-card',
        status: 'ACTIVE',
        startedAt: 30,
        metadata: { conversationId: 'conversation-1', artifactMessageId: 'message-2' },
      },
    ];

    expect(
      findLatestSlashCommandArtifactCall(calls, {
        messageId: 'message-1',
      })?.id
    ).toBeUndefined();
    expect(
      findLatestSlashCommandArtifactCall(calls, {
        messageId: 'message-3',
      })
    ).toBeUndefined();
  });

  it('drives banner and dot lifecycle from the linked call status', () => {
    const artifact = {
      messageId: 'message-1',
    };

    expect(resolveSlashCommandArtifactCallLifecycle([], artifact)).toEqual({
      status: 'pending',
    });

    const activeCall = {
      id: 'active-call',
      status: 'ACTIVE',
      startedAt: 20,
      metadata: { conversationId: 'conversation-1', artifactMessageId: 'message-1' },
    };
    expect(resolveSlashCommandArtifactCallLifecycle([activeCall], artifact)).toEqual({
      status: 'active',
      call: activeCall,
    });

    const endedCall = { ...activeCall, status: 'ENDED' };
    expect(resolveSlashCommandArtifactCallLifecycle([endedCall], artifact)).toEqual({
      status: 'completed',
      call: endedCall,
    });
  });
});
