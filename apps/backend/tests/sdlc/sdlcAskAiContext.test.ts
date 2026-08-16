import assert from 'node:assert/strict';
import { buildSdlcAskAiContext } from '../../src/sdlc/sdlcAskAiContext';
import { buildSdlcTicketLifecycleInstruction } from '../../src/sdlc/sdlcTicketLifecyclePrompt';

it('uses complete repository knowledge before falling back to read-only code inspection', () => {
  const context = buildSdlcAskAiContext({
    repo: {
      id: 'repo-1',
      name: 'Hyper Switch',
      url: 'https://github.com/juspay/hyperswitch',
    },
    channelId: 'channel-1',
    baselineDocuments: [{ title: 'Core Code Map', content: 'Architecture summary.' }],
    linkedContext: [],
  });

  assert.match(context, /begin with this repository-knowledge preflight/);
  assert.match(context, /spaces-search/);
  assert.match(context, /type: canvas/);
  assert.match(context, /in: channel-1/);
  assert.match(context, /spaces-read-canvas/);
  assert.match(context, /up to three of the most relevant results/);
  assert.match(context, /regardless of whether generation is running, failed, cancelled, complete/);
  assert.match(context, /fully and consistently support/);
  assert.match(context, /without opening a repository sandbox/);
  assert.match(context, /missing, incomplete, ambiguous, stale, or inconsistent/);
  assert.match(context, /uniform write-capable sandbox/);
  assert.match(context, /Current code is authoritative/);
  assert.match(context, /sandbox-repo-setup at most once with write:true/);
  assert.match(context, /report that live code is unavailable/);
  assert.match(context, /exact paths, symbols, or implementation questions/);
  assert.match(context, /claims remain unverified/);
  assert.match(context, /Still read relevant existing Wiki pages/);
});

it('keeps non-work actions non-mutating and disambiguates PR from PRD', () => {
  const context = buildSdlcAskAiContext({
    repo: { id: 'repo-1', name: 'Hyper Switch', url: 'https://example.test/repo' },
    channelId: 'channel-1',
    baselineDocuments: [],
    linkedContext: [],
  });

  assert.match(context, /uniformly write-capable/);
  assert.match(context, /Capability does not authorize mutation/);
  assert.match(context, /questions, PRDs, Tech Docs/);
  assert.match(context, /do not modify files/);
  assert.match(
    context,
    /Creating these Spaces artifacts does not require writable repository access/
  );
  assert.match(context, /ask whether they mean PRD or pull request/);
  assert.match(context, /queued for approval.*pending/i);
  assert.match(context, /never mark.*created or complete/i);
  assert.match(context, /sdlcRepoId/);
  assert.match(context, /sourceCanvasId/);
  assert.match(context, /never create an unlinked fallback or a duplicate ticket/i);
});

it('uses one write-capable sandbox in every environment', () => {
  const context = buildSdlcAskAiContext({
    repo: { id: 'repo-1', name: 'Hyper Switch', url: 'https://example.test/repo' },
    channelId: 'channel-1',
    baselineDocuments: [],
    linkedContext: [],
  });

  assert.match(context, /uniformly write-capable/);
  assert.match(context, /sandbox-repo-setup at most once with write:true/);
  assert.match(context, /do not modify files/);
  assert.doesNotMatch(context, /local-development fallback/);
});

it('moves implementation tickets through existing board stages at verified milestones', () => {
  const instruction = buildSdlcTicketLifecycleInstruction('PLAT-0002');

  assert.match(instruction, /spaces-tickets/);
  assert.match(instruction, /Internal ID/);
  assert.match(instruction, /spaces-boards/);
  assert.match(instruction, /implementation begins/);
  assert.match(instruction, /commit succeeds/);
  assert.match(instruction, /pull request is verified/);
  assert.match(instruction, /spaces-update-ticket/);
  assert.match(instruction, /exact existing stage name/);
  assert.match(instruction, /never mark a test-success stage when checks failed/i);
  assert.match(instruction, /ticket-stage transition.*must not block/i);
  assert.match(instruction, /do not invent/i);
  assert.match(instruction, /PLAT-0002/);

  const context = buildSdlcAskAiContext({
    repo: { id: 'repo-1', name: 'Hyper Switch', url: 'https://example.test/repo' },
    channelId: 'channel-1',
    baselineDocuments: [],
    linkedContext: [],
  });
  assert.match(context, /manage its board lifecycle throughout the work/);
});

it('delivers a warned draft pull request when repository checks do not pass', () => {
  const context = buildSdlcAskAiContext({
    repo: { id: 'repo-1', name: 'Hyper Switch', url: 'https://example.test/repo' },
    channelId: 'channel-1',
    baselineDocuments: [],
    linkedContext: [],
  });

  assert.match(context, /review git diff and git status once/i);
  assert.match(context, /run each relevant existing check once/i);
  assert.match(context, /passed, failed, unavailable, or timed out/i);
  assert.match(context, /check failures are non-blocking/i);
  assert.match(context, /commit and push the usable work/i);
  assert.match(context, /draft pull request body and final response/i);
  assert.match(context, /never claim a failed, unavailable, or timed-out check passed/i);
  assert.match(context, /unresolved merge conflicts/i);
  assert.match(context, /suspected secrets/i);
});

it('embeds baseline documents so the agent does not need to rediscover them', () => {
  const context = buildSdlcAskAiContext({
    repo: { id: 'repo-1', name: 'Hyper Switch', url: 'https://example.test/repo' },
    channelId: 'channel-1',
    baselineDocuments: [{ title: 'Run Guide', content: 'Use make run.' }],
    linkedContext: ['Linked ticket context'],
  });

  assert.match(context, /## Run Guide\nUse make run\./);
  assert.match(context, /The approved baseline documents below are already loaded/);
  assert.match(context, /Linked ticket context/);
});

it('grounds Wiki use in verified commit freshness', () => {
  const context = buildSdlcAskAiContext({
    repo: { id: 'repo-1', name: 'Hyper Switch', url: 'https://example.test/repo' },
    channelId: 'channel-1',
    baselineDocuments: [],
    linkedContext: [],
    wikiFreshness: {
      wikiCommitSha: 'a'.repeat(40),
      baseBranchHeadSha: 'b'.repeat(40),
      freshness: 'STALE',
    },
  });

  assert.match(context, /Wiki commit: a{40}/);
  assert.match(context, /base-branch head: b{40}/);
  assert.match(context, /freshness: STALE/);
  assert.match(context, /Inspect live code/);
});
