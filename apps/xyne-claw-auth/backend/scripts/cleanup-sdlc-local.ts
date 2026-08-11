import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const confirmed = process.argv.slice(2).includes("--yes");

function requireLocalDatabase(rawUrl: string | undefined): void {
  if (!rawUrl) throw new Error("DATABASE_URL is missing");
  const url = new URL(rawUrl);
  if (!new Set(["localhost", "127.0.0.1", "::1"]).has(url.hostname)) {
    throw new Error(`Refusing cleanup: Claw DATABASE_URL host ${url.hostname} is not local`);
  }
}

async function main(): Promise<void> {
  requireLocalDatabase(process.env.DATABASE_URL);
  const conversations = await prisma.$queryRaw<Array<{ id: string }>>`
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
