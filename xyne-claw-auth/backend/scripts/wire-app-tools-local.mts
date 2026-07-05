// Local-only one-shot: wire xyne-spaces-app-tools MCP for the current user.
// Mirrors autoConfigureSpaces (xyne-spaces-app-tools half only) from routes/users.ts
// so a developer doesn't need to do a full Spaces-login flow to test the bot tool.

import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";

async function main(): Promise<void> {
  const userId = process.argv[2];
  if (!userId) throw new Error("Usage: node --import tsx/esm scripts/wire-app-tools-local.mts <userId>");

  const ENCRYPTION_KEY_HEX = process.env["ENCRYPTION_KEY"] ?? "";
  if (!ENCRYPTION_KEY_HEX) throw new Error("ENCRYPTION_KEY env not set");
  const ENCRYPTION_KEY = Buffer.from(ENCRYPTION_KEY_HEX, "hex");

  const decrypt = (ciphertext: string, ivHex: string, authTagHex: string, key: Buffer): string => {
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "hex")), decipher.final()]).toString("utf8");
  };
  const encrypt = (plaintext: string, key: Buffer) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return {
      ciphertext: encrypted.toString("hex"),
      iv: iv.toString("hex"),
      authTag: cipher.getAuthTag().toString("hex"),
    };
  };

  const prisma = new PrismaClient();
  try {
    const appToolsServer = await prisma.mcpServer.findFirst({ where: { type: "xyne-spaces-app-tools" } });
    if (!appToolsServer) throw new Error("xyne-spaces-app-tools MCP server row missing");

    const defaultAgent = await prisma.agent.findFirst({ where: { isDefault: true } });
    if (!defaultAgent?.spacesAppToken) throw new Error("Default agent has no spacesAppToken — register it as a Spaces app first");

    const parts = defaultAgent.spacesAppToken.split(":");
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
      throw new Error("spacesAppToken not in expected ciphertext:iv:authTag format");
    }
    const appToken = decrypt(parts[0], parts[1], parts[2], ENCRYPTION_KEY);
    console.log(`Decrypted default agent app token (len=${appToken.length})`);

    const spacesUrl = process.env["XYNE_SPACES_URL"] ?? "https://spaces.xyne.juspay.net";
    const credsPlain = JSON.stringify({ url: spacesUrl, app_token: appToken });
    const { ciphertext, iv, authTag } = encrypt(credsPlain, ENCRYPTION_KEY);

    const row = await prisma.userMcpConnection.upsert({
      where: { userId_mcpServerId: { userId, mcpServerId: appToolsServer.id } },
      create: { userId, mcpServerId: appToolsServer.id, encryptedCreds: ciphertext, iv, authTag },
      update: { encryptedCreds: ciphertext, iv, authTag },
    });
    console.log(`Wired xyne-spaces-app-tools for user ${userId}, row id=${row.id}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
