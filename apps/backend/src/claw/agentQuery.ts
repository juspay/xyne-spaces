/**
 * POST /api/agent-query — the read-query route for Claw agents acting on behalf of a user.
 *
 * Same query format, validator, ACL and workspace backstop as the generic query
 * route (routes/pythonQuery.ts), so results are exactly what the user could see.
 * On top of that, for agents:
 *   - only on-behalf-of agent tokens (req.auth.clawAgent); people use Zero instead,
 *   - each model needs a scope the agent holds for this user (default deny),
 *   - sensitive columns are removed from results,
 *   - at most AGENT_MAX_TAKE rows per query.
 */

import { Router, type Request, type Response } from 'express';
import { Prisma } from '@prisma/client';
import { readReplicaDb } from '@/database/client';
import { ACLFactory } from '@/database/acl';
import { isWorkspaceScopedModel } from '@/database/tenant/acl-extension';
import { validateQueryAST, translateQueryAST } from '@/services/pythonQuery';
import { logger } from '@/utils/logger';

export const AGENT_MAX_TAKE = 200;

/** Model → scope an agent needs to read it. Models not listed are not queryable by agents. */
export const AGENT_QUERY_MODEL_SCOPES: Record<string, string> = {
  message: 'channels:read',
  conversation: 'channels:read',
  conversationParticipant: 'channels:read',
  messageAttachment: 'channels:read',
  channel: 'channels:read',
  channelParticipant: 'channels:read',
  bookmark: 'channels:read',
  draftMessage: 'channels:read',
  scheduledMessage: 'channels:read',
  user: 'users:read',
  userProfile: 'users:read',
  ticket: 'tickets:read',
  subTicket: 'tickets:read',
  project: 'tickets:read',
  board: 'tickets:read',
  stage: 'tickets:read',
  form: 'tickets:read',
  formEntityValues: 'tickets:read',
  formFields: 'tickets:read',
  email: 'email:read',
  emailDraft: 'email:read',
  call: 'calls:read',
  callParticipant: 'calls:read',
  canvas: 'canvas:read',
  collectionItem: 'kb:read',
  workflow: 'workflows:read',
  workflowExecution: 'workflows:read',
  workflowStep: 'workflows:read',
  activity: 'activity:read',
  userActivityEvent: 'activity:read',
};

/** Columns never returned to agents (a session id can mint a fresh login through refresh-session). */
export const AGENT_QUERY_OMIT: Record<string, string[]> = {
  userActivityEvent: ['sessionId'],
};

/** Columns agents may never filter or sort on (a count or ordering would leak them). */
const SENSITIVE_COLUMN = /password|secret|token|session|apikey|api_key|hash|credential|private|cookie/i;

let scalarFieldCache: Map<string, Set<string>> | null = null;

/** Scalar (non-relation) fields of a model, by its query name (e.g. "userActivityEvent"). */
function scalarFields(model: string): Set<string> {
  if (!scalarFieldCache) {
    scalarFieldCache = new Map();
    for (const m of Prisma.dmmf.datamodel.models) {
      const name = m.name.charAt(0).toLowerCase() + m.name.slice(1);
      scalarFieldCache.set(name, new Set(m.fields.filter((f) => f.kind === 'scalar' || f.kind === 'enum').map((f) => f.name)));
    }
  }
  return scalarFieldCache.get(model) ?? new Set();
}

/**
 * Fields an agent's query may name: scalar columns of the queried model only,
 * and none that look like secrets. Relation fields are refused (the scope and
 * the user's ACL only cover the queried model), as are relation operators,
 * which the shared validator already rejects. Returns the first bad field.
 */
export function disallowedAgentField(model: string, where: unknown, orderBy: unknown): string | undefined {
  const allowed = scalarFields(model);
  const ok = (field: string) => allowed.has(field) && !SENSITIVE_COLUMN.test(field) && !(AGENT_QUERY_OMIT[model] ?? []).includes(field);
  const walk = (node: unknown): string | undefined => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return undefined;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === 'AND' || key === 'OR' || key === 'NOT') {
        for (const item of Array.isArray(value) ? value : [value]) {
          const bad = walk(item);
          if (bad) return bad;
        }
        continue;
      }
      if (!ok(key)) return key;
    }
    return undefined;
  };
  const badWhere = walk(where);
  if (badWhere) return badWhere;
  for (const entry of Array.isArray(orderBy) ? orderBy : []) {
    for (const key of Object.keys((entry ?? {}) as Record<string, unknown>)) if (!ok(key)) return key;
  }
  return undefined;
}

type ClawAuth = { permissions?: string[]; clawAgent?: { principalId: string; onBehalfOfUserId: string | null } };

function stripColumns(model: string, rows: unknown): unknown {
  const omit = AGENT_QUERY_OMIT[model];
  if (!omit?.length || !Array.isArray(rows)) return rows;
  return rows.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const copy = { ...(row as Record<string, unknown>) };
    for (const field of omit) delete copy[field];
    return copy;
  });
}

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const auth = (req as Request & { auth?: ClawAuth }).auth;
  const agent = auth?.clawAgent;
  const userId = req.user?.id;
  const workspaceId = req.user?.workspaceId;

  // Agents acting for a user only.
  if (!agent?.onBehalfOfUserId || !userId || !workspaceId || agent.onBehalfOfUserId !== userId) {
    res.status(403).json({ error: 'agent_only' });
    return;
  }
  if (!readReplicaDb) {
    res.status(503).json({ error: 'Read replica not available' });
    return;
  }

  const validation = validateQueryAST(req.body);
  if (!validation.valid || !validation.ast) {
    res.status(400).json({ error: validation.error });
    return;
  }
  const ast = validation.ast;

  const needed = AGENT_QUERY_MODEL_SCOPES[ast.model];
  if (!needed || !(auth?.permissions ?? []).includes(needed)) {
    logger.warn('[ClawAgents] agent query outside its scopes', {
      principalId: agent.principalId,
      userId,
      model: ast.model,
      needed: needed ?? '(model not open to agents)',
    });
    res.status(403).json({ error: 'agent_scope_denied', required: needed ?? null });
    return;
  }
  const badField = disallowedAgentField(ast.model, ast.where, ast.orderBy);
  if (badField) {
    logger.warn('[ClawAgents] agent query names a field it may not use', {
      principalId: agent.principalId,
      userId,
      model: ast.model,
      field: badField,
    });
    res.status(400).json({ error: 'field_not_allowed', field: badField });
    return;
  }
  if (ast.take === undefined || ast.take > AGENT_MAX_TAKE) ast.take = AGENT_MAX_TAKE;

  try {
    const translated = translateQueryAST(ast);
    const acl = ACLFactory.getACL(
      translated.modelName as Uncapitalize<Prisma.ModelName>,
      { userId, workspaceId, memberId: req.user?.memberId, orgRole: req.user?.orgRole, role: req.user?.role },
      readReplicaDb
    );
    const whereWithAcl = await acl.applyToWhere(translated.args.where as Record<string, unknown>);
    const scopedWhere = isWorkspaceScopedModel(translated.modelName)
      ? whereWithAcl && Object.keys(whereWithAcl).length
        ? { AND: [whereWithAcl, { workspaceId }] }
        : { workspaceId }
      : whereWithAcl;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = (readReplicaDb as any)[translated.modelName];
    if (!model || typeof model !== 'object') {
      res.status(400).json({ error: `Model "${ast.model}" not found` });
      return;
    }

    const result =
      translated.operation === 'count'
        ? await model.count({ where: scopedWhere })
        : stripColumns(ast.model, await model.findMany({ ...translated.args, where: scopedWhere }));

    logger.info('[ClawAgents] agent query', {
      principalId: agent.principalId,
      userId,
      model: ast.model,
      operation: translated.operation,
      resultCount: Array.isArray(result) ? result.length : 1,
      durationMs: Date.now() - startTime,
    });
    res.json({ data: result });
  } catch (error) {
    logger.error('[ClawAgents] agent query failed', {
      principalId: agent.principalId,
      model: ast.model,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Query execution failed' });
  }
});

export { router as agentQueryRoutes };
