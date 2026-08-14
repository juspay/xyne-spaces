import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const OAUTH_PROVIDERS = [
  "google",
  "microsoft",
  "docusign",
  "egnyte",
  "miro",
  "calendly",
  "jotform",
  "wix",
  "webflow",
  "mailerlite",
  "attio",
  "honeycomb",
  "customerio"
];

async function main() {
  console.log("Starting backfill for OAuth providers...");
  const result = await prisma.mcpServer.updateMany({
    where: {
      type: {
        in: OAUTH_PROVIDERS
      }
    },
    data: {
      isOauth: true
    }
  });
  console.log(`Successfully updated ${result.count} existing MCP server rows to set isOauth=true.`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
