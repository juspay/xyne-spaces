import { PrismaClient } from "@prisma/client";
import { withRetry, retryForever } from "./retry.js";
import { createLogger } from "./logger.js";

const log = createLogger("db");

const basePrisma = new PrismaClient();

export const prisma = basePrisma.$extends({
  query: {
    $allOperations({ operation, model, args, query }) {
      return withRetry(() => query(args), `prisma.${model ?? "raw"}.${operation}`);
    },
  },
});

// Governance writes get their own small pool with a statement timeout, so an audit backlog never starves /mcp/call.
function governanceDatasourceUrl(): string | undefined {
  try {
    const url = new URL(process.env["DATABASE_URL"] ?? "");
    url.searchParams.set("connection_limit", "5");
    url.searchParams.set("pool_timeout", "2");
    url.searchParams.set("options", "-c statement_timeout=2000");
    return url.toString();
  } catch {
    return undefined;
  }
}

const governanceUrl = governanceDatasourceUrl();
export const governancePrisma = (governanceUrl ? new PrismaClient({ datasourceUrl: governanceUrl }) : new PrismaClient()).$extends({
  query: {
    $allOperations({ operation, model, args, query }) {
      return withRetry(() => query(args), `governance.${model ?? "raw"}.${operation}`);
    },
  },
});

export type AppPrismaClient = typeof prisma;

export type AppTransactionClient = Omit<
  AppPrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;

export async function connectDb(): Promise<void> {
  await retryForever(() => basePrisma.$connect(), "prisma.connect");
  log.info("[db] Connected successfully");
}
