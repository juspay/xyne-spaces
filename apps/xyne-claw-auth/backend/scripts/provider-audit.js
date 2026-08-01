/**
 * READ-ONLY audit: EVERY credential for the given providers across ALL orgs —
 * every shared_provider_credentials row (with all agent/user bindings), every
 * DEDICATED agent credential, and 30d usage per agent.
 *
 * Run inside the claw-auth pod:
 *   kubectl exec -i -n $NS $POD -- node < scripts/provider-audit.js
 * Providers default to claude,codex; override: PROVIDERS=claude kubectl exec …
 *
 * Only SELECTs — no writes, nothing decrypted.
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const PROVIDERS = (process.env.PROVIDERS || "claude,codex").split(",").map((s) => s.trim());

const fmtDate = (d) => (d?.toISOString ? d.toISOString().slice(0, 16) : String(d ?? "-"));

async function usageBySlugs(provider, slugs) {
  if (slugs.length === 0) return [];
  const ph = slugs.map((_, i) => `$${i + 2}`).join(",");
  return prisma.$queryRawUnsafe(
    `SELECT "agentSlug", COUNT(*)::int AS runs,
            COALESCE(SUM("tokensIn"),0)::bigint AS t_in, COALESCE(SUM("tokensOut"),0)::bigint AS t_out,
            COALESCE(SUM("tokensCacheRead"),0)::bigint AS t_cache, MAX("startedAt") AS last_run
       FROM agent_runs
      WHERE provider = $1 AND "agentSlug" IN (${ph}) AND "startedAt" > now() - interval '30 days'
      GROUP BY "agentSlug" ORDER BY runs DESC`, provider, ...slugs);
}

async function main() {
  for (const provider of PROVIDERS) {
    console.log(`\n################ PROVIDER: ${provider} ################`);

    // ── 1. Every shared credential row, all orgs ─────────────────────────────
    const shared = await prisma.$queryRawUnsafe(
      `SELECT s.id, s.name, s."orgId", o.name AS org_name, s."authType", u.email AS owner_email, s."updatedAt"
         FROM shared_provider_credentials s
         LEFT JOIN organizations o ON o.id = s."orgId"
         LEFT JOIN users u ON u.id = s."ownerUserId"
        WHERE s.provider = $1 ORDER BY s."orgId" NULLS FIRST, s.name`, provider);

    console.log(`\n== SHARED credentials (${shared.length}) ==`);
    for (const s of shared) {
      console.log(`\n▶ "${s.name}" id=${s.id} org=${s.org_name ?? s.orgId ?? "PLATFORM-WIDE"} connectedBy=${s.owner_email ?? "-"} authType=${s.authType ?? "-"} lastRotated=${fmtDate(s.updatedAt)}`);
      const agentBindings = await prisma.$queryRawUnsafe(
        `SELECT ag.slug, ag.name, ag."orgId", ou.email AS owner_email
           FROM agent_provider_credentials apc
           JOIN agents ag ON ag.id = apc."agentId"
           LEFT JOIN users ou ON ou.id = ag."ownerUserId"
          WHERE apc."sharedCredentialId" = $1 AND apc.provider = $2 ORDER BY ag.slug`, s.id, provider);
      for (const b of agentBindings)
        console.log(`   agent ${b.slug.padEnd(30)} owner=${(b.owner_email ?? "-").padEnd(35)} org=${b.orgId}`);
      const userBindings = await prisma.$queryRawUnsafe(
        `SELECT uu.email FROM user_provider_credentials upc JOIN users uu ON uu.id = upc."userId"
          WHERE upc."sharedCredentialId" = $1 AND upc.provider = $2 ORDER BY uu.email`, s.id, provider);
      for (const u of userBindings) console.log(`   user  ${u.email} (personal binding)`);

      const usage = await usageBySlugs(provider, agentBindings.map((b) => b.slug));
      for (const r of usage)
        console.log(`   30d   ${r.agentSlug.padEnd(30)} runs=${String(r.runs).padEnd(6)} out=${r.t_out} in=${r.t_in} cacheRead=${r.t_cache} last=${fmtDate(r.last_run)}`);
    }

    // ── 2. DEDICATED agent credentials (own key, not bound to any shared row) ─
    const dedicated = await prisma.$queryRawUnsafe(
      `SELECT ag.slug, ag.name, ag."orgId", ou.email AS owner_email, apc."authType", apc."updatedAt", cu.email AS created_by
         FROM agent_provider_credentials apc
         JOIN agents ag ON ag.id = apc."agentId"
         LEFT JOIN users ou ON ou.id = ag."ownerUserId"
         LEFT JOIN users cu ON cu.id = apc."createdByUserId"
        WHERE apc.provider = $1 AND apc."sharedCredentialId" IS NULL AND apc."encryptedKey" IS NOT NULL
        ORDER BY ag.slug`, provider);
    console.log(`\n== DEDICATED agent keys (${dedicated.length}) — separate credentials, not your shared row ==`);
    for (const d of dedicated)
      console.log(`   ${d.slug.padEnd(30)} owner=${(d.owner_email ?? "-").padEnd(35)} connectedBy=${d.created_by ?? "-"} authType=${d.authType ?? "-"} updated=${fmtDate(d.updatedAt)}`);
    const dedUsage = await usageBySlugs(provider, dedicated.map((d) => d.slug));
    for (const r of dedUsage)
      console.log(`   30d   ${r.agentSlug.padEnd(30)} runs=${String(r.runs).padEnd(6)} out=${r.t_out} in=${r.t_in} last=${fmtDate(r.last_run)}`);

    // ── 3. PERSONAL user keys (dedicated, not bound) ─────────────────────────
    const personal = await prisma.$queryRawUnsafe(
      `SELECT uu.email, upc."authType", upc."updatedAt"
         FROM user_provider_credentials upc JOIN users uu ON uu.id = upc."userId"
        WHERE upc.provider = $1 AND upc."sharedCredentialId" IS NULL AND upc."encryptedKey" IS NOT NULL
        ORDER BY uu.email`, provider);
    console.log(`\n== PERSONAL user keys (${personal.length}) ==`);
    for (const p of personal) console.log(`   ${p.email.padEnd(40)} authType=${p.authType ?? "-"} updated=${fmtDate(p.updatedAt)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
