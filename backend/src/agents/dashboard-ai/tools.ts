import { z } from 'zod';
import {
  AddComponentToolSchema,
  MeasureSchema,
  QueryPlanSchema,
  RemoveComponentToolSchema,
  SetDashboardMetaToolSchema,
  SuggestComponentsToolSchema,
  UpdateComponentToolSchema,
} from '@xyne/shared';
import { type ToolDefinition } from '@framework';

const PermissiveWhereForAi = z.record(z.unknown());

const MeasureForAiSchema = MeasureSchema.omit({ filter: true }).extend({
  filter: PermissiveWhereForAi.optional(),
});

const QueryPlanForAiSchema = QueryPlanSchema.omit({
  where: true,
  measures: true,
}).extend({
  where: PermissiveWhereForAi.optional(),
  measures: z.array(MeasureForAiSchema).optional(),
});

const VisualTypeForAiSchema = z.enum([
  'KPI',
  'KPI_COMPARE',
  'BAR_CHART',
  'PIE_CHART',
  'LINE_CHART',
  'AREA_CHART',
  'SCATTER_CHART',
  'DATA_TABLE',
]);

const AddComponentArgsForAiSchema = AddComponentToolSchema.shape.args
  .omit({ queryPlan: true, visualType: true })
  .extend({
    queryPlan: QueryPlanForAiSchema,
    visualType: VisualTypeForAiSchema,
  });

const UpdateComponentArgsForAiSchema = UpdateComponentToolSchema.shape.args
  .omit({ queryPlan: true, visualType: true })
  .extend({
    queryPlan: QueryPlanForAiSchema.optional(),
    visualType: VisualTypeForAiSchema.optional(),
  });

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'set_dashboard_meta',
    description: 'Set the dashboard title and optional description. Call once on a new draft.',
    inputSchema: SetDashboardMetaToolSchema.shape.args,
  },
  {
    name: 'add_component',
    description:
      'Add a chart, KPI, or table to the dashboard. queryPlan defines what data to show.',
    inputSchema: AddComponentArgsForAiSchema,
  },
  {
    name: 'update_component',
    description:
      'Modify an existing component on the draft. Reference its id from the plan you received.',
    inputSchema: UpdateComponentArgsForAiSchema,
  },
  {
    name: 'remove_component',
    description: 'Remove a component from the draft.',
    inputSchema: RemoveComponentToolSchema.shape.args,
  },
  {
    name: 'suggest_components',
    description:
      "Call this INSTEAD of add_component when you cannot build what the user asked for because the required table or column does not exist on the selected data source. Do NOT write a long prose explanation — return a short message plus 2–4 concrete alternative prompts the user can click to retry against the data that IS available.",
    inputSchema: SuggestComponentsToolSchema.shape.args,
  },
];
