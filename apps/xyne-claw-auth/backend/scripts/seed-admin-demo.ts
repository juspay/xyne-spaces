/**
 * Seeds rows for the admin panel tabs that are otherwise empty on a fresh local
 * DB: Workflow Requests, MCP Publish and Scheduled.
 *
 * Everything is attributed to a claw admin (the caller, or the first CLAW_ADMIN
 * found) so the rows show up under "My org" without needing the all-orgs filter.
 *
 *   pnpm --filter xyne-claw-auth-backend exec tsx --env-file=.env scripts/seed-admin-demo.ts
 *   SEED_ADMIN_EMAIL=you@juspay.in  … same command, to pin a specific user
 *
 * Idempotent: re-running updates the same rows instead of duplicating.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SEED_TAG = "admin-demo-seed";

async function resolveAdmin(): Promise<{ id: string; orgId: string; email: string }> {
  const email = process.env["SEED_ADMIN_EMAIL"];
  if (email) {
    const user = await prisma.user.findFirst({ where: { email } });
    if (!user) throw new Error(`No user with email ${email}`);
    return { id: user.id, orgId: user.orgId, email: user.email };
  }

  const role = await prisma.userRole.findFirst({
    where: { role: "CLAW_ADMIN" },
    orderBy: { createdAt: "asc" },
  });
  if (!role) throw new Error("No CLAW_ADMIN found — set SEED_ADMIN_EMAIL=<email>");

  const user = await prisma.user.findUnique({ where: { id: role.userId } });
  if (!user) throw new Error(`CLAW_ADMIN ${role.userId} has no user row`);
  return { id: user.id, orgId: user.orgId, email: user.email };
}

async function seedWorkflowRequest(admin: { id: string; orgId: string }): Promise<void> {
  const name = "Demo: incident triage chain";
  const workflow = await prisma.agentChainWorkflow.upsert({
    where: { createdByUserId_name: { createdByUserId: admin.id, name } },
    update: {},
    create: {
      name,
      createdByUserId: admin.id,
      definition: { nodes: [], edges: [], tag: SEED_TAG },
      triggers: [],
    },
  });

  const existing = await prisma.workflowGlobalRequest.findFirst({
    where: { workflowId: workflow.id, status: "pending" },
  });
  if (existing) {
    console.log(`  workflow request     already pending (${existing.id})`);
    return;
  }

  const request = await prisma.workflowGlobalRequest.create({
    data: { workflowId: workflow.id, requestedByUserId: admin.id, status: "pending" },
  });
  console.log(`  workflow request     created (${request.id})`);
}

async function seedMcpPublishRequest(): Promise<void> {
  const type = "demo-connector";
  const server = await prisma.mcpServer.upsert({
    where: { type },
    update: {
      connectorMeta: {
        tag: SEED_TAG,
        publishStatus: "pending",
        scope: "org",
        publishRequestedAt: new Date().toISOString(),
      },
    },
    create: {
      name: "Demo Connector",
      type,
      url: "https://example.invalid/mcp",
      description: "Seeded connector awaiting publish review.",
      transport: "http",
      credentialForm: {
        fields: [
          { name: "apiKey", label: "API key", type: "password", placeholder: "sk-…" },
          { name: "baseUrl", label: "Base URL", type: "text", placeholder: "https://…", optional: true },
        ],
      },
      httpConfigTemplate: { url: "https://example.invalid/mcp", headers: {} },
      connectorMeta: {
        tag: SEED_TAG,
        publishStatus: "pending",
        scope: "org",
        publishRequestedAt: new Date().toISOString(),
      },
    },
  });
  console.log(`  mcp publish request  ready (${server.id})`);
}

async function seedScheduledJobs(admin: { id: string; orgId: string }): Promise<void> {
  const agent = await prisma.agent.findFirst({
    where: { orgId: admin.orgId },
    orderBy: { createdAt: "asc" },
    select: { slug: true },
  });
  if (!agent) {
    console.log("  scheduled jobs       skipped — no agent in this org");
    return;
  }

  const jobs = [
    {
      label: "Demo: daily standup summary",
      task: "Summarise yesterday's activity and post it.",
      type: "cron" as const,
      cronExpression: "0 9 * * 1-5",
      nextRunAt: new Date(Date.now() + 60 * 60 * 1000),
      status: "active",
    },
    {
      label: "Demo: one-off cleanup",
      task: "Archive stale threads.",
      type: "once" as const,
      cronExpression: null,
      nextRunAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      status: "active",
    },
    {
      label: "Demo: finished backfill",
      task: "Backfill last quarter's metrics.",
      type: "once" as const,
      cronExpression: null,
      nextRunAt: null,
      status: "completed",
    },
  ];

  for (const job of jobs) {
    const existing = await prisma.scheduledJob.findFirst({
      where: { userId: admin.id, label: job.label },
    });
    if (existing) {
      console.log(`  scheduled job        exists (${job.label})`);
      continue;
    }
    await prisma.scheduledJob.create({
      data: {
        userId: admin.id,
        orgId: admin.orgId,
        agentSlug: agent.slug,
        task: job.task,
        type: job.type,
        cronExpression: job.cronExpression,
        nextRunAt: job.nextRunAt,
        status: job.status,
        label: job.label,
        runCount: job.status === "completed" ? 3 : 0,
        lastRunAt: job.status === "completed" ? new Date(Date.now() - 86400000) : null,
      },
    });
    console.log(`  scheduled job        created (${job.label})`);
  }
}

async function main(): Promise<void> {
  const admin = await resolveAdmin();
  console.log(`Seeding admin demo data for ${admin.email} (org ${admin.orgId})`);
  await seedWorkflowRequest(admin);
  await seedMcpPublishRequest();
  await seedScheduledJobs(admin);
  console.log("Done.");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
