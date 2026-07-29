import { Request, Response } from 'express';
import { z } from 'zod';
import { DashboardToolCallSchema, type DashboardToolCall } from '@xyne/shared';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import {
  createDashboardComponent,
  deleteDashboardComponent,
  setDashboardMeta,
  updateDashboardComponent,
} from '@/services/dynamicDashboard/componentWrites';
import {
  renderRelationshipLine,
  renderTableIndexLine,
  renderTableLine,
  sanitizeDescriptionForPrompt,
} from '@/services/dynamicDashboard/promptRender';
import { executeQueryPlan } from '@/services/dynamicDashboard/queryEngine';
import { tableKey } from '@/services/dynamicDashboard/tableKeys';
import { logger } from '@/utils/logger';

// Tool endpoints for the dashboard-ai Claw agent. Each MCP tool on the
// xyne-dashboard server calls one of these routes; the response `text` is
// what the model reads. Read endpoints answer schema/query exploration;
// emit endpoints validate AND persist the change server-side (the browser
// never applies tool calls — it just refetches the dashboard).

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => `${i.path.join('.')}: ${i.message}`)
    .slice(0, 3)
    .join('; ');
}

const MAX_EXPLORATION_ROWS = 50;
const LIST_SCHEMA_PAGE_SIZE = 100;
const GET_SCHEMA_MAX_TABLES = 10;

const listSchemaBody = z.object({
  dataSourceId: z.string().min(1),
  offset: z.number().int().min(0).optional(),
});

const getTableSchemaBody = z.object({
  dataSourceId: z.string().min(1),
  tables: z.array(z.string().min(1)).min(1).max(GET_SCHEMA_MAX_TABLES),
});

const runQueryBody = z.object({
  dataSourceId: z.string().min(1),
  queryPlan: z.record(z.unknown()),
});

const emitBody = z.object({
  dataSourceId: z.string().min(1),
  draftId: z.string().min(1),
  args: z.record(z.unknown()),
});

interface AuthedContext {
  userId: string;
  workspaceId: string;
}

export class DashboardClawController {
  private requireAuth(req: Request, res: Response): AuthedContext | null {
    const user = req.user;
    if (!user?.id || !user.workspaceId) {
      res.status(401).json({ text: 'Authentication required.' });
      return null;
    }
    return { userId: user.id, workspaceId: user.workspaceId };
  }

  // Data sources are looked up by the id the model supplies — always pin them
  // to the caller's workspace before reading schema/values.
  private async requireDataSource(
    ctx: AuthedContext,
    dataSourceId: string,
    res: Response,
  ): Promise<boolean> {
    const ds = await repositories.dataSources.findById(dataSourceId);
    if (!ds || ds.workspaceId !== ctx.workspaceId) {
      res.status(404).json({ text: 'Data source not found.' });
      return false;
    }
    return true;
  }

  private badRequest(res: Response, parsed: z.SafeParseError<unknown>): void {
    res.status(400).json({ text: `Invalid request: ${formatIssues(parsed.error)}` });
  }

  // ---- read tools -----------------------------------------------------

  listSchema = async (req: Request, res: Response): Promise<void> => {
    const ctx = this.requireAuth(req, res);
    if (!ctx) return;
    const parsed = listSchemaBody.safeParse(req.body);
    if (!parsed.success) return this.badRequest(res, parsed);
    const { dataSourceId, offset = 0 } = parsed.data;
    if (!(await this.requireDataSource(ctx, dataSourceId, res))) return;

    const all = await db.dataSourceTable.findMany({
      where: { dataSourceId },
      select: {
        schemaName: true,
        tableName: true,
        rowCountEstimate: true,
        _count: { select: { columns: true } },
      },
      orderBy: [{ schemaName: 'asc' }, { tableName: 'asc' }],
    });
    if (all.length === 0) {
      res.json({ text: 'No introspected tables — ingestion may not have completed yet.' });
      return;
    }
    const page = all.slice(offset, offset + LIST_SCHEMA_PAGE_SIZE);
    const lines = page.map((t) =>
      renderTableIndexLine({
        schemaName: t.schemaName,
        tableName: t.tableName,
        rowCountEstimate: t.rowCountEstimate,
        columnCount: t._count.columns,
      }),
    );
    const more =
      offset + page.length < all.length
        ? `\n\n(${all.length - offset - page.length} more — call list_schema with offset=${offset + page.length}.)`
        : '';
    res.json({
      text: `${all.length} tables total, showing ${offset + 1}–${offset + page.length}:\n${lines.join('\n')}${more}`,
    });
  };

  getTableSchema = async (req: Request, res: Response): Promise<void> => {
    const ctx = this.requireAuth(req, res);
    if (!ctx) return;
    const parsed = getTableSchemaBody.safeParse(req.body);
    if (!parsed.success) return this.badRequest(res, parsed);
    const { dataSourceId, tables: requested } = parsed.data;
    if (!(await this.requireDataSource(ctx, dataSourceId, res))) return;

    // Resolve names against a light listing first; only the matched tables
    // get their (heavy, summary-carrying) columns fetched.
    const names = await db.dataSourceTable.findMany({
      where: { dataSourceId },
      select: { id: true, schemaName: true, tableName: true },
      orderBy: [{ schemaName: 'asc' }, { tableName: 'asc' }],
    });
    type TableName = (typeof names)[number];
    const byKey = new Map<string, TableName>(
      names.map((t) => [tableKey(t.schemaName, t.tableName).toLowerCase(), t]),
    );
    const byBare = new Map<string, TableName[]>();
    for (const t of names) {
      const k = t.tableName.toLowerCase();
      const list = byBare.get(k);
      if (list) list.push(t);
      else byBare.set(k, [t]);
    }

    const out: string[] = [];
    const resolvedIds: string[] = [];
    for (const name of requested) {
      const norm = name.trim().toLowerCase();
      const exact = byKey.get(norm);
      const bare = byBare.get(norm) ?? [];
      const match = exact ?? (bare.length === 1 ? bare[0] : undefined);
      if (match) {
        if (!resolvedIds.includes(match.id)) resolvedIds.push(match.id);
      } else if (bare.length > 1) {
        out.push(
          `"${name}" is ambiguous — specify one of: ${bare.map((t) => tableKey(t.schemaName, t.tableName)).join(', ')}`,
        );
      } else {
        out.push(`"${name}" not found — use list_schema to locate it.`);
      }
    }

    const fetched =
      resolvedIds.length > 0
        ? await db.dataSourceTable.findMany({
            where: { id: { in: resolvedIds } },
            include: { columns: true },
          })
        : [];
    // Preserve the request order (findMany with `in` does not).
    const byId = new Map(fetched.map((t) => [t.id, t]));
    const resolved = resolvedIds
      .map((id) => byId.get(id))
      .filter((t): t is NonNullable<typeof t> => t !== undefined);

    for (const t of resolved) {
      out.push(
        renderTableLine({
          schemaName: t.schemaName,
          tableName: t.tableName,
          rowCountEstimate: t.rowCountEstimate,
          description: t.description,
          columns: t.columns,
        }),
      );
      const described = t.columns.filter((c) => c.description);
      if (described.length > 0) {
        out.push(
          described
            .map(
              (c) =>
                `    ${c.columnName}: ${sanitizeDescriptionForPrompt(c.description ?? '', 200)}`,
            )
            .join('\n'),
        );
      }
    }

    if (resolved.length > 0) {
      const touching = await db.dataSourceRelationship.findMany({
        where: {
          dataSourceId,
          OR: [
            { fromColumn: { tableId: { in: resolvedIds } } },
            { toColumn: { tableId: { in: resolvedIds } } },
          ],
        },
        include: {
          fromColumn: { include: { table: true } },
          toColumn: { include: { table: true } },
        },
      });
      if (touching.length > 0) {
        out.push('\nRelationships:\n' + touching.map(renderRelationshipLine).join('\n'));
      }
    }
    res.json({ text: out.join('\n') });
  };

  runQuery = async (req: Request, res: Response): Promise<void> => {
    const ctx = this.requireAuth(req, res);
    if (!ctx) return;
    const parsed = runQueryBody.safeParse(req.body);
    if (!parsed.success) return this.badRequest(res, parsed);
    const { dataSourceId, queryPlan } = parsed.data;

    const plan = { ...queryPlan, dataSourceId, take: MAX_EXPLORATION_ROWS };
    try {
      const result = await executeQueryPlan(plan, {
        workspaceId: ctx.workspaceId,
        bypassCache: true,
      });
      if (result.rowCount === 0) {
        res.json({ text: 'Query returned 0 rows.' });
        return;
      }
      res.json({
        text: `Returned ${result.rowCount} row(s) (capped at ${MAX_EXPLORATION_ROWS}):\n${JSON.stringify(result.rows, null, 2)}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown query error';
      res.json({
        text: `Error executing query: ${message}. Re-check table/column names against get_table_schema and try again.`,
      });
    }
  };

  // ---- emit tools (validate, then persist) ----------------------------

  addComponent = this.emitHandler('add_component');
  updateComponent = this.emitHandler('update_component');
  removeComponent = this.emitHandler('remove_component');
  setDashboardMeta = this.emitHandler('set_dashboard_meta');
  drillResult = this.emitHandler('drill_result');

  private emitHandler(tool: Exclude<DashboardToolCall['tool'], 'suggest_components'>) {
    return async (req: Request, res: Response): Promise<void> => {
      const ctx = this.requireAuth(req, res);
      if (!ctx) return;
      const parsedBody = emitBody.safeParse(req.body);
      if (!parsedBody.success) return this.badRequest(res, parsedBody);
      const { dataSourceId, draftId, args } = parsedBody.data;

      // Pin any query plan to the request's data source BEFORE validation:
      // QueryPlanSchema requires dataSourceId, and the stamp stops the model
      // from targeting a different source than the run's.
      const rawArgs = args as { queryPlan?: unknown };
      if (rawArgs.queryPlan && typeof rawArgs.queryPlan === 'object') {
        (rawArgs.queryPlan as Record<string, unknown>)['dataSourceId'] = dataSourceId;
      }

      const parsed = DashboardToolCallSchema.safeParse({ tool, args });
      if (!parsed.success) {
        res.json({
          text: `Invalid arguments for ${tool}: ${formatIssues(parsed.error)}. Fix the arguments and call the tool again.`,
        });
        return;
      }

      // Server-validate any query plan against the live source before the
      // change is applied — a broken plan must never land on the dashboard.
      const callArgs = parsed.data.args as {
        queryPlan?: Record<string, unknown>;
        visualType?: unknown;
      };
      if (callArgs.queryPlan && typeof callArgs.queryPlan === 'object') {
        try {
          await executeQueryPlan(
            { ...callArgs.queryPlan, take: 1 },
            {
              workspaceId: ctx.workspaceId,
              bypassCache: true,
              ...(callArgs.visualType ? { componentType: callArgs.visualType as never } : {}),
            },
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown query error';
          res.json({
            text: `Query validation failed for ${tool}: ${message}. The component was NOT created. Re-check table/column names against list_schema, test the fix with run_query, then call ${tool} again with a corrected queryPlan.`,
          });
          return;
        }
      }

      try {
        // safeParse returns the full union; `tool` is statically excluded from
        // suggest_components, so the narrowing cast is safe.
        const call = parsed.data as Exclude<DashboardToolCall, { tool: 'suggest_components' }>;
        const result = await this.applyToolCall(call, {
          ...ctx,
          draftId,
        });
        res.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        logger.warn(`[DashboardClaw] ${tool} failed: ${message}`);
        res.status(400).json({ text: `${tool} failed: ${message}. The change was NOT applied.` });
      }
    };
  }

  private async applyToolCall(
    call: Exclude<DashboardToolCall, { tool: 'suggest_components' }>,
    ctx: AuthedContext & { draftId: string },
  ): Promise<{ text: string; id?: string }> {
    switch (call.tool) {
      case 'set_dashboard_meta': {
        const { title, description } = call.args;
        if (title === undefined && description === undefined) {
          return { text: 'No changes to apply — pass a title and/or description.' };
        }
        await setDashboardMeta(
          ctx.draftId,
          {
            ...(title !== undefined ? { name: title } : {}),
            ...(description !== undefined ? { description } : {}),
          },
          ctx,
        );
        return { text: 'Applied set_dashboard_meta.' };
      }
      case 'add_component': {
        // Position omitted when the model didn't set one — createDashboard-
        // Component auto-places it inside the write transaction (race-safe).
        const { query } = await createDashboardComponent(
          ctx.draftId,
          {
            visualType: call.args.visualType,
            title: call.args.title,
            queryJson: call.args.queryPlan,
            ...(call.args.position ? { position: JSON.stringify(call.args.position) } : {}),
            ...(call.args.componentConfig
              ? { config: JSON.stringify(call.args.componentConfig) }
              : {}),
          },
          ctx,
        );
        return {
          id: query.id,
          text: `Applied add_component — created component ${query.id} ("${call.args.title}").`,
        };
      }
      case 'update_component': {
        const componentId = call.args.componentId;
        await updateDashboardComponent(
          componentId,
          {
            ...(call.args.visualType !== undefined ? { visualType: call.args.visualType } : {}),
            ...(call.args.title !== undefined ? { title: call.args.title } : {}),
            ...(call.args.queryPlan !== undefined ? { queryJson: call.args.queryPlan } : {}),
            ...(call.args.position !== undefined
              ? { position: JSON.stringify(call.args.position) }
              : {}),
            ...(call.args.componentConfig !== undefined
              ? { config: JSON.stringify(call.args.componentConfig) }
              : {}),
          },
          ctx,
        );
        return { text: `Applied update_component to ${componentId}.` };
      }
      case 'remove_component': {
        await deleteDashboardComponent(call.args.componentId, ctx);
        return { text: `Applied remove_component — deleted ${call.args.componentId}.` };
      }
      case 'drill_result': {
        // Not persisted: the client renders the drill bubble from the tool
        // invocation's args. The plan was already validated above.
        return { text: `Drill result "${call.args.title}" validated and shown to the user.` };
      }
    }
  }

}

export const dashboardClawController = new DashboardClawController();
