// Safe JSON serialization and deserialization utilities for workflow storage

import { WorkflowState } from '../workflow-types'
import {
  StepInput,
  StepOutput,
  validateStepInput,
  validateStepOutput
} from './step-types'

// Error types for serialization
export class SerializationError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'SerializationError'
  }
}

export class DeserializationError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'DeserializationError'
  }
}

// Safe JSON serialization
export function safeSerialize(data: unknown): string {
  try {
    return JSON.stringify(data)
  } catch (error) {
    throw new SerializationError(
      `Failed to serialize data: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error
    )
  }
}

// Safe JSON deserialization
export function safeDeserialize<T = unknown>(json: string): T {
  try {
    const parsed = JSON.parse(json)
    return parsed as T
  } catch (error) {
    throw new DeserializationError(
      `Failed to deserialize JSON: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error
    )
  }
}

// Workflow state serialization
export function serializeWorkflowState(state: WorkflowState): string {
  try {
    return safeSerialize({
      workflowId: state.workflowId,
      workflowExecutionId: state.workflowExecutionId,
      serializedAt: new Date().toISOString()
    })
  } catch (error) {
    throw new SerializationError(
      `Failed to serialize workflow state for workflowId: ${state.workflowId}`,
      error
    )
  }
}

// Step input serialization
export function serializeStepInput<T>(input: T): string {
  try {
    validateStepInput(input)
    return safeSerialize({
      ...input,
      serializedAt: new Date().toISOString()
    })
  } catch (error) {
    throw new SerializationError(
      "error"
    )
  }
}

export function deserializeStepInput<T>(json: string): StepInput<T> {
  try {
    const data = safeDeserialize(json)
    return validateStepInput<T>(data)
  } catch (error) {
    throw new DeserializationError(
      'Failed to deserialize step input',
      error
    )
  }
}

// Step output serialization
export function serializeStepOutput<T>(output: T): string {
  try {
    validateStepOutput(output)
    return safeSerialize(output)
  } catch (error) {
    throw new SerializationError(
      'Failed to serialize step output',
      error
    )
  }
}

export function deserializeStepOutput<T>(json: string): StepOutput<T> {
  try {
    const data = safeDeserialize(json)
    return validateStepOutput<T>(data)
  } catch (error) {
    throw new DeserializationError(
      'Failed to deserialize step output',
      error
    )
  }
}

// Conditional result helpers
export function serializeConditionalResult(result: boolean): string {
  return safeSerialize({
    result,
    completed: true,
    completedAt: new Date().toISOString()
  })
}

export function deserializeConditionalResult(json: string): boolean {
  try {
    const data = safeDeserialize<{ result: boolean }>(json)
    if (typeof data.result !== 'boolean') {
      throw new Error('Invalid conditional result: expected boolean')
    }
    return data.result
  } catch (error) {
    throw new DeserializationError(
      'Failed to deserialize conditional result',
      error
    )
  }
}

// External step data helpers
export function serializeExternalStepData<R>(data: R): string {
  return safeSerialize({
    externalData: data,
    receivedAt: new Date().toISOString(),
    completed: true,
    completedAt: new Date().toISOString()
  })
}

export function deserializeExternalStepData<R>(json: string): R {
  try {
    const data = safeDeserialize<{ externalData: R }>(json)
    return data.externalData
  } catch (error) {
    throw new DeserializationError(
      'Failed to deserialize external step data',
      error
    )
  }
}

// While loop state helpers
export function serializeLoopState(
  currentIteration: number,
  status: string,
  maxIterations?: number
): string {
  return safeSerialize({
    currentIteration,
    status,
    maxIterations,
    updatedAt: new Date().toISOString()
  })
}

export function deserializeLoopState(json: string): {
  currentIteration: number
  status: string
  maxIterations?: number
} {
  try {
    const data = safeDeserialize<{
      currentIteration: number
      status: string
      maxIterations?: number
    }>(json)

    if (typeof data.currentIteration !== 'number') {
      throw new Error('Invalid loop state: currentIteration must be a number')
    }

    if (typeof data.status !== 'string') {
      throw new Error('Invalid loop state: status must be a string')
    }

    return {
      currentIteration: data.currentIteration,
      status: data.status,
      maxIterations: data.maxIterations
    }
  } catch (error) {
    throw new DeserializationError(
      'Failed to deserialize loop state',
      error
    )
  }
}

// Parent step ID helpers
export function serializeParentStepIds(parentStepIds: string[]): string {
  return safeSerialize(parentStepIds)
}

export function deserializeParentStepIds(json: string | null): string[] {
  if (!json) return []

  try {
    const data = safeDeserialize<string[]>(json)
    if (!Array.isArray(data)) {
      throw new Error('Parent step IDs must be an array')
    }
    return data.filter(id => typeof id === 'string')
  } catch (error) {
    throw new DeserializationError(
      'Failed to deserialize parent step IDs',
      error
    )
  }
}