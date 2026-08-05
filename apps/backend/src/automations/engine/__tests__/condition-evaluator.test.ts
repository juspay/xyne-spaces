import { ConditionEvaluator } from '../condition-evaluator';
import type { Condition } from '../../types/automation-config';
import type { AutomationContext } from '../../types/context';
import { ConditionOperator } from '../../types/operators';

const baseContext = {
  automation: { id: 'automation-1', workspaceId: 'workspace-1', createdById: 'user-1' },
  trigger: { type: 'ticket.created', data: { ticketId: 'ticket-1' } },
  steps: {
    scoreStep: {
      type: 'run_agent',
      output: {
        highScore: '10',
        lowScore: '2',
        equalScore: '10',
        decimalScore: '10.5',
        nonNumericScore: 'critical',
        emptyScore: '   ',
      },
    },
  },
} as unknown as AutomationContext;

function evaluate(condition: Condition): boolean {
  return new ConditionEvaluator().evaluate(condition, baseContext);
}

describe('ConditionEvaluator numeric comparisons', () => {
  it('compares numeric string operands numerically for gt/gte/lt/lte', () => {
    expect(evaluate({
      variable: '{{context.scoreStep.output.highScore}}',
      operator: ConditionOperator.GT,
      value: '{{context.scoreStep.output.lowScore}}',
    })).toBe(true);

    expect(evaluate({
      variable: '{{context.scoreStep.output.lowScore}}',
      operator: ConditionOperator.LT,
      value: '{{context.scoreStep.output.highScore}}',
    })).toBe(true);

    expect(evaluate({
      variable: '{{context.scoreStep.output.highScore}}',
      operator: ConditionOperator.GTE,
      value: '{{context.scoreStep.output.equalScore}}',
    })).toBe(true);

    expect(evaluate({
      variable: '{{context.scoreStep.output.highScore}}',
      operator: ConditionOperator.LTE,
      value: '{{context.scoreStep.output.equalScore}}',
    })).toBe(true);
  });

  it('supports numeric string to numeric literal comparisons', () => {
    expect(evaluate({
      variable: '{{context.scoreStep.output.highScore}}',
      operator: ConditionOperator.GT,
      value: 2,
    })).toBe(true);

    expect(evaluate({
      variable: '{{context.scoreStep.output.decimalScore}}',
      operator: ConditionOperator.LTE,
      value: 10.5,
    })).toBe(true);
  });

  it('returns false for non-numeric operands in numeric comparisons', () => {
    expect(evaluate({
      variable: '{{context.scoreStep.output.nonNumericScore}}',
      operator: ConditionOperator.GT,
      value: 2,
    })).toBe(false);

    expect(evaluate({
      variable: '{{context.scoreStep.output.emptyScore}}',
      operator: ConditionOperator.LT,
      value: 10,
    })).toBe(false);
  });
});
