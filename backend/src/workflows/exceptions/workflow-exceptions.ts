// Custom exceptions for workflow execution

export class WorkflowPausedException extends Error {
  constructor(workflowId: string, stepId?: string) {
    const message = stepId
      ? `Workflow ${workflowId} paused before step: ${stepId}`
      : `Workflow ${workflowId} paused`

    super(message)
    this.name = 'WorkflowPausedException'
  }
}

export class WorkflowCancelledException extends Error {
  constructor(workflowId: string, stepId?: string) {
    const message = stepId
      ? `Workflow ${workflowId} cancelled before step: ${stepId}`
      : `Workflow ${workflowId} cancelled`

    super(message)
    this.name = 'WorkflowCancelledException'
  }
}


export class WorkflowExternalWaitException extends Error {


  constructor(workflowId: string, stepId: string) {
    const message = `Workflow ${workflowId} is waiting for external input at step: ${stepId}`

    super(message)
    this.name = 'WorkflowExternalWaitException'
  }
}
export class WorkflowExecutionError extends Error {
  public readonly cause: unknown;

  constructor(workflowId: string, stepId: string, originalError: unknown) {
    const message = `Workflow ${workflowId} failed at step ${stepId}: ${
      originalError instanceof Error ? originalError.message : 'Unknown error'
    }`

    super(message)
    this.name = 'WorkflowExecutionError'
    this.cause = originalError
  }
}

export class WorkflowLockLostException extends Error {
  constructor(
    public workflowExecutionId: string,
    public stepId: string,
    message?: string
  ) {
    super(message || `Workflow ${workflowExecutionId} lock lost at step ${stepId}`)
    this.name = 'WorkflowLockLostException'
  }
}

export class WorkflowWaitingForChildrenException extends Error {
  constructor(workflowExecutionId: string, parallelStepId: string) {
    const message = `Workflow execution ${workflowExecutionId} is waiting for child workflows at step: ${parallelStepId}`

    super(message)
    this.name = 'WorkflowWaitingForChildrenException'
  }
}