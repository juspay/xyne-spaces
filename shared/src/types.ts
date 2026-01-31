export type WorkflowStep = {
    readonly id: string;
    readonly workflowExecutionId: string;
    readonly stepExecutorType: string;
    readonly stepName: string | null;
    readonly type: string | null;
    readonly previousStepId: string | null;
    readonly data: string | null;
    readonly status: string | null;
    readonly markdownSummary: string | null;
    readonly createdAt: number;
    readonly updatedAt: number;
}