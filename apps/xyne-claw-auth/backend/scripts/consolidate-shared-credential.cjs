const { PrismaClient } = require("@prisma/client");

const provider = process.env.PROVIDER || "codex";
const sourceAgent = process.env.SOURCE_AGENT;
const newName = process.env.NEW_NAME;
const oldRows = (process.env.OLD_ROWS || "").split(",").map((s) => s.trim()).filter(Boolean);
const extraAgents = (process.env.EXTRA_AGENTS || "").split(",").map((s) => s.trim()).filter(Boolean);
const apply = process.env.APPLY === "1";

if (!sourceAgent || !newName) {
  console.error("SOURCE_AGENT and NEW_NAME are required");
  process.exit(1);
}

const p = new PrismaClient();

async function main() {
  const src = await p.agent.findFirst({ where: { slug: sourceAgent }, select: { id: true, slug: true, orgId: true, ownerUserId: true } });
  if (!src) throw new Error(`agent not found: ${sourceAgent}`);
  const cred = await p.agentProviderCredentials.findUnique({ where: { agentId_provider: { agentId: src.id, provider } } });
  if (!cred || !cred.encryptedKey || cred.sharedCredentialId) {
    throw new Error(`${sourceAgent} has no fresh dedicated ${provider} credential (re-auth it in the dashboard first)`);
  }
  const clash = await p.sharedProviderCredential.findFirst({ where: { orgId: src.orgId, provider, name: newName }, select: { id: true } });
  if (clash && !oldRows.includes(clash.id)) throw new Error(`a shared ${provider} credential named "${newName}" already exists (${clash.id}); pick another NEW_NAME`);
  if (clash) throw new Error(`NEW_NAME "${newName}" collides with old row ${clash.id}; pick another NEW_NAME`);

  const oldBindings = await p.agentProviderCredentials.findMany({ where: { provider, sharedCredentialId: { in: oldRows } }, select: { agentId: true, sharedCredentialId: true } });
  const perRow = {};
  for (const b of oldBindings) perRow[b.sharedCredentialId] = (perRow[b.sharedCredentialId] || 0) + 1;
  for (const id of oldRows) if (!perRow[id]) perRow[id] = 0;
  const extra = await p.agent.findMany({ where: { slug: { in: extraAgents } }, select: { id: true, slug: true } });
  const missingExtra = extraAgents.filter((s) => !extra.some((a) => a.slug === s));
  if (missingExtra.length) throw new Error(`EXTRA_AGENTS not found: ${missingExtra.join(", ")}`);

  const targetIds = [...new Set([src.id, ...oldBindings.map((b) => b.agentId), ...extra.map((a) => a.id)])];
  const slugs = (await p.agent.findMany({ where: { id: { in: targetIds } }, select: { slug: true } })).map((a) => a.slug).sort();

  console.log(`provider=${provider} source=${src.slug}`);
  console.log(`old rows -> bindings: ${JSON.stringify(perRow)}`);
  console.log(`will create shared "${newName}" and bind ${targetIds.length} agents:`);
  console.log(`  ${slugs.join(", ")}`);
  console.log(`will delete old rows: ${oldRows.join(", ") || "(none)"}`);
  if (!apply) {
    console.log("dry run — re-run with APPLY=1 to execute");
    return;
  }

  await p.$transaction(async (tx) => {
    const shared = await tx.sharedProviderCredential.create({
      data: {
        orgId: src.orgId,
        provider,
        name: newName,
        encryptedKey: cred.encryptedKey,
        iv: cred.iv,
        authTag: cred.authTag,
        authType: cred.authType,
        model: cred.model ?? null,
        reasoningEffort: cred.reasoningEffort ?? null,
        ownerUserId: src.ownerUserId ?? null,
      },
      select: { id: true },
    });
    for (const agentId of targetIds) {
      await tx.agentProviderCredentials.upsert({
        where: { agentId_provider: { agentId, provider } },
        create: { agentId, provider, sharedCredentialId: shared.id },
        update: { sharedCredentialId: shared.id, encryptedKey: null, iv: null, authTag: null },
      });
    }
    if (oldRows.length) {
      const left = await tx.agentProviderCredentials.count({ where: { sharedCredentialId: { in: oldRows } } });
      if (left > 0) throw new Error(`old rows still have ${left} bindings — aborting`);
      const del = await tx.sharedProviderCredential.deleteMany({ where: { id: { in: oldRows } } });
      console.log(`deleted old rows: ${del.count}`);
    }
    console.log(`created ${shared.id} "${newName}", bound ${targetIds.length} agents`);
  });
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => p.$disconnect());
