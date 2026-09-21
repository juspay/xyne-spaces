import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  fieldsForScriptedPatch,
  followupInstructionsPatch,
  hubBuiltinPatch,
  hubKnowledgePatch,
  hubMcpPatch,
  hubRowPatches,
  hubSkillsPatch,
  identityPatch,
  SCRIPTED_CHAT_NAME,
  SCRIPTED_HUB_IDS,
  SCRIPTED_IDENTITY,
  SCRIPTED_INSTRUCTIONS_AFTER_FOLLOWUP,
  SCRIPTED_TURNS,
  SCRIPTED_USER_NAME,
  sliceScriptedPatch,
} from './scriptedCreateDemo.ts';

void describe('scripted create story', () => {
  void it('has no garbage / fdaas beat', () => {
    assert.equal('garbage' in SCRIPTED_TURNS, false);
    assert.equal(
      Object.values(SCRIPTED_TURNS).some(text => /fdaas/i.test(text)),
      false,
    );
  });

  void it('writes identity only for the thin standup draft', () => {
    const patch = identityPatch();
    assert.deepEqual(fieldsForScriptedPatch(patch), [
      'name',
      'slug',
      'description',
      'systemPrompt',
    ]);
    assert.equal(patch.name, SCRIPTED_IDENTITY.name);
    assert.equal(patch.slug, SCRIPTED_IDENTITY.slug);
    assert.equal(patch.tools, undefined);
    assert.equal(patch.selectedSkillIds, undefined);
  });

  void it('patches instructions only after Daily 10am IST', () => {
    const patch = followupInstructionsPatch();
    assert.deepEqual(fieldsForScriptedPatch(patch), ['systemPrompt']);
    assert.equal(patch.systemPrompt, SCRIPTED_INSTRUCTIONS_AFTER_FOLLOWUP);
    assert.equal(patch.name, undefined);
  });

  void it('fills Hub rows one at a time: MCP, builtin, skill, knowledge', () => {
    const rows = hubRowPatches();
    assert.deepEqual(
      rows.map(patch => fieldsForScriptedPatch(patch)),
      [['tools'], ['tools'], ['skills'], ['knowledge']],
    );
    assert.deepEqual(hubMcpPatch().tools?.gateway, [SCRIPTED_HUB_IDS.slackService]);
    assert.deepEqual(hubMcpPatch().tools?.custom, []);
    assert.deepEqual(hubBuiltinPatch().tools?.custom, [SCRIPTED_HUB_IDS.summarySlug]);
    assert.deepEqual(hubBuiltinPatch().tools?.gateway, [SCRIPTED_HUB_IDS.slackService]);
    assert.deepEqual(hubSkillsPatch().selectedSkillIds, [SCRIPTED_HUB_IDS.skillId]);
    assert.deepEqual(hubKnowledgePatch().selectedKbResources, [
      { collectionId: SCRIPTED_HUB_IDS.collectionId, fileId: null },
    ]);
  });

  void it('slices one field at a time so caret can follow the write', () => {
    assert.deepEqual(Object.keys(sliceScriptedPatch(identityPatch(), 'name')), ['name']);
    assert.deepEqual(Object.keys(sliceScriptedPatch(hubMcpPatch(), 'tools')), ['tools']);
  });

  void it('uses a different chat name than the user canvas edit', () => {
    assert.notEqual(SCRIPTED_USER_NAME, SCRIPTED_CHAT_NAME);
    assert.notEqual(SCRIPTED_USER_NAME, SCRIPTED_IDENTITY.name);
  });
});
