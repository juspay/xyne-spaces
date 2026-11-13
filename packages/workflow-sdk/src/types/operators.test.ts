import { describe, it, expect } from 'vitest';
import { ConditionOperator, OPERATOR_DESCRIPTORS, VALUE_LESS_OPERATORS } from './operators.js';

describe('OPERATOR_DESCRIPTORS', () => {
  it('has an entry for every ConditionOperator value', () => {
    const allValues = Object.values(ConditionOperator);
    const descriptorValues = OPERATOR_DESCRIPTORS.map((d) => d.value);
    expect(descriptorValues.sort()).toEqual(allValues.sort());
  });

  it('every entry has label and valueType', () => {
    for (const desc of OPERATOR_DESCRIPTORS) {
      expect(typeof desc.label).toBe('string');
      expect(desc.label.length).toBeGreaterThan(0);
      expect(['string', 'number', 'boolean', 'none']).toContain(desc.valueType);
    }
  });

  it('value-less operators have valueType "none"', () => {
    for (const op of VALUE_LESS_OPERATORS) {
      const desc = OPERATOR_DESCRIPTORS.find((d) => d.value === op);
      expect(desc).toBeDefined();
      expect(desc!.valueType).toBe('none');
    }
  });

  it('EXISTS has valueType "none"', () => {
    const exists = OPERATOR_DESCRIPTORS.find(
      (d) => d.value === ConditionOperator.EXISTS,
    );
    expect(exists).toBeDefined();
    expect(exists!.valueType).toBe('none');
  });

  it('numeric operators have valueType "number"', () => {
    const numericOps = [
      ConditionOperator.GT,
      ConditionOperator.GTE,
      ConditionOperator.LT,
      ConditionOperator.LTE,
    ];
    for (const op of numericOps) {
      const desc = OPERATOR_DESCRIPTORS.find((d) => d.value === op);
      expect(desc).toBeDefined();
      expect(desc!.valueType).toBe('number');
    }
  });
});
