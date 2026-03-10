/**
 * Utility functions for AgentChatView component.
 */
import {
  CombinedWorkflowData,
  WorkflowStep,
} from '../../../services/Workflow/workflowGraphService.types';

// ─── Types ───────────────────────────────────────────────────────────────────

export type SafeRecord = Record<string, unknown>;

export interface SubMessage {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  stepName: string;
  turnIndex: number;
  createdAt?: string;
}

export interface AgentMessage {
  nodeIndex: number;
  stepName: string;
  status: string;
  agentInfo: AgentInfo;
  summary: string;
  subMessages: SubMessage[];
  editSteps: WorkflowStep[];
  createdAt: string | undefined;
}

export interface GraphNodeInfo {
  index: number;
  stepName: string;
  stepIds: string[];
  status: string;
  hasExpandedExecutions: boolean;
}

export interface AgentInfo {
  name: string;
  avatarBg: string;
  avatarText: string;
  initials: string;
  labelColor: string;
  bubbleBg: string;
  icon:
    | 'brain'
    | 'code'
    | 'eye'
    | 'shield'
    | 'git'
    | 'bug'
    | 'bot'
    | 'twitch'
    | 'ghost'
    | 'laugh'
    | 'skull';
}

export const getAgentInfo = (stepName: string): AgentInfo => {
  const lower = stepName.toLowerCase();

  if (lower.includes('review') || lower.includes('audit')) {
    return {
      name: 'Reviewer',
      avatarBg: 'bg-white border-2 border-amber-300',
      avatarText: 'text-amber-500',
      initials: 'RV',
      labelColor: 'text-gray-700',
      bubbleBg: 'bg-gray-50/80',
      icon: 'twitch',
    };
  }

  if (lower.includes('plan')) {
    return {
      name: 'Planner',
      avatarBg: 'bg-white border-2 border-violet-300',
      avatarText: 'text-violet-500',
      initials: 'PL',
      labelColor: 'text-gray-700',
      bubbleBg: 'bg-gray-50/80',
      icon: 'ghost',
    };
  }

  if (
    lower.includes('implement') ||
    lower.includes('impl') ||
    lower.includes('iter') ||
    lower.includes('coding') ||
    lower.includes('code')
  ) {
    return {
      name: 'Implementer',
      avatarBg: 'bg-white border-2 border-sky-300',
      avatarText: 'text-sky-500',
      initials: 'IM',
      labelColor: 'text-gray-700',
      bubbleBg: 'bg-gray-50/80',
      icon: 'laugh',
    };
  }

  if (
    lower.includes('valid') ||
    lower.includes('test') ||
    lower.includes('verify') ||
    lower.includes('check')
  ) {
    return {
      name: 'Validator',
      avatarBg: 'bg-white border-2 border-emerald-300',
      avatarText: 'text-emerald-500',
      initials: 'VA',
      labelColor: 'text-gray-700',
      bubbleBg: 'bg-gray-50/80',
      icon: 'skull',
    };
  }

  if (
    lower.includes('git') ||
    lower.includes('diff') ||
    lower.includes('commit') ||
    lower.includes('patch')
  ) {
    return {
      name: 'Git Agent',
      avatarBg: 'bg-white border-2 border-orange-300',
      avatarText: 'text-orange-500',
      initials: 'GT',
      labelColor: 'text-gray-700',
      bubbleBg: 'bg-gray-50/80',
      icon: 'git',
    };
  }

  if (
    lower.includes('rca') ||
    lower.includes('root_cause') ||
    lower.includes('debug') ||
    lower.includes('diagnos')
  ) {
    return {
      name: 'RCA Agent',
      avatarBg: 'bg-white border-2 border-rose-300',
      avatarText: 'text-rose-500',
      initials: 'RC',
      labelColor: 'text-gray-700',
      bubbleBg: 'bg-gray-50/80',
      icon: 'bug',
    };
  }

  return {
    name: 'Agent',
    avatarBg: 'bg-white border-2 border-slate-300',
    avatarText: 'text-slate-500',
    initials: 'AG',
    labelColor: 'text-gray-700',
    bubbleBg: 'bg-gray-50/80',
    icon: 'bot',
  };
};

// ─── LLM Response Parsing ─────────────────────────────────────────────────────

/**
 * Parse LLM response text from step data.
 * Tries multiple data paths in priority order.
 */
export const parseLLMResponse = (data: SafeRecord | string | null | undefined): string => {
  if (!data) return '';
  try {
    const record: SafeRecord = typeof data === 'string' ? (JSON.parse(data) as SafeRecord) : data;

    // Path 1: turn.result.content
    const turn = record['turn'] as SafeRecord | undefined;
    const turnResult = turn?.['result'] as SafeRecord | undefined;
    const turnContent = turnResult?.['content'];
    if (typeof turnContent === 'string' && turnContent.trim()) {
      return turnContent.trim();
    }

    // Path 2: top-level response or content
    const response = record['response'];
    if (typeof response === 'string' && response.trim()) {
      return response.trim();
    }
    const content = record['content'];
    if (typeof content === 'string' && content.trim()) {
      return content.trim();
    }

    // Path 3: output.content or output.result.content
    const output = record['output'];
    if (typeof output === 'string' && output.trim()) {
      return output.trim();
    }
    const outputRecord = output as SafeRecord | undefined;
    const outputContent = outputRecord?.['content'];
    if (typeof outputContent === 'string' && outputContent.trim()) {
      return outputContent.trim();
    }
    const outputResult = outputRecord?.['result'] as SafeRecord | undefined;
    const outputResultContent = outputResult?.['content'];
    if (typeof outputResultContent === 'string' && outputResultContent.trim()) {
      return outputResultContent.trim();
    }

    // Path 4: messages[] array - find last assistant message
    const messages = record['messages'] as Array<SafeRecord> | undefined;
    if (Array.isArray(messages)) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg?.['role'] === 'assistant') {
          const c = msg['content'];
          if (typeof c === 'string' && c.trim()) return c.trim();
          if (Array.isArray(c)) {
            const textPart = c.find(
              (p): p is SafeRecord =>
                typeof p === 'object' && p !== null && (p as SafeRecord)['type'] === 'text',
            );
            const textContent = textPart?.['text'];
            if (typeof textContent === 'string' && textContent.trim()) return textContent.trim();
          }
        }
      }
    }

    // Path 5: input.messages[] - find last assistant message
    const input = record['input'] as SafeRecord | undefined;
    const inputMessages = input?.['messages'] as Array<SafeRecord> | undefined;
    if (Array.isArray(inputMessages)) {
      for (let i = inputMessages.length - 1; i >= 0; i--) {
        const msg = inputMessages[i];
        const msgContent = msg?.['content'];
        if (msg?.['role'] === 'assistant' && typeof msgContent === 'string') {
          return msgContent.trim();
        }
      }
    }

    return '';
  } catch {
    return '';
  }
};

// ─── Formatting Helpers ───────────────────────────────────────────────────────

/** Format a step name for display (remove underscores, title-case) */
export const formatStepName = (name: string): string =>
  name
    .replace(/_/g, ' ')
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

/** Format timestamp for display */
export const formatTime = (iso?: string): string => {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

// ─── Step Data Extraction ─────────────────────────────────────────────────────

/**
 * Extract edit steps (tool_edit, tool_multiedit, tool_write) from a node's steps
 */
export const extractEditSteps = (
  nodeStepIds: string[],
  combinedStepsData: CombinedWorkflowData,
): WorkflowStep[] => {
  const stepIdSet = new Set(nodeStepIds);
  const editSteps: WorkflowStep[] = [];

  const processStep = (step: WorkflowStep): void => {
    const stepName = step.stepName?.toLowerCase() || '';

    if (
      stepName.startsWith('tool_edit') ||
      stepName.startsWith('tool_multiedit') ||
      stepName.startsWith('tool_write')
    ) {
      editSteps.push(step);
    }
  };

  combinedStepsData.workflows.forEach(workflow => {
    workflow.steps.forEach(step => {
      if (!stepIdSet.has(step.id)) return;

      processStep(step);
      step.expandedExecutions?.forEach(exec => {
        exec.steps.forEach(processStep);
      });
      step.expandedWorkflows?.forEach(exec => {
        exec.steps.forEach(processStep);
      });
      step.expandedSteps?.forEach(processStep);
    });
  });

  return editSteps.sort((a, b) => {
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return timeA - timeB;
  });
};

/**
 * Collect ALL individual LLM interactions from steps belonging to a graph node.
 */
export const extractAllSubMessages = (
  nodeStepIds: string[],
  combinedStepsData: CombinedWorkflowData,
): SubMessage[] => {
  const stepIdSet = new Set(nodeStepIds);
  const collected: SubMessage[] = [];
  let turnIndex = 0;

  const processSubStep = (subStep: WorkflowStep): void => {
    const name = (subStep.stepName ?? '').toLowerCase();
    const isLLMStep =
      name.startsWith('llm_call') ||
      name === 'assistant_message' ||
      name.includes('llm') ||
      name.includes('chat_completion');

    if (isLLMStep) {
      const content = parseLLMResponse(subStep.data as SafeRecord);
      if (content) {
        collected.push({
          id: subStep.id || `sub-${turnIndex}`,
          role: 'assistant',
          content,
          stepName: subStep.stepName ?? name,
          turnIndex: turnIndex++,
          createdAt: subStep.createdAt,
        });
      }
    }

    subStep.expandedSteps?.forEach(processSubStep);
  };

  combinedStepsData.workflows.forEach(workflow => {
    workflow.steps.forEach(step => {
      if (!stepIdSet.has(step.id)) return;

      step.expandedExecutions?.forEach(exec => {
        exec.steps.forEach(processSubStep);
      });
      step.expandedWorkflows?.forEach(exec => {
        exec.steps.forEach(processSubStep);
      });
      step.expandedSteps?.forEach(processSubStep);
    });
  });

  return collected;
};

/** Get createdAt timestamp from first step of the node */
export const getNodeCreatedAt = (
  nodeStepIds: string[],
  combinedStepsData: CombinedWorkflowData,
): string | undefined => {
  const stepIdSet = new Set(nodeStepIds);
  for (const workflow of combinedStepsData.workflows) {
    for (const step of workflow.steps) {
      if (stepIdSet.has(step.id)) return step.createdAt;
    }
  }
  return undefined;
};

/**
 * Parse file info from edit step data
 */
export const parseEditStepFileInfo = (
  step: WorkflowStep,
): { fileName: string; filePath: string; success: boolean } | null => {
  try {
    const data = step.data as SafeRecord;
    const input = (data['input'] as SafeRecord) ?? data;
    const output = (data['output'] as SafeRecord) ?? data;

    const filePath =
      (input['file_path'] as string) ??
      (output['file_path'] as string) ??
      (data['file_path'] as string) ??
      '';
    const fileName = filePath.split('/').pop() || 'Unknown File';
    const success = (output['success'] as boolean) ?? true;

    return { fileName, filePath, success };
  } catch {
    return null;
  }
};

/**
 * Group edit steps by file path for file-wise diff view
 */
export const groupEditStepsByFile = (editSteps: WorkflowStep[]): Map<string, WorkflowStep[]> => {
  const fileMap = new Map<string, WorkflowStep[]>();

  editSteps.forEach(step => {
    const info = parseEditStepFileInfo(step);
    const filePath = info?.filePath || 'unknown';

    if (!fileMap.has(filePath)) {
      fileMap.set(filePath, []);
    }
    fileMap.get(filePath)!.push(step);
  });

  return fileMap;
};
