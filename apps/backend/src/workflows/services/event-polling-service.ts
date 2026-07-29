import { EventPoller } from '../polling/event-poller'
import { PollingConfig } from '../polling/config'

export class EventPollingService {
  private poller: EventPoller

  constructor(config?: PollingConfig) {
    this.poller = new EventPoller(config)
  }

  async start(): Promise<void> {
    await this.poller.start()
  }

  async stop(): Promise<void> {
    await this.poller.stop()
  }
}

export const eventPollingService = new EventPollingService()
