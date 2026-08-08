import assert from 'node:assert/strict';
import test from 'node:test';
import {
  claimSdlcAssistantAutoOpen,
  shouldOpenSdlcAssistantForRepository,
} from './sdlcAssistantAutoOpen.ts';

void test('does not reopen the SDLC Assistant after the screen remounts', () => {
  assert.equal(claimSdlcAssistantAutoOpen('repo-1'), true);
  assert.equal(claimSdlcAssistantAutoOpen('repo-1'), false);
});

void test('opens the SDLC Assistant for another repository', () => {
  assert.equal(claimSdlcAssistantAutoOpen('repo-2'), true);
});

void test('re-pins an open assistant when repository navigation changes', () => {
  assert.equal(
    shouldOpenSdlcAssistantForRepository({
      assistantOpen: true,
      pinnedRepositoryId: 'pets-fork',
      repositoryId: 'hyper-switch',
      autoOpenClaimed: false,
      scopeChanged: true,
    }),
    true,
  );
});

void test('does not reopen a closed assistant after its automatic open was consumed', () => {
  assert.equal(
    shouldOpenSdlcAssistantForRepository({
      assistantOpen: false,
      pinnedRepositoryId: null,
      repositoryId: 'hyper-switch',
      autoOpenClaimed: false,
      scopeChanged: true,
    }),
    false,
  );
});

void test('starts fresh when entering SDLC with the same repository still pinned', () => {
  assert.equal(
    shouldOpenSdlcAssistantForRepository({
      assistantOpen: true,
      pinnedRepositoryId: 'hyper-switch',
      repositoryId: 'hyper-switch',
      autoOpenClaimed: false,
      scopeChanged: true,
    }),
    true,
  );
});
