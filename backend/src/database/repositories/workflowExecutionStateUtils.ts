/**
 * Utility functions for handling WorkflowExecutionState operations
 * This provides a centralized way to manage context and output which are now stored
 * in the separate WorkflowExecutionState table (workflow schema)
 */

import { DatabaseClient } from '@/database/client';
import { WorkflowExecution } from '@/types/database';

const prisma = DatabaseClient.getInstance();

// Type for execution with state (context and output stitched in)
export type WorkflowExecutionWithState = WorkflowExecution & {
  context: string | null;
  output: string | null;
};

/**
 * Fetches the state (context and output) for a workflow execution
 */
export async function getExecutionState(workflowExecutionId: string): Promise<{ context: string | null; output: string | null }> {
  const state = await prisma.workflowExecutionState.findUnique({
    where: { workflowExecutionId },
  });
  return {
    context: state?.context ?? null,
    output: state?.output ?? null,
  };
}

/**
 * Stitches state (context and output) onto a workflow execution
 */
export async function stitchExecutionState<T extends WorkflowExecution>(
  execution: T | null
): Promise<(T & { context: string | null; output: string | null }) | null> {
  if (!execution) return null;
  
  const state = await getExecutionState(execution.id);
  return {
    ...execution,
    context: state.context,
    output: state.output,
  };
}

/**
 * Stitches state onto multiple workflow executions
 */
export async function stitchExecutionStateMany<T extends WorkflowExecution>(
  executions: T[]
): Promise<(T & { context: string | null; output: string | null })[]> {
  if (executions.length === 0) return [];

  const executionIds = executions.map(e => e.id);
  const states = await prisma.workflowExecutionState.findMany({
    where: { workflowExecutionId: { in: executionIds } },
  });

  const stateMap = new Map(states.map(s => [s.workflowExecutionId, s]));

  return executions.map(execution => ({
    ...execution,
    context: stateMap.get(execution.id)?.context ?? null,
    output: stateMap.get(execution.id)?.output ?? null,
  }));
}

/**
 * Creates or updates the execution state
 */
export async function upsertExecutionState(
  workflowExecutionId: string,
  data: { context?: string | null; output?: string | null }
): Promise<void> {
  const existingState = await prisma.workflowExecutionState.findUnique({
    where: { workflowExecutionId },
  });

  if (existingState) {
    await prisma.workflowExecutionState.update({
      where: { workflowExecutionId },
      data: {
        ...(data.context !== undefined && { context: data.context }),
        ...(data.output !== undefined && { output: data.output }),
      },
    });
  } else {
    await prisma.workflowExecutionState.create({
      data: {
        workflowExecutionId,
        context: data.context ?? null,
        output: data.output ?? null,
      },
    });
  }
}

/**
 * Creates execution state when creating a new workflow execution
 */
export async function createExecutionState(
  workflowExecutionId: string,
  context?: string | null,
  output?: string | null
): Promise<void> {
  await prisma.workflowExecutionState.create({
    data: {
      workflowExecutionId,
      context: context ?? null,
      output: output ?? null,
    },
  });
}

/**
 * Updates execution state (context and/or output)
 */
export async function updateExecutionState(
  workflowExecutionId: string,
  data: { context?: string | null; output?: string | null }
): Promise<void> {
  // Use upsert to handle case where state doesn't exist yet
  await upsertExecutionState(workflowExecutionId, data);
}

/**
 * Deletes execution state when deleting a workflow execution
 */
export async function deleteExecutionState(workflowExecutionId: string): Promise<void> {
  await prisma.workflowExecutionState.deleteMany({
    where: { workflowExecutionId },
  });
}
