import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PrismaClient, ChannelRole, UserType } from '@prisma/client';
import { db } from '../src/database/client';
import { repositories } from '../src/database/repositories/index';
import { runWithContext } from '../src/database/tenant/context';
import { installApp, configureWebhook } from '../src/apps/core/appUtils';
import { decrypt } from '../src/services/encryptionService';

const CLAW_APP_PERMISSIONS = [
  'chat:write',
  'channels:read',
  'users:read',
  'usergroups:read',
  'tickets:read',
  'tickets:write',
  'files:read',
  'files:write',
  'im:write',
  'email:read',
];

const AGENT_CHANNELS: Record<string, string[]> = {
  'ask-ai': ['general', 'ai-help', 'knowledge'],
  'claw': ['general', 'ai-help', 'claw-lab', 'engineering'],
  'digital-twin': ['general', 'ai-help'],
  'doctor-agent': ['general', 'ai-help', 'incidents'],
  'google-agent': ['general', 'ai-help'],
  'microsoft-agent': ['general', 'ai-help'],
  'grafana-agent': ['general', 'ai-help', 'incidents'],
  'sandbox-agent': ['general', 'ai-help', 'claw-lab'],
};
const DEFAULT_AGENT_CHANNELS = ['general', 'ai-help'];

const CLAW_AUTH_URL = process.env.XYNE_CLAW_AUTH_URL || 'http://localhost:3003';

interface AgentRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  spacesAppId: string | null;
}

function readEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function clawEnv(): Record<string, string> {
  const candidates = [
    path.resolve(process.cwd(), '../xyne-claw-auth/backend/.env'),
    path.resolve(process.cwd(), 'apps/xyne-claw-auth/backend/.env'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return readEnvFile(candidate);
  }
  return {};
}


function packGcm(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    enc.toString('base64'),
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
  ].join(':');
}

// ---------------------------------------------------------------------------
// Foundation
// ---------------------------------------------------------------------------

async function getFoundation() {
  const workspace = await db.workspace.findFirst({
    where: { name: 'Default Workspace' },
    select: { id: true, name: true, orgId: true },
  });
  if (!workspace) {
    throw new Error(
      'No "Default Workspace" found. Run the ACL seed first:\n' +
        '  pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/seed-acl.ts'
    );
  }

  // The app's `createdBy` — apps are owned by a real person, and the oldest
  // user in the workspace is the seeded admin.
  const admin = await db.user.findFirst({
    where: { workspaceId: workspace.id, userType: UserType.USER },
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true },
  });
  if (!admin) {
    throw new Error('No human user in the workspace to own the apps. Run scripts/seed-acl.ts first.');
  }

  return { workspaceId: workspace.id, orgId: workspace.orgId, adminId: admin.id };
}

/**
 * Intersect the scopes we want with the ones this environment actually knows
 * about. `setAppPermissions` rejects the whole set if any scope is unknown, and
 * the registry is seeded separately (scripts/seed-app-permissions.ts).
 */
async function grantableScopes(): Promise<string[]> {
  const available = await repositories.appPermissions.findAll();
  const known = new Set(available.map((p) => `${p.name}:${String(p.type).toLowerCase()}`));
  return CLAW_APP_PERMISSIONS.filter((scope) => known.has(scope));
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

interface Registered {
  slug: string;
  appId: string;
  appUserId: string;
  jwtToken: string;
  /** Plaintext app signing secret, for claw-auth's inbound HMAC check. */
  signingSecret: string | null;
  created: boolean;
}

/**
 * Create + install + configure one agent's Spaces App, reusing the production
 * code path. Returns everything claw-auth needs written back to its own row.
 *
 * Ordering matters and mirrors the HTTP flow: permissions are set on the app
 * template BEFORE installing, because `installApp` copies them onto the install
 * as APPROVED. Setting them after an install leaves them UNAPPROVED until the
 * next reinstall, and the bot then 403s on its first `chat:write`.
 */
async function registerAgent(
  agent: AgentRow,
  ctx: { workspaceId: string; orgId: string; adminId: string },
  scopes: string[]
): Promise<Registered> {
  // Adopt an existing app: either the one claw already points at, or one
  // created by a previous run / by hand in the UI (name is unique per org).
  let app = agent.spacesAppId ? await repositories.apps.findById(agent.spacesAppId) : null;
  if (app && app.orgId !== ctx.orgId) app = null;
  if (!app) {
    const byName = await repositories.apps.findMany({
      where: { name: { equals: agent.name.trim(), mode: 'insensitive' }, orgId: ctx.orgId },
    });
    app = byName[0] ?? null;
  }

  const created = !app;
  if (!app) {
    app = await repositories.apps.createApp({
      name: agent.name,
      description: agent.description || `Claw agent (${agent.slug})`,
      createdBy: ctx.adminId,
      orgId: ctx.orgId,
    });
  }

  if (scopes.length > 0) {
    await repositories.appPermissions.setAppPermissions(app.id, scopes);
  }

  // Creates org member + APP user + installed_apps + APPROVED permissions, and
  // returns the bot's JWT. On re-run this takes the update branch: re-approves
  // permissions and re-mints the token.
  const { jwtToken } = await installApp(app.id, ctx.workspaceId);

  // Point the install at claw-auth. `/webhook/app/:spacesAppId` is the current
  // route — the bare `/webhook/:agentSlug` one logs a legacy warning.
  const webhookUrl = `${CLAW_AUTH_URL}/claw/api/v1/webhook/app/${app.id}`;
  await configureWebhook(app.id, webhookUrl, ctx.workspaceId);

  const installation = await repositories.installedApps.findFirst({
    where: { appId: app.id, user: { workspaceId: ctx.workspaceId } },
  });
  if (!installation) {
    throw new Error(`install produced no installed_apps row for ${agent.slug}`);
  }

  // The app-level secret signs both the bot JWT and the outbound webhook HMAC.
  // claw-auth stores the same plaintext under its own encryption.
  let signingSecret: string | null = null;
  try {
    signingSecret = decrypt(app.signingSecret);
  } catch {
    signingSecret = null;
  }

  return {
    slug: agent.slug,
    appId: app.id,
    appUserId: installation.userId,
    jwtToken,
    signingSecret,
    created,
  };
}

// ---------------------------------------------------------------------------
// Channel membership
// ---------------------------------------------------------------------------

/**
 * Put the agent in its channels. Membership is what makes it appear in the
 * mention picker's zero state (before any query is typed) — see
 * `useMentionSearch`, which falls back to channel members when the search box
 * is empty.
 */
async function joinChannels(slug: string, userId: string, workspaceId: string): Promise<number> {
  const wanted = AGENT_CHANNELS[slug] ?? DEFAULT_AGENT_CHANNELS;
  let joined = 0;

  for (const name of wanted) {
    const channel = await db.channel.findFirst({
      where: { name, workspaceId },
      select: { id: true },
    });
    if (!channel) continue;

    const existing = await db.channelParticipant.findFirst({
      where: { channelId: channel.id, userId },
      select: { id: true },
    });
    if (existing) continue;

    await db.channelParticipant.create({
      data: { channelId: channel.id, userId, role: ChannelRole.MEMBER },
    });

    // The unread/star row the channel list reads. Agents start read.
    const status = await db.channelUserStatus.findFirst({
      where: { channelId: channel.id, userId },
      select: { id: true },
    });
    if (!status) {
      await db.channelUserStatus.create({
        data: { channelId: channel.id, userId, unreadCount: 0, isStarred: false },
      });
    }

    // Keep the denormalized counts honest — the sidebar reads channel_stats.
    await db.channel.update({
      where: { id: channel.id },
      data: { participantCount: { increment: 1 } },
    });
    await db.channelStats
      .update({ where: { channelId: channel.id }, data: { participantCount: { increment: 1 } } })
      .catch(() => undefined); // no stats row for this channel — not fatal

    joined++;
  }

  return joined;
}

// ---------------------------------------------------------------------------

async function main() {
  console.log('\n🤖 Registering Claw agents as Spaces apps\n');

  const env = clawEnv();
  const clawDbUrl = process.env.CLAW_AUTH_DATABASE_URL || env['DATABASE_URL'] || '';
  if (!clawDbUrl) {
    console.log('  ⏭  No claw-auth DATABASE_URL found — skipping.');
    console.log('     (Xyne Claw is optional; nothing to register when it is not set up.)\n');
    return;
  }

  const clawDb = new PrismaClient({ datasourceUrl: clawDbUrl, log: ['error'] });

  let agents: AgentRow[];
  try {
    agents = await clawDb.$queryRawUnsafe<AgentRow[]>(
      `SELECT id, slug, name, description, "spacesAppId"
         FROM agents
        WHERE enabled = true
        ORDER BY slug`
    );
  } catch (error) {
    console.log(
      `  ⏭  Could not read agents from claw_auth_db (${error instanceof Error ? error.message : error}).`
    );
    console.log('     Run the claw-auth seed first, or ignore this if Xyne Claw is not enabled.\n');
    await clawDb.$disconnect();
    return;
  }

  if (agents.length === 0) {
    console.log('  ⏭  No enabled agents in claw_auth_db — nothing to register.\n');
    await clawDb.$disconnect();
    return;
  }

  const { workspaceId, orgId, adminId } = await getFoundation();
  const scopes = await grantableScopes();
  if (scopes.length < CLAW_APP_PERMISSIONS.length) {
    const missing = CLAW_APP_PERMISSIONS.filter((s) => !scopes.includes(s));
    console.log(`  ℹ️  Permission registry is missing ${missing.length} scope(s): ${missing.join(', ')}`);
    console.log('     Granting what exists. Run scripts/seed-app-permissions.ts for the full set.\n');
  }

  // claw-auth's key, for the token/secret it has to read back. Missing key is
  // not fatal: the agents are still mentionable, they just cannot reply yet.
  const encryptionKeyHex = env['ENCRYPTION_KEY'] || '';
  const clawKey = encryptionKeyHex ? Buffer.from(encryptionKeyHex, 'hex') : null;
  if (!clawKey || clawKey.length !== 32) {
    console.log('  ⚠️  claw-auth ENCRYPTION_KEY missing or not a 32-byte hex value.');
    console.log('     Agents will be mentionable, but cannot post replies until it is set.\n');
  }

  const { vespaQueue } = await import('../src/queues/vespaQueue');
  let vespaReady = false;
  try {
    await vespaQueue.initialize();
    vespaReady = true;
  } catch (error) {
    console.log(
      `  ⚠️  Vespa queue unavailable (${error instanceof Error ? error.message : error}) — ` +
        'agents are still mentionable, just not searchable yet.\n'
    );
  }

  let registered = 0;
  let createdCount = 0;
  let memberships = 0;

  for (const agent of agents) {
    try {
      // Every repository write below stamps the tenant key from this scope, and
      // setAppPermissions / copyFromApp throw without it.
      const result = await runWithContext({ userId: adminId, workspaceId }, () =>
        registerAgent(agent, { workspaceId, orgId, adminId }, scopes)
      );

      memberships += await runWithContext({ userId: adminId, workspaceId }, () =>
        joinChannels(agent.slug, result.appUserId, workspaceId)
      );

      // Write back: without spacesAppId the inbound webhook cannot resolve the
      // agent, and without the token it cannot call Spaces back.
      const token = clawKey ? packGcm(result.jwtToken, clawKey) : null;
      const secret = clawKey && result.signingSecret ? packGcm(result.signingSecret, clawKey) : null;
      await clawDb.$executeRawUnsafe(
        `UPDATE agents
            SET "spacesAppId"     = $1,
                "spacesAppUserId" = $2,
                "spacesAppToken"  = COALESCE($3, "spacesAppToken"),
                "signingSecret"   = COALESCE($4, "signingSecret")
          WHERE id = $5`,
        result.appId,
        result.appUserId,
        token,
        secret,
        agent.id
      );

      registered++;
      if (result.created) createdCount++;
      console.log(
        `  ${result.created ? '✅' : '🔄'} @${agent.name} — app ${result.appId}, user ${result.appUserId}`
      );
    } catch (error) {
      console.warn(
        `  ⚠️  ${agent.slug}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  await clawDb.$disconnect();
  if (vespaReady) await vespaQueue.close();

  console.log(
    `\n✅ ${registered}/${agents.length} agents registered ` +
      `(${createdCount} new, ${registered - createdCount} refreshed) · ${memberships} channel joins`
  );
  console.log('   They now appear as users in Spaces — type @ in any channel to mention one.\n');
}

main()
  .catch((error) => {
    console.error(
      '\n❌ Claw agent registration failed:',
      error instanceof Error ? error.message : error
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
    process.exit(process.exitCode ?? 0);
  });
