import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

// Imports the BUILT output on purpose, like the other tests here.
import { API, defineRoute, derivedNames, routeContracts, routeSpecProblems, runComposeTemplate, sourceFieldNames } from '../dist/enc-contracts/index.js';
import { applySlackMentions, findSlackMentionIds, mergeSlackMentionIds } from '../dist/slack/mentions.js';

const SLACK_TEXT_FACTS = ['slackMentionUserIds', 'slackMentionGroupIds', 'slackMentionChannels'];

// defineRoute does not throw (a bad spec must not stop the backend from starting): this is
// where a bad contract is caught.
test('every route contract in the API table is well formed', () => {
  const contracts = routeContracts(API);
  assert.ok(contracts.length > 0);
  for (const contract of contracts) {
    assert.deepEqual(routeSpecProblems(contract), [], contract.key);
    assert.equal(contract.key, `${contract.method} ${contract.path}`);
  }
});

test('no two contracts in the API table share a method and path', () => {
  const keys = routeContracts(API).map((c) => c.key);
  assert.deepEqual(keys, [...new Set(keys)]);
});

test('routeSpecProblems catches bad specs', () => {
  const base = { response: z.object({}) };
  assert.ok(routeSpecProblems({ ...base, method: 'HEAD', path: '/x' }).length > 0);
  assert.ok(routeSpecProblems({ ...base, method: 'ALL', path: '/x' }).length > 0);
  assert.ok(routeSpecProblems({ ...base, method: 'GET', path: '/x/' }).length > 0);
  assert.ok(routeSpecProblems({ ...base, method: 'GET', path: '/api/x' }).length > 0);
  assert.ok(routeSpecProblems({ ...base, method: 'GET', path: 'x' }).length > 0);
  assert.ok(routeSpecProblems({ ...base, method: 'GET', path: '/x/*' }).length > 0);
  assert.deepEqual(routeSpecProblems({ ...base, method: 'GET', path: '/x/:id' }), []);
});

test('apps chat routes: the encrypted fields are fields of the body, as the manifest rules list them', () => {
  const { postMessage, updateMessage } = API.apps.chat;
  assert.equal(postMessage.key, 'POST /apps/chat/postMessage');
  assert.equal(updateMessage.key, 'POST /apps/chat/updateMessage');
  assert.deepEqual(sourceFieldNames(postMessage.encryption), ['markdownText', 'text']);
  assert.deepEqual(sourceFieldNames(updateMessage.encryption), ['markdownText', 'text']);
  // text: Slack mention ids (for compose) and, for postMessage, the content facts (markdown mode).
  for (const fact of SLACK_TEXT_FACTS) {
    assert.ok(derivedNames(postMessage.encryption).text.includes(fact), fact);
  }
  assert.deepEqual(derivedNames(updateMessage.encryption).text, SLACK_TEXT_FACTS);
  // The encryption contract's own field list (what the encryption service compares with the
  // rule) is unchanged: the body schema only adds fields around it.
  assert.deepEqual(Object.keys(postMessage.encryption.schema.shape).sort(), [
    'attachments', 'channelId', 'channelName', 'conversationId', 'flow', 'markdownText', 'text',
  ]);
});

test('apps postEphemeral: markdownText encrypted, nothing derived, fields as its manifest rule lists them', () => {
  const route = API.apps.chat.postEphemeral;
  assert.equal(route.key, 'POST /apps/chat/postEphemeral');
  assert.deepEqual(sourceFieldNames(route.encryption), ['markdownText', 'text']);
  assert.deepEqual(derivedNames(route.encryption), { markdownText: [], text: SLACK_TEXT_FACTS });
  // Must equal the fields of the private rule (enc_contract_entries, POST /apps/chat/postEphemeral).
  assert.deepEqual(Object.keys(route.encryption.schema.shape).sort(), [
    'attachments', 'channelId', 'channelName', 'conversationId', 'flow', 'markdownText', 'messageDelivery', 'text', 'user',
  ]);
});

test('apps postEphemeral body keeps the controller checks', () => {
  const body = API.apps.chat.postEphemeral.body;
  assert.equal(body.safeParse({ channelId: 'c1', text: 'hi' }).success, false, 'no user');
  assert.equal(body.safeParse({ channelId: 'c1', user: 'u1', text: 'hi', messageDelivery: 'OPENSCREEN' }).success, false, 'popup without flow');
  const ok = body.safeParse({ channelId: 'c1', user: ' u1 ', markdownText: 'hi' });
  assert.equal(ok.success, true);
  assert.deepEqual(ok.data, { channelId: 'c1', user: 'u1', markdownText: 'hi', messageDelivery: 'EPHEMERAL' });
});

test('apps deleteMessage and agentProgress: typed, no encryption contract', () => {
  const { deleteMessage, agentProgress } = API.apps.chat;
  assert.equal(deleteMessage.key, 'POST /apps/chat/deleteMessage');
  assert.equal(agentProgress.key, 'POST /apps/chat/agentProgress');
  assert.equal(deleteMessage.encryption, undefined);
  assert.equal(agentProgress.encryption, undefined);
});

test('apps deleteMessage and agentProgress bodies keep the controller checks', () => {
  const del = API.apps.chat.deleteMessage.body;
  assert.equal(del.safeParse({ messageId: 'm1' }).success, false, 'no channel');
  assert.equal(del.safeParse({ channelId: 'c1' }).success, false, 'no messageId');
  assert.deepEqual(del.safeParse({ messageId: ' m1 ', channelName: 'general' }).data, { messageId: 'm1', channelName: 'general' });

  const progress = API.apps.chat.agentProgress.body;
  assert.equal(progress.safeParse({ channelId: 'c1' }).success, false, 'no conversationId');
  assert.equal(progress.safeParse({ conversationId: 'cv1', status: 'paused' }).success, false, 'unknown status');
  assert.deepEqual(progress.safeParse({ conversationId: 'cv1' }).data, { conversationId: 'cv1', status: 'working' });
});

test('Slack-compatible chat.delete: typed, no encryption, Slack arguments', () => {
  const route = API.apps.slack.chatDelete;
  assert.equal(route.key, 'POST /apps/slack/chat.delete');
  assert.equal(route.encryption, undefined);
  assert.equal(route.body.safeParse({ channel: 'C1' }).success, false, 'no ts');
  // channel may be missing here: the channel check answers channel_not_found, as before.
  assert.equal(route.body.safeParse({ ts: '1' }).success, true);
  assert.deepEqual(route.response.safeParse({ ok: true, channel: 'c1', ts: 'm1' }).success, true);
});

test('apps postMessage body keeps the controller checks', () => {
  const body = API.apps.chat.postMessage.body;
  assert.equal(body.safeParse({ channelId: 'c1' }).success, false, 'no content');
  assert.equal(body.safeParse({ text: 'hi' }).success, false, 'no channel');
  const ok = body.safeParse({ channelId: ' c1 ', text: 'hi', unknown: 1 });
  assert.equal(ok.success, true);
  assert.deepEqual(ok.data, { channelId: 'c1', text: 'hi' });
});

test('defineRoute keeps the spec', () => {
  const route = defineRoute({ method: 'GET', path: '/t/:id', response: z.object({ id: z.string() }) });
  assert.equal(route.kind, 'ROUTE');
  assert.equal(route.key, 'GET /t/:id');
  assert.equal(route.encryption, undefined);
});

test('findSlackMentionIds: users, groups and channels, each once, channel names kept', () => {
  const ids = findSlackMentionIds('hi <@U1> <@U1|ada> <!subteam^S2|team> <#C9|ops> <#C9> <!here>');
  assert.deepEqual(ids, { users: ['U1'], groups: ['S2'], channels: [{ id: 'C9', name: 'ops' }] });
  assert.deepEqual(findSlackMentionIds('no mentions'), { users: [], groups: [], channels: [] });
  assert.deepEqual(
    mergeSlackMentionIds([findSlackMentionIds('<@U1> <#C9|ops>'), findSlackMentionIds('<@U2> <#C9> <!subteam^S2>')]),
    { users: ['U1', 'U2'], groups: ['S2'], channels: [{ id: 'C9', name: 'ops' }] },
  );
});

// The spans are what the backend's resolveSlackMentions built (byte for byte); the dashboard
// renders mentions from these attributes.
test('applySlackMentions: Xyne spans for found targets, names for unknown ones, special mentions', () => {
  const targets = {
    users: { U1: { id: 'u_1', name: 'Ada & Co', email: 'a@x.io', picture: 'https://p/1.png' }, U3: { unknownName: 'ghost' } },
    groups: { S2: { id: 'g_2', name: 'Oncall', alias: 'oncall', description: 'pager' } },
    channels: { C9: { id: 'c_9', name: 'ops', isPrivate: true }, C8: { unknownName: 'C8' } },
  };
  assert.equal(
    applySlackMentions('<@U1> <@U3|x> <!subteam^S2> <#C9> <#C8|x> <!here> <@U7>', targets),
    '<span data-mention data-mention-type="user" data-user-id="u_1" data-username="Ada &amp; Co" data-email="a@x.io" data-picture="https://p/1.png">@Ada &amp; Co</span> ' +
      '<span>@ghost</span> ' +
      '<span data-mention data-mention-type="group" data-group-id="g_2" data-group-name="Oncall" data-description="pager" data-group-alias="oncall">@oncall</span> ' +
      '<span data-channel-mention="" data-channel-id="c_9" data-channel-name="ops" data-is-private="true" class="chat-input-channel-mention">#ops</span> ' +
      '<span>#C8</span> ' +
      '<span class="chat-input-special-mention" data-mention-type="here">@here</span> ' +
      '<@U7>',
  );
  // Stringified JSON (blocks / attachments): single-quoted attributes.
  assert.equal(
    applySlackMentions('<!channel>', { users: {}, groups: {}, channels: {} }, true),
    "<span class='chat-input-special-mention' data-mention-type='channel'>@channel</span>",
  );
});

test('compose slackMessageContent: mentions applied, then Block Kit to HTML', () => {
  const html = runComposeTemplate('slackMessageContent', {
    text: 'hi <@U1> *bold*',
    attachments: [{ text: 'cc <@U1>' }],
    blocks: null,
    mentions: { users: { U1: { id: 'u_1', name: 'Ada' } }, groups: {}, channels: {} },
  });
  assert.match(html, /^hi <span data-mention data-mention-type="user" data-user-id="u_1" data-username="Ada">@Ada<\/span> <strong class="slack_bold">bold<\/strong>/);
  // In the attachment the span uses single quotes (stringified JSON), then is rendered.
  assert.ok(html.includes("data-user-id='u_1'") || html.includes('data-user-id="u_1"'));
  assert.throws(() => runComposeTemplate('slackMessageContent', { text: 'x' }), 'missing inputs are refused');
});
