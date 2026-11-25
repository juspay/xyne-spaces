import { sanitizeAgentWriteArgs } from "./lib/retired-prompt-config.js";
import { PrismaClient } from "@prisma/client";
import { withRetry, retryForever } from "./retry.js";
import { createLogger } from "./logger.js";

const log = createLogger("db");

const basePrisma = new PrismaClient();

export const prisma = basePrisma.$extends({
  query: {
    $allOperations({ operation, model, args, query }) {
      const safeArgs = sanitizeAgentWriteArgs(model, operation, args);
      return withRetry(() => query(safeArgs), `prisma.${model ?? "raw"}.${operation}`);
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
