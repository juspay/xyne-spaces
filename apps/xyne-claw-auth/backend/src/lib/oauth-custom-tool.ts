import { CONFIG } from "../config.js";
import { decrypt, encrypt } from "../crypto.js";
import { prisma } from "../db.js";

export type OAuthProvider = "google" | "microsoft";

const PROVIDERS: Record<OAuthProvider, { label: string; tokenUrl: () => string; clientEnv: string; configKey: string }> = {
  google: {
    label: "Google",
    tokenUrl: () => "https://oauth2.googleapis.com/token",
    clientEnv: "GOOGLE",
    configKey: "GOOGLE_ACCESS_TOKEN",
  },
  microsoft: {
    label: "Microsoft",
    tokenUrl: () => `https://login.microsoftonline.com/${process.env["MICROSOFT_TENANT_ID"] ?? "common"}/oauth2/v2.0/token`,
    clientEnv: "MICROSOFT",
    configKey: "MICROSOFT_ACCESS_TOKEN",
  },
};

export function isOAuthProvider(serverType: string): serverType is OAuthProvider {
  return serverType === "google" || serverType === "microsoft";
}

/**
 * Resolve a Google/Microsoft custom tool and the user's access token, refreshing
 * and re-storing it when it is within a minute of expiry. `run` executes the
 * tool as that user.
 */
export async function prepareOAuthCustomTool(input: {
  provider: OAuthProvider;
  tool: string;
  userId: string;
}): Promise<{ ok: true; label: string; run: (params: Record<string, unknown>) => Promise<string> } | { ok: false; message: string }> {
  const provider = PROVIDERS[input.provider];
  const { getAllCustomTools } = await import("xyne-claw-shared");
  const toolDef = getAllCustomTools().find((t) => t.slug === input.tool);
  if (!toolDef) return { ok: false, message: `Unknown ${provider.label} tool: ${input.tool}` };

  const connection = await prisma.userMcpConnection.findFirst({
    where: { userId: input.userId, mcpServer: { type: input.provider } },
  });
  if (!connection) return { ok: false, message: `No ${provider.label} connection for user ${input.userId}` };

  const creds = JSON.parse(decrypt(connection.encryptedCreds, connection.iv, connection.authTag, CONFIG.encryptionKey)) as {
    accessToken: string;
    refreshToken: string;
    expires: number;
  };
  let accessToken = creds.accessToken;

  if (Date.now() > creds.expires - 60_000) {
    const refreshRes = await fetch(provider.tokenUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env[`${provider.clientEnv}_CLIENT_ID`]!,
        client_secret: process.env[`${provider.clientEnv}_CLIENT_SECRET`]!,
        refresh_token: creds.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!refreshRes.ok) return { ok: false, message: `${provider.label} token refresh failed` };
    const tokens = (await refreshRes.json()) as { access_token: string; refresh_token?: string; expires_in: number };
    accessToken = tokens.access_token;
    const newCreds = {
      accessToken,
      refreshToken: tokens.refresh_token ?? creds.refreshToken,
      expires: Date.now() + tokens.expires_in * 1000,
    };
    const enc = encrypt(JSON.stringify(newCreds), CONFIG.encryptionKey);
    await prisma.userMcpConnection.update({
      where: { id: connection.id },
      data: { encryptedCreds: enc.ciphertext, iv: enc.iv, authTag: enc.authTag },
    });
  }

  return {
    ok: true,
    label: provider.label,
    run: (params) => toolDef.execute(params, { config: { [provider.configKey]: accessToken } }),
  };
}
