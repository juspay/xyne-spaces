// Polling service for workflow execution

import { WorkflowPoller } from '../polling/workflow-poller'
import { PollingConfig } from '../polling/config'

export class PollingService {
  private poller: WorkflowPoller

  constructor(config?: PollingConfig) {
    this.poller = new WorkflowPoller(config)
  }

  async start(): Promise<void> {
    await this.poller.start()
  }

  async stop(): Promise<void> {
    await this.poller.stop()
  }
}

export const pollingService = new PollingService()