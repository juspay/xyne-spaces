import { Router, type Request, type Response } from "express";
import { createLogger } from "../logger.js";
import {
  LiteLLMProvisioningError,
  storeOrgCredentialsForOrg,
  storeTeamMappingForOrg,
  storeUserCredentialsForUser,
} from "../services/litellmProvisioning.js";

const log = createLogger("litellm-sync");

export const litellmSyncRouter = Router();

litellmSyncRouter.post("/team/store", async (req: Request, res: Response) => {
  const { orgId, teamId, teamAlias, status } = req.body as {
    orgId?: string;
    teamId?: string;
    teamAlias?: string;
    status?: string;
  };

  if (!orgId || !teamId) {
    res.status(400).json({ error: "orgId and teamId are required" });
    return;
  }

  try {
    const result = await storeTeamMappingForOrg(orgId, teamId, teamAlias, status);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof LiteLLMProvisioningError) {
      if (err.code === "CONFLICT") {
        res.status(409).json({ error: err.message });
        return;
      }
      if (err.code === "NOT_FOUND") {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err.code === "BAD_REQUEST") {
        res.status(400).json({ error: err.message });
        return;
      }
    }
    log.error("litellm-sync /team/store error", { orgId, teamId, err });
    res.status(500).json({ error: "Internal error storing team mapping" });
  }
});

litellmSyncRouter.post("/user-key/store", async (req: Request, res: Response) => {
  const body = req.body as {
    userId?: string;
    orgId?: string;
    spacesOrgId?: string;
    litellmUserId?: string;
    teamId?: string;
    key?: string;
    tokenId?: string;
    keyName?: string;
    keyAlias?: string;
    expires?: string;
  };

  if (!body.userId || !body.orgId || !body.key) {
    res.status(400).json({ error: "userId, orgId, and key are required" });
    return;
  }

  try {
    const result = await storeUserCredentialsForUser({
      userId: body.userId,
      orgId: body.orgId,
      spacesOrgId: body.spacesOrgId,
      litellmUserId: body.litellmUserId,
      teamId: body.teamId,
      key: body.key,
      tokenId: body.tokenId,
      keyName: body.keyName,
      keyAlias: body.keyAlias,
      expires: body.expires,
    });
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof LiteLLMProvisioningError) {
      if (err.code === "NOT_FOUND") {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err.code === "BAD_REQUEST") {
        res.status(400).json({ error: err.message });
        return;
      }
    }
    log.error("litellm-sync /user-key/store error", { userId: body.userId, orgId: body.orgId, err });
    res.status(500).json({ error: "Internal error storing user credentials" });
  }
});

litellmSyncRouter.post("/org-key/store", async (req: Request, res: Response) => {
  const body = req.body as {
    orgId?: string;
    spacesOrgId?: string;
    teamId?: string;
    key?: string;
    tokenId?: string;
    keyName?: string;
    keyAlias?: string;
    expires?: string;
  };

  if (!body.orgId || !body.key) {
    res.status(400).json({ error: "orgId and key are required" });
    return;
  }

  try {
    const result = await storeOrgCredentialsForOrg({
      orgId: body.orgId,
      spacesOrgId: body.spacesOrgId,
      teamId: body.teamId,
      key: body.key,
      tokenId: body.tokenId,
      keyName: body.keyName,
      keyAlias: body.keyAlias,
      expires: body.expires,
    });
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof LiteLLMProvisioningError) {
      if (err.code === "NOT_FOUND") {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err.code === "BAD_REQUEST") {
        res.status(400).json({ error: err.message });
        return;
      }
    }
    log.error("litellm-sync /org-key/store error", { orgId: body.orgId, err });
    res.status(500).json({ error: "Internal error storing org credentials" });
  }
});
