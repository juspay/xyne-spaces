import type { NudgeDefinition } from './types';

type TriggerKey = `${string}.${string}`;

class NudgeDefinitionRegistry {
  private definitions = new Map<TriggerKey, NudgeDefinition<any>[]>();
  private registeredKinds = new Set<string>();
  private byKind = new Map<string, NudgeDefinition<any>>();

  register(definition: NudgeDefinition<any>): void {
    if (this.registeredKinds.has(definition.kind)) return;

    for (const eventKey of definition.trigger.subscribesTo) {
      const key = eventKey as TriggerKey;
      const existing = this.definitions.get(key) ?? [];
      existing.push(definition);
      this.definitions.set(key, existing);
    }

    this.registeredKinds.add(definition.kind);
    this.byKind.set(definition.kind, definition);
  }

  getForTrigger(eventCategory: string, eventName: string): NudgeDefinition<any>[] {
    const key: TriggerKey = `${eventCategory}.${eventName}`;
    return this.definitions.get(key) ?? [];
  }

  getByKind(kind: string): NudgeDefinition<any> | undefined {
    return this.byKind.get(kind);
  }
}

export const nudgeRegistry = new NudgeDefinitionRegistry();
