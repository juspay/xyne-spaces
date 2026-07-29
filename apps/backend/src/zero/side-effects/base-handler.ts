import type { QueryContext } from '../acl/core/types';
import type { SideEffectJobConfig } from './types';

export class BaseSideEffectHandler {
  protected ctx: QueryContext;

  constructor(ctx: QueryContext) {
    this.ctx = ctx;
  }

  async onInsert(_job: SideEffectJobConfig): Promise<void> {
    return Promise.resolve();
  }

  async onUpdate(_job: SideEffectJobConfig): Promise<void> {
    return Promise.resolve();
  }

  async onDelete(_job: SideEffectJobConfig): Promise<void> {
    return Promise.resolve();
  }

  async onUpsert(_job: SideEffectJobConfig): Promise<void> {
    return Promise.resolve();
  }
}
