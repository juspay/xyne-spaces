import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

// Imports the BUILT output on purpose, like the other tests here.
import { API, UnreadableString, defineRoute, defineRouter, derive, derivedNames, hasText, requestContractOf, reveal, routeContracts, routeSpecProblems, runComposeTemplate, sourceFieldNames, unreadableString } from '../dist/enc-contracts/index.js';
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
  assert.deepEqual(sourceFieldNames(requestContractOf(postMessage)), ['markdownText', 'text']);
  assert.deepEqual(sourceFieldNames(requestContractOf(updateMessage)), ['markdownText', 'text']);
  // text: Slack mention ids (for compose) and, for postMessage, the content facts (markdown mode).
  for (const fact of SLACK_TEXT_FACTS) {
    assert.ok(derivedNames(requestContractOf(postMessage)).text.includes(fact), fact);
  }
  assert.deepEqual(derivedNames(requestContractOf(updateMessage)).text, SLACK_TEXT_FACTS);
  // The field list the encryption service compares with the manifest rule: every body field (one
  // schema), so the rule lists them all (postMessage rule revision 3).
  assert.deepEqual(Object.keys(requestContractOf(postMessage).schema.shape).sort(), [
    'attachments', 'channelId', 'channelName', 'contentFormat', 'conversationId', 'flow', 'markdownText', 'metadata', 'text', 'uploadedFiles',
  ]);
  assert.deepEqual(Object.keys(requestContractOf(updateMessage).schema.shape).sort(), [
    'attachments', 'channelId', 'channelName', 'contentFormat', 'flowJSON', 'markdownText', 'messageId', 'metadata', 'text', 'uploadedFiles',
  ]);
});

test('apps postEphemeral: markdownText encrypted, nothing derived, fields as its manifest rule lists them', () => {
  const route = API.apps.chat.postEphemeral;
  assert.equal(route.key, 'POST /apps/chat/postEphemeral');
  assert.deepEqual(sourceFieldNames(requestContractOf(route)), ['markdownText', 'text']);
  assert.deepEqual(derivedNames(requestContractOf(route)), { markdownText: [], text: SLACK_TEXT_FACTS });
  // Must equal the fields of the private rule (enc_contract_entries, POST /apps/chat/postEphemeral, revision 2).
  assert.deepEqual(Object.keys(requestContractOf(route).schema.shape).sort(), [
    'attachments', 'channelId', 'channelName', 'contentFormat', 'conversationId', 'flow', 'markdownText', 'messageDelivery', 'metadata', 'text', 'uploadedFiles', 'user',
  ]);
});

test('apps postEphemeral body keeps the controller checks', () => {
  const body = API.apps.chat.postEphemeral.body;
  assert.equal(body.safeParse({ channelId: 'c1', text: 'hi' }).success, false, 'no user');
  assert.equal(body.safeParse({ channelId: 'c1', user: 'u1', text: 'hi', messageDelivery: 'OPENSCREEN' }).success, false, 'popup without flow');
  const ok = body.safeParse({ channelId: 'c1', user: ' u1 ', markdownText: 'hi' });
  assert.equal(ok.success, true);
  const { markdownText, ...plain } = ok.data;
  assert.deepEqual(plain, { channelId: 'c1', user: 'u1', messageDelivery: 'EPHEMERAL' });
  assert.ok(markdownText instanceof UnreadableString, 'an encrypted field comes out unreadable');
  assert.equal(reveal(markdownText), 'hi');
});

test('apps deleteMessage and agentProgress: typed, no encryption contract', () => {
  const { deleteMessage, agentProgress } = API.apps.chat;
  assert.equal(deleteMessage.key, 'POST /apps/chat/deleteMessage');
  assert.equal(agentProgress.key, 'POST /apps/chat/agentProgress');
  assert.equal(requestContractOf(deleteMessage), undefined);
  assert.equal(requestContractOf(agentProgress), undefined);
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
  assert.equal(requestContractOf(route), undefined);
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
  assert.equal(ok.data.channelId, 'c1');
  assert.ok(ok.data.text instanceof UnreadableString);
  assert.equal('unknown' in ok.data, false);
  // An empty text is no content, as before (hasText reads the length, not the text).
  assert.equal(body.safeParse({ channelId: 'c1', text: '' }).success, false, 'empty text');
  assert.equal(body.safeParse({ channelId: 'c1', text: '', markdownText: 'x' }).success, true);
});

test('defineRoute keeps the spec', () => {
  const route = defineRoute({ method: 'GET', path: '/t/:id', response: z.object({ id: z.string() }) });
  assert.equal(route.kind, 'ROUTE');
  assert.equal(route.key, 'GET /t/:id');
  assert.equal(route.facts, undefined);
  assert.equal(requestContractOf(route), undefined);
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

test('Slack chat.postMessage / postEphemeral / update: text encrypted, fields as the manifest rules list them', () => {
  const { chatPostMessage, chatPostEphemeral, chatUpdate } = API.apps.slack;
  const keys = (c) => Object.keys(requestContractOf(c).schema.shape).sort();
  assert.deepEqual(keys(chatPostMessage), ['attachments', 'blocks', 'channel', 'metadata', 'mrkdwn', 'text', 'thread_ts', 'username']);
  assert.deepEqual(keys(chatPostEphemeral), ['attachments', 'blocks', 'channel', 'metadata', 'mrkdwn', 'text', 'thread_ts', 'user', 'username']);
  assert.deepEqual(keys(chatUpdate), ['attachments', 'blocks', 'channel', 'text', 'ts']);
  for (const route of [chatPostMessage, chatPostEphemeral, chatUpdate]) {
    assert.deepEqual(sourceFieldNames(requestContractOf(route)), ['text']);
    assert.deepEqual(derivedNames(requestContractOf(route)).text, [...SLACK_TEXT_FACTS, 'rawLength']);
  }
});

test('Slack chat.postMessage body: form-encoded values parsed, content required, mrkdwn defaults to true', () => {
  const body = API.apps.slack.chatPostMessage.body;
  assert.equal(body.safeParse({ channel: 'C1' }).success, false, 'no content');
  const form = body.safeParse({ channel: 'C1', blocks: '[{"type":"divider"}]', mrkdwn: 'false', metadata: '{"a":1}' });
  assert.equal(form.success, true);
  assert.deepEqual(form.data.blocks, [{ type: 'divider' }]);
  assert.equal(form.data.mrkdwn, false);
  assert.deepEqual(form.data.metadata, { a: 1 });
  assert.equal(body.safeParse({ text: 'hi' }).data.mrkdwn, true);
});

test('handle tokens: found, rewritten by the backend\'s decisions; ids inside Slack JSON text found', async () => {
  const { findSlackMentionTokens, applySlackHandleMentions, findSlackIdsInText } = await import('../dist/slack/index.js');
  assert.deepEqual(findSlackMentionTokens('<@harry.s> <@U1|x> <@harry.s>'), ['harry.s', 'U1']);
  assert.equal(
    applySlackHandleMentions('hi <@harry.s|Harry> and <@ghost.x> and <@U1>', { 'harry.s': '<@cuid1>', 'ghost.x': '@ghost.x' }),
    'hi <@cuid1> and @ghost.x and <@U1>',
  );
  const json = JSON.stringify({
    text: 'x <@U1>',
    blocks: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'user', user_id: 'U9' }] }] }],
  });
  const ids = findSlackIdsInText(json);
  assert.ok(ids.users.includes('U1') && ids.users.includes('U9'), JSON.stringify(ids));
});

test('compose slackChatContent: plain text (mrkdwn false), HTML, flow card, handles first', () => {
  const none = { users: {}, groups: {}, channels: {} };
  const base = { attachments: null, blocks: null, handles: {}, mentions: none, idMaps: { users: {}, groups: {} }, screenId: 's1' };
  const mentions = { users: { cuid1: { id: 'cuid1', name: 'Harry' } }, groups: {}, channels: {} };

  assert.equal(
    runComposeTemplate('slackChatContent', { ...base, text: '*hi* <@harry.s>', mrkdwn: false, handles: { 'harry.s': '<@cuid1>' }, mentions }),
    '*hi* <span data-mention data-mention-type="user" data-user-id="cuid1" data-username="Harry">@Harry</span>',
  );
  assert.match(runComposeTemplate('slackChatContent', { ...base, text: '*hi*', mrkdwn: true }), /<strong class="slack_bold">hi<\/strong>/);
  const card = runComposeTemplate('slackChatContent', {
    ...base,
    text: 'fallback',
    mrkdwn: true,
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'in a block' } }],
  });
  assert.match(card, /^<div data-flow-json="\{&quot;version&quot;:&quot;2.0&quot;,&quot;screenId&quot;:&quot;s1&quot;/);
  assert.equal(runComposeTemplate('slackChatContent', { ...base, text: null, mrkdwn: true }), '');
});

// A route with a :param must not be registered before a literal route it could capture
// (`/apps/calls/:callId` before `/apps/calls/summary-templates`): routes match in the table's order.
test('API table: no duplicate routes, and a generic route never comes before a literal one it captures', () => {
  const all = routeContracts(API);
  const keys = all.map((c) => c.key);
  assert.deepEqual(keys.filter((k, i) => keys.indexOf(k) !== i), [], 'duplicate method + path');
  const seg = (p) => p.split('/').filter(Boolean);
  const sample = (p) => seg(p).map((s) => (s.startsWith(':') ? 'x' : s)).join('/');
  const captures = (pattern, concrete) => {
    const a = seg(pattern);
    const b = seg(concrete);
    return a.length === b.length && a.every((s, i) => s.startsWith(':') || s === b[i]);
  };
  for (const [i, generic] of all.entries()) {
    for (const [j, literal] of all.entries()) {
      if (i === j || generic.method !== literal.method || generic.path === literal.path) continue;
      const params = (c) => seg(c.path).filter((s) => s.startsWith(':')).length;
      if (captures(generic.path, sample(literal.path)) && params(generic) > params(literal)) {
        assert.ok(j < i, `${literal.key} must come before ${generic.key} in the API table`);
      }
    }
  }
});

test('Xyne Apps dashboard contracts: bodies keep the controllers\' rules', () => {
  const d = API.apps.dashboard;
  assert.equal(d.create.body.safeParse({ name: '' }).success, false, 'empty name');
  assert.equal(d.configureWebhook.body.safeParse({ webhookUrl: 'not a url' }).success, false);
  assert.equal(d.commandsCreate.body.safeParse({ commandName: 'Bad Name', description: 'd', commandType: 'COMMAND', commandAccessibility: 'CHAT' }).success, false);
  assert.equal(d.commandsCreate.body.safeParse({ commandName: 'ok-name', description: 'd', commandType: 'COMMAND', commandAccessibility: 'CHAT' }).success, true);
  assert.equal(d.commands.query.safeParse({}).success, false, 'commandType is required');
  assert.equal(d.incomingWebhooksList.query.safeParse({}).data.includeInactive, false);
  assert.equal(d.incomingWebhooksList.query.safeParse({ includeInactive: 'true', limit: '5' }).data.limit, 5);
  assert.equal(d.incomingWebhooksCreate.body.safeParse({ installedAppId: 'i', channelId: 'c', name: 'n' }).data.type, 'SLACK');
});

test('settings contracts: alias, client-event and tags-config rules', () => {
  assert.equal(API.activityAliases.create.body.safeParse({ eventName: 'e', eventCategory: 'c' }).success, false, 'alias names needed when not blacklisted');
  assert.equal(API.activityAliases.create.body.safeParse({ eventName: 'e', eventCategory: 'c', isBlacklisted: true }).success, true);
  assert.equal(API.clientEvents.post.body.safeParse({ userIds: [], event: 'reload' }).success, false, 'userIds must not be empty');
  assert.equal(API.clientEvents.post.body.safeParse({ userIds: ['u'], event: 'explode' }).success, false, 'unknown event');
  assert.equal(API.channelTagsConfig.update.body.safeParse({ categories: { 'Bad Name': { method: 'manual' } } }).success, false, 'category name format');
  assert.equal(API.channelTagsConfig.update.body.safeParse({ categories: { sev: { method: 'manual', tags: ['a', 'a'] } } }).success, false, 'duplicate tags');
  assert.equal(API.channelTagsConfig.update.body.safeParse({ categories: { sev: { method: 'llm', tags: ['p1', 'p2'] } } }).success, true);
});

test('notification preferences: unknown types are dropped first, the rest are checked', () => {
  const body = API.notifications.preferencesSet.body;
  const on = { browserEnabled: true, emailEnabled: false, slackEnabled: false };
  // As before (zod 4 record with enum keys), every notification type must be present.
  const all = Object.fromEntries(
    ['TICKET_STATUS_CHANGE', 'TICKET_ASSIGNMENT', 'TICKET_REASSIGNMENT', 'TICKET_DUE_DATE_CHANGED', 'TICKET_PRIORITY_CHANGED',
      'TICKET_USER_GROUP_CHANGED', 'TICKET_TITLE_CHANGED', 'TICKET_DESCRIPTION_CHANGED', 'TICKET_RCA_CREATED', 'TICKET_RCA_UPDATED',
      'TICKET_SUBTICKET_ADDED', 'TICKET_RELATED_TICKET_ADDED', 'TICKET_RELATED_TICKET_REMOVED', 'CHANNEL_MESSAGE', 'MENTION',
      'WORKFLOW_COMPLETION', 'WORKFLOW_FAILURE'].map((type) => [type, on]),
  );
  assert.equal(body.safeParse({ ...all, SYSTEM_ALERTS: on }).success, true, 'an old type is dropped, not an error');
  assert.equal(Object.keys(body.safeParse({ ...all, SYSTEM_ALERTS: on }).data).includes('SYSTEM_ALERTS'), false);
  assert.equal(body.safeParse({ ...all, MENTION: { browserEnabled: true } }).success, false, 'flags are required');
});

test('organizations, reactions, channels and labels contracts keep the controllers\' limits', () => {
  assert.equal(API.organizations.addMember.body.safeParse({ userId: 'u', role: 'VIEWER' }).success, false, 'VIEWER is not assignable here');
  assert.equal(API.organizations.addMember.body.safeParse({ userId: 'u', role: 'ADMIN' }).success, true);
  assert.equal(API.reactions.bulk.body.safeParse({ messageIds: [] }).success, false, 'at least one id');
  assert.equal(API.reactions.bulk.body.safeParse({ messageIds: Array.from({ length: 101 }, (_, i) => String(i)) }).success, false, 'at most 100');
  assert.equal(API.channels.search.query.safeParse({ q: '  ' }).success, false, 'q needs a character');
  assert.equal(API.channels.memberCounts.body.safeParse({ channelIds: Array.from({ length: 10001 }, (_, i) => String(i)) }).success, false);
  assert.equal(API.conversationLabels.unreadCounts.query.safeParse({}).success, false, 'channelId is required');
  assert.equal(API.analytics.activeUsers.query.safeParse({ groupBy: 'anything' }).success, true, 'groupBy is passed through, as before');
});

// Every response says what comes back. The few open ones are answers that belong to someone else
// (claw-auth's daily-brief answers) and are listed here on purpose; a new route with `z.unknown()`
// as its whole response fails this test.
test('API table: no route has an open (z.unknown()) response unless it is a listed passthrough', () => {
  const PASSTHROUGH = new Set(['GET /daily-brief/config', 'PUT /daily-brief/config', 'GET /daily-brief/settings', 'PUT /daily-brief/settings']);
  const open = routeContracts(API)
    .filter((c) => (c.response._zod?.def?.type ?? c.response.def?.type) === 'unknown')
    .map((c) => c.key)
    .filter((key) => !PASSTHROUGH.has(key));
  assert.deepEqual(open, []);
  assert.equal(API.subTickets.link.body.safeParse({ ticketId: ' ', mappedTicketId: 'x' }).success, false, 'blank ticketId');
});

test('one body schema: unreadableString() fields are the encrypted ones, facts must name exactly them', () => {
  const body = z.object({ channelId: z.string(), text: unreadableString().optional(), note: unreadableString().optional() });
  const response = z.object({});
  assert.deepEqual(routeSpecProblems({ method: 'POST', path: '/x', body, response, facts: { text: {}, note: {} } }), []);
  assert.deepEqual(routeSpecProblems({ method: 'POST', path: '/x', body, response, facts: { text: {} } }), [
    'encrypted fields without a facts entry: note',
  ]);
  assert.deepEqual(routeSpecProblems({ method: 'POST', path: '/x', body, response, facts: { text: {}, note: {}, channelId: {} } }), [
    'facts for fields that are not unreadableString() in the body: channelId',
  ]);
  const route = defineRoute({ method: 'POST', path: '/x', body, response, facts: { text: { userIds: derive.userIds }, note: {} } });
  const request = requestContractOf(route);
  assert.deepEqual(request.unreadableFields, ['text', 'note']);
  assert.deepEqual(derivedNames(request), { text: ['userIds'], note: [] });
  assert.equal(requestContractOf(route), request, 'built once per contract');
});

test('hasText: true for a non-empty string or UnreadableString, false for empty or absent', () => {
  assert.equal(hasText('a'), true);
  assert.equal(hasText(''), false);
  assert.equal(hasText(undefined), false);
  assert.equal(hasText(null), false);
  assert.equal(hasText(unreadableString().parse('a')), true);
  assert.equal(hasText(unreadableString().parse('')), false);
});

test('defineRouter: prefixes compose into the full path and key, at any depth, in table order', () => {
  const info = defineRoute({ method: 'GET', path: '/info', response: z.object({}) });
  const list = defineRoute({ method: 'GET', path: '', response: z.object({}) });
  const byId = defineRouter('/:channelId', { members: defineRoute({ method: 'GET', path: '/members', response: z.object({}) }) });
  const apps = defineRouter('/apps', { channel: defineRouter('/channel', { list, info, byId }) });
  assert.equal(apps.channel.info.path, '/apps/channel/info');
  assert.equal(apps.channel.info.key, 'GET /apps/channel/info');
  assert.equal(apps.channel.list.key, 'GET /apps/channel');
  assert.equal(apps.channel.byId.members.key, 'GET /apps/channel/:channelId/members');
  assert.deepEqual(routeContracts(apps).map((c) => c.key), ['GET /apps/channel', 'GET /apps/channel/info', 'GET /apps/channel/:channelId/members']);
  assert.equal(info.path, '/info', 'the leaf itself is not changed');
});
