/**
 * Generate SQL to seed a workspace-level Slack ExternalSource.
 *
 * Usage:
 *   WORKSPACE_ID=<id> SLACK_BOT_TOKEN=<token> SLACK_SIGNING_SECRET=<secret> ENCRYPTION_KEY=<key> \
 *     npx tsx scripts/seed-slack-workspace-source.ts
 *
 * Outputs an INSERT SQL statement with encrypted credentials.
 * Copy the SQL and run it in prod.
 */

import crypto from 'crypto';

function encrypt(plaintext: string): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error('ENCRYPTION_KEY env var required');
  const keyBuffer = Buffer.from(key, 'hex');
  if (keyBuffer.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex characters)');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', keyBuffer, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

function main() {
  const workspaceId = process.env.WORKSPACE_ID;
  const botOauthToken = process.env.SLACK_BOT_TOKEN;
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;

  if (!workspaceId || !botOauthToken || !signingSecret) {
    console.error('Required env vars: WORKSPACE_ID, SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, ENCRYPTION_KEY');
    console.error('Optional env vars: SLACK_CLIENT_ID, SLACK_CLIENT_SECRET (needed for send-as-user OAuth)');
    process.exit(1);
  }

  // Guard against double-prefixed tokens (e.g. xoxb-xoxb-...)
  const cleanBotToken = botOauthToken.replace(/^(xoxb-)+/, 'xoxb-');

  const credPayload: Record<string, string> = { botOauthToken: cleanBotToken, signingSecret };
  if (clientId) credPayload.clientId = clientId;
  if (clientSecret) credPayload.clientSecret = clientSecret;

  const credentials = encrypt(JSON.stringify(credPayload));
  const id = crypto.randomBytes(12).toString('hex');
  const name = `slack-workspace-${workspaceId}`;
  const now = new Date().toISOString();

  const sql = `INSERT INTO "workflow"."external_sources" ("id", "name", "sourceType", "displayName", "channelId", "workspaceId", "credentials", "isActive", "createdAt", "updatedAt")
VALUES ('${id}', '${name}', 'slack', 'Slack Bot', NULL, '${workspaceId}', '${credentials}', true, '${now}', '${now}')
ON CONFLICT ("name") DO UPDATE SET "credentials" = EXCLUDED."credentials", "isActive" = true, "updatedAt" = EXCLUDED."updatedAt";`;

  console.log(sql);
}

main();
