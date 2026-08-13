import { PrismaClient } from "@prisma/client";
import { readFile } from "node:fs/promises";

const prisma = new PrismaClient();

function parseArgs(): { confirmed: boolean; repoSelector?: string; clawScopeFile?: string } {
  const args = process.argv.slice(2);
  let confirmed = false;
  let repoSelector: string | undefined;
  let clawScopeFile: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--yes") {
      confirmed = true;
    } else if (arg === "--repo" || arg.startsWith("--repo=")) {
      if (repoSelector) throw new Error("--repo may only be supplied once");
      repoSelector = arg === "--repo" ? args[++index] : arg.slice("--repo=".length);
      if (!repoSelector) throw new Error("--repo requires a repository ID, name, or URL");
    } else if (arg === "--claw-scope-file") {
      clawScopeFile = args[++index];
      if (!clawScopeFile) throw new Error("--claw-scope-file requires a path");
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return { confirmed, repoSelector, clawScopeFile };
}

function requireLocalDatabase(rawUrl: string | undefined): void {
  if (!rawUrl) throw new Error("DATABASE_URL is missing");
  const url = new URL(rawUrl);
  if (!new Set(["localhost", "127.0.0.1", "::1"]).has(url.hostname)) {
    throw new Error(`Refusing cleanup: Claw DATABASE_URL host ${url.hostname} is not local`);
  }
}

async function main(): Promise<void> {
  requireLocalDatabase(process.env.DATABASE_URL);
  const { confirmed, repoSelector, clawScopeFile } = parseArgs();
  const scope = clawScopeFile
    ? (JSON.parse(await readFile(clawScopeFile, "utf8")) as {
        executionIds: string[];
        conversationIds: string[];
      })
    : null;
  if (repoSelector && !scope) {
    throw new Error("Scoped Claw cleanup requires Spaces scope data; run pnpm sdlc:cleanup from repo root");
  }
  const conversations = repoSelector
    ? await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT DISTINCT candidate.id
           FROM (
             SELECT "conversationId" AS id FROM agent_runs WHERE "conversationId" LIKE 'chat-sdlc-%'
             UNION
             SELECT "conversationId" AS id FROM chat_messages WHERE "conversationId" LIKE 'chat-sdlc-%'
           ) candidate
          WHERE candidate.id = ANY($1::text[])
             OR EXISTS (
               SELECT 1 FROM unnest($2::text[]) execution(id)
                WHERE candidate.id = 'chat-sdlc-work-' || execution.id
                   OR candidate.id LIKE 'chat-sdlc-setup-' || execution.id || '-%'
                   OR candidate.id LIKE 'chat-sdlc-wiki-' || execution.id || '-%'
             )`,
        scope?.conversationIds ?? [],
        scope?.executionIds ?? [],
      )
    : await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT DISTINCT "conversationId" AS id
          FROM agent_runs
         WHERE "conversationId" LIKE 'chat-sdlc-%'
        UNION
        SELECT DISTINCT "conversationId" AS id
          FROM chat_messages
         WHERE "conversationId" LIKE 'chat-sdlc-%'
      `;
  const conversationIds = conversations.map((row) => row.id);
  const sessionIds = conversationIds.length
    ? (
        await prisma.$queryRawUnsafe<Array<{ id: string }>>(
          'SELECT "sessionId" AS id FROM agent_runs WHERE "conversationId" = ANY($1::text[])',
          conversationIds,
        )
      ).map((row) => row.id)
    : [];
  const messageIds = conversationIds.length
    ? (
        await prisma.$queryRawUnsafe<Array<{ id: string }>>(
          'SELECT id FROM chat_messages WHERE "conversationId" = ANY($1::text[])',
          conversationIds,
        )
      ).map((row) => row.id)
    : [];

  console.table({
    clawConversations: conversationIds.length,
    clawRuns: sessionIds.length,
    clawChatMessages: messageIds.length,
  });
  if (!confirmed) return;

  const deleted = await prisma.$transaction(async (tx) => {
    let count = 0;
    if (messageIds.length > 0) {
      count += await tx.$executeRawUnsafe(
        'DELETE FROM chat_attachments WHERE "chatMessageId" = ANY($1::text[])',
        messageIds,
      );
    }
    if (conversationIds.length > 0) {
      const columns = await tx.$queryRaw<Array<{ table_name: string }>>`
        SELECT table_name
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND column_name = 'conversationId'
           AND table_name NOT IN ('agent_runs', 'chat_messages')
      `;
      for (const { table_name: table } of columns) {
        if (!/^[a-zA-Z0-9_]+$/.test(table)) throw new Error(`Unsafe table name: ${table}`);
        count += await tx.$executeRawUnsafe(
          `DELETE FROM "${table}" WHERE "conversationId" = ANY($1::text[])`,
          conversationIds,
        );
      }
      count += await tx.$executeRawUnsafe(
        'DELETE FROM chat_messages WHERE "conversationId" = ANY($1::text[])',
        conversationIds,
      );
      count += await tx.$executeRawUnsafe(
        'DELETE FROM agent_runs WHERE "conversationId" = ANY($1::text[])',
        conversationIds,
      );
    }
    return count;
  });
  console.log(`Deleted ${deleted} SDLC Claw run-history rows.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
