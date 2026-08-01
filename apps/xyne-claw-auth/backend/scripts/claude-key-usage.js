/**
 * READ-ONLY report: who shares / uses the Claude key configured on a given
 * agent (default: xyne-spaces-architect).
 *
 * Run inside the claw-auth pod (it has DATABASE_URL + @prisma/client):
 *   kubectx prod
 *   POD=$(kubectl get pods -n xyne-apps -o name | grep claw-auth | head -1)
 *   kubectl exec -i -n xyne-apps $POD -- node < scripts/claude-key-usage.js
 *
 * Only SELECTs — no writes.
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const SLUG = process.env.TARGET_SLUG || "xyne-spaces-architect";
const PROVIDER = "claude";

async function main() {
  // 1. The agent + its claude credential row
  const agents = await prisma.$queryRawUnsafe(
    `SELECT a.id, a.slug, a.name, a."orgId", a."ownerUserId", u.email AS owner_email
       FROM agents a LEFT JOIN users u ON u.id = a."ownerUserId"
      WHERE a.slug = $1`, SLUG);
  if (agents.length === 0) { console.log(`No agent with slug ${SLUG}`); return; }
  for (const a of agents) {
    console.log(`\n=== Agent ${a.slug} (${a.name}) org=${a.orgId} owner=${a.owner_email ?? a.ownerUserId} ===`);
    const creds = await prisma.$queryRawUnsafe(
      `SELECT "sharedCredentialId", ("encryptedKey" IS NOT NULL) AS has_dedicated_key,
              "authType", model, "createdByUserId", "updatedAt"
         FROM agent_provider_credentials WHERE "agentId" = $1 AND provider = $2`, a.id, PROVIDER);
    if (creds.length === 0) { console.log("  (no claude credential row on this agent)"); continue; }
    const cred = creds[0];
    console.log(`  credential: ${cred.sharedCredentialId ? `BOUND to shared ${cred.sharedCredentialId}` : "DEDICATED (agent-local key)"} authType=${cred.authType} model=${cred.model ?? "-"} updated=${cred.updatedAt?.toISOString?.() ?? cred.updatedAt}`);

    let boundSlugs = [a.slug];
    if (cred.sharedCredentialId) {
      // 2. The shared row + every binding (agents + users)
      const shared = await prisma.$queryRawUnsafe(
        `SELECT s.id, s.name, s."orgId", s."authType", s.model, u.email AS owner_email, s."updatedAt"
           FROM shared_provider_credentials s LEFT JOIN users u ON u.id = s."ownerUserId"
          WHERE s.id = $1`, cred.sharedCredentialId);
      console.log(`  shared credential: "${shared[0]?.name}" org=${shared[0]?.orgId ?? "PLATFORM-WIDE"} connectedBy=${shared[0]?.owner_email} lastRotated=${shared[0]?.updatedAt?.toISOString?.() ?? ""}`);

      const agentBindings = await prisma.$queryRawUnsafe(
        `SELECT ag.slug, ag.name, ag."orgId", ou.email AS owner_email, apc."updatedAt"
           FROM agent_provider_credentials apc
           JOIN agents ag ON ag.id = apc."agentId"
           LEFT JOIN users ou ON ou.id = ag."ownerUserId"
          WHERE apc."sharedCredentialId" = $1 AND apc.provider = $2
          ORDER BY ag.slug`, cred.sharedCredentialId, PROVIDER);
      console.log(`\n  -- AGENTS sharing this key (${agentBindings.length}) --`);
      for (const b of agentBindings) console.log(`  ${b.slug.padEnd(30)} ${String(b.name).padEnd(28)} org=${b.orgId} owner=${b.owner_email ?? "-"}`);
      boundSlugs = agentBindings.map((b) => b.slug);

      const userBindings = await prisma.$queryRawUnsafe(
        `SELECT uu.email, upc."updatedAt"
           FROM user_provider_credentials upc JOIN users uu ON uu.id = upc."userId"
          WHERE upc."sharedCredentialId" = $1 AND upc.provider = $2 ORDER BY uu.email`, cred.sharedCredentialId, PROVIDER);
      console.log(`\n  -- USERS with a personal binding to this key (${userBindings.length}) --`);
      for (const u of userBindings) console.log(`  ${u.email}`);
    }

    // 3. Usage: claude runs on the bound agents, last 30 days, by agent and by user
    const slugList = boundSlugs.map((_, i) => `$${i + 1}`).join(",");
    const byAgent = await prisma.$queryRawUnsafe(
      `SELECT "agentSlug", COUNT(*)::int AS runs,
              COALESCE(SUM("tokensIn"),0)::bigint AS tokens_in, COALESCE(SUM("tokensOut"),0)::bigint AS tokens_out,
              MAX("startedAt") AS last_run
         FROM agent_runs
        WHERE provider = 'claude' AND "agentSlug" IN (${slugList}) AND "startedAt" > now() - interval '30 days'
        GROUP BY "agentSlug" ORDER BY runs DESC`, ...boundSlugs);
    console.log(`\n  -- CLAUDE RUNS by agent (last 30d) --`);
    for (const r of byAgent) console.log(`  ${r.agentSlug.padEnd(30)} runs=${String(r.runs).padEnd(6)} in=${r.tokens_in} out=${r.tokens_out} last=${r.last_run?.toISOString?.() ?? r.last_run}`);

    const byUser = await prisma.$queryRawUnsafe(
      `SELECT u.email, COUNT(*)::int AS runs,
              COALESCE(SUM(r."tokensIn"),0)::bigint AS tokens_in, COALESCE(SUM(r."tokensOut"),0)::bigint AS tokens_out,
              MAX(r."startedAt") AS last_run
         FROM agent_runs r JOIN users u ON u.id = r."userId"
        WHERE r.provider = 'claude' AND r."agentSlug" IN (${slugList}) AND r."startedAt" > now() - interval '30 days'
        GROUP BY u.email ORDER BY runs DESC LIMIT 25`, ...boundSlugs);
    console.log(`\n  -- CLAUDE RUNS by user (last 30d, top 25) --`);
    for (const r of byUser) console.log(`  ${String(r.email).padEnd(40)} runs=${String(r.runs).padEnd(6)} in=${r.tokens_in} out=${r.tokens_out} last=${r.last_run?.toISOString?.() ?? r.last_run}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
